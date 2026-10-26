/**
 * sources.js — Source document management routes.
 *
 * Endpoints:
 *   POST /v1/sources       — Upload a new source document with uploadScan middleware
 *   GET  /v1/sources       — List organisation sources with filtering & pagination
 *   GET  /v1/sources/:id   — Get a specific source document metadata
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const Source = require('../models/Source');
const { authenticate } = require('../middleware/auth');
const { orgIsolation } = require('../middleware/orgIsolation');
const { uploadScan } = require('../middleware/uploadScan');
const { uploadObject, getPresignedUrl } = require('../utils/minio');

const router = express.Router();

// Mount authentication and organisation isolation on all source routes
router.use(authenticate, orgIsolation);

/**
 * POST /v1/sources
 *
 * Uploads a source document (.pdf, .docx, .md) to MinIO after passing
 * type allow-list, 10MB size limit, and AV scanning.
 * Saves the Source metadata to MongoDB.
 */
router.post('/', uploadScan, async (req, res, next) => {
  try {
    const orgId = req.org?._id || req.orgId;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'Organisation context is required to upload a source.',
        code: 'MISSING_ORG',
      });
    }

    const {
      type = 'guideline',
      owner,
      ownerName,
      version = '1.0',
      effectiveDate,
      expiryDate,
      status = 'ready',
    } = req.body;

    // Validate type against allowed enum values
    if (!Source.SOURCE_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid source type "${type}". Allowed: ${Source.SOURCE_TYPES.join(', ')}`,
        code: 'INVALID_SOURCE_TYPE',
      });
    }

    // Generate safe, unique storage key in MinIO: sources/<orgId>/<uuid>-<safeFilename>
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const safeBaseName = path
      .basename(req.file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageRef = `sources/${orgId.toString()}/${Date.now()}-${randomSuffix}-${safeBaseName}`;

    // Upload to MinIO S3-compatible storage
    try {
      await uploadObject(
        storageRef,
        req.file.buffer,
        req.file.size,
        req.file.mimetype || 'application/octet-stream'
      );
    } catch (storageErr) {
      console.error('[sources] MinIO upload error:', storageErr);
      return res.status(502).json({
        success: false,
        error: `Failed to store file in object storage: ${storageErr.message}`,
        code: 'STORAGE_UPLOAD_FAILED',
      });
    }

    // Determine owner ObjectId if valid, else null
    let resolvedOwner = null;
    if (owner && mongoose.Types.ObjectId.isValid(owner)) {
      resolvedOwner = new mongoose.Types.ObjectId(owner);
    } else if (req.user?._id && mongoose.Types.ObjectId.isValid(req.user._id)) {
      resolvedOwner = req.user._id;
    }

    const resolvedOwnerName =
      (typeof ownerName === 'string' && ownerName.trim()) ||
      req.user?.name ||
      '';

    // Parse effective and expiry dates
    let parsedEffectiveDate = effectiveDate ? new Date(effectiveDate) : new Date();
    if (isNaN(parsedEffectiveDate.getTime())) {
      parsedEffectiveDate = new Date();
    }

    let parsedExpiryDate = null;
    if (expiryDate) {
      const d = new Date(expiryDate);
      if (!isNaN(d.getTime())) {
        parsedExpiryDate = d;
      }
    }

    // Save Source document to MongoDB
    const source = new Source({
      orgId,
      fileName: req.file.originalname,
      storageRef,
      fileSize: req.file.size,
      mimeType: req.file.mimetype || 'application/octet-stream',
      type,
      owner: resolvedOwner,
      ownerName: resolvedOwnerName,
      version: String(version).trim() || '1.0',
      effectiveDate: parsedEffectiveDate,
      expiryDate: parsedExpiryDate,
      status: Source.SOURCE_STATUSES.includes(status) ? status : 'ready',
    });

    await source.save();

    // Generate presigned download URL for immediate access if possible
    let downloadUrl = null;
    try {
      downloadUrl = await getPresignedUrl(storageRef, 3600);
    } catch (_ignore) {
      // Non-fatal if presigning fails at upload time
    }

    const responseData = source.toObject();
    if (downloadUrl) {
      responseData.downloadUrl = downloadUrl;
    }

    return res.status(201).json(responseData);
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/sources
 *
 * List organisation sources. Supports query filters:
 *   - type: guideline | fact-sheet | glossary | past-content | asset
 *   - status: active | ready | processing | expired | superseded | error
 *   - owner: filter by owner name
 *   - page: integer (default 1)
 *   - limit: integer (default 20)
 */
router.get('/', async (req, res, next) => {
  try {
    const orgId = req.org?._id || req.orgId;
    const filter = { orgId };

    if (req.query.type && req.query.type !== 'all') {
      filter.type = req.query.type;
    }

    if (req.query.status && req.query.status !== 'all') {
      filter.status = req.query.status;
    }

    if (req.query.owner) {
      filter.ownerName = req.query.owner;
    }

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const skip = (page - 1) * limit;

    const [sources, total] = await Promise.all([
      Source.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Source.countDocuments(filter),
    ]);

    // Return structure compliant with OpenAPI SourceListResponse
    return res.status(200).json({
      data: sources,
      total,
      page,
      limit,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/sources/:id
 *
 * Retrieves a single source document by ID, scoped to the caller's organisation.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: `Invalid source ID format: "${id}".`,
        code: 'INVALID_ID',
      });
    }

    const orgId = req.org?._id || req.orgId;
    const source = await Source.findOne({ _id: id, orgId }).lean();

    if (!source) {
      return res.status(404).json({
        success: false,
        error: 'Source not found.',
        code: 'NOT_FOUND',
      });
    }

    // Attach presigned download URL if MinIO is reachable
    let downloadUrl = null;
    try {
      downloadUrl = await getPresignedUrl(source.storageRef, 3600);
    } catch (_ignore) {
      // Non-fatal
    }

    if (downloadUrl) {
      source.downloadUrl = downloadUrl;
    }

    return res.status(200).json(source);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
