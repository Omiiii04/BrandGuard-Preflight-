/**
 * drafts.js — Draft content management routes.
 *
 * Implements Block 3 & OpenAPI Drafts Specification:
 *   POST /v1/drafts              — Submit a new draft with intent form (multipart or JSON)
 *   GET  /v1/drafts              — List organisation drafts with pagination & filtering
 *   GET  /v1/drafts/:id          — Get draft metadata and current status
 *   GET  /v1/drafts/:id/versions — List all version revisions of a draft with SHA-256 hashes
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const multer = require('multer');

const Draft = require('../models/Draft');
const DraftVersion = require('../models/DraftVersion');
const { authenticate } = require('../middleware/auth');
const { orgIsolation } = require('../middleware/orgIsolation');
const { performAvScan, MAX_FILE_SIZE } = require('../middleware/uploadScan');
const { redactContent, loadOrgWatchlist } = require('../middleware/redactionGateway');
const { sha256 } = require('../utils/hash');
const { logEvent, AUDIT_EVENTS } = require('../services/auditLogger');
const { uploadObject, getPresignedUrl } = require('../utils/minio');

const router = express.Router();

// Enforce authentication and organisation tenancy boundary on all draft endpoints
router.use(authenticate, orgIsolation);

// Multer memory-storage configuration for multipart draft submissions
const ALLOWED_DRAFT_EXTENSIONS = ['.pdf', '.docx', '.md', '.markdown', '.txt'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE, // 10 MB limit
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_DRAFT_EXTENSIONS.includes(ext)) {
      const err = new Error(
        `File format "${ext || 'unknown'}" is not supported. Allowed formats: PDF (.pdf), Word (.docx), Markdown (.md), Text (.txt).`
      );
      err.code = 'INVALID_FILE_TYPE';
      return cb(err, false);
    }
    return cb(null, true);
  },
}).single('file');

/**
 * Middleware wrapper for multer with structured error responses.
 */
function handleDraftUpload(req, res, next) {
  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'File size exceeds 10 MB limit.',
          code: 'FILE_TOO_LARGE',
        });
      }
      return res.status(400).json({
        success: false,
        error: `Upload error: ${err.message}`,
        code: 'UPLOAD_ERROR',
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        error: err.message || 'File upload failed.',
        code: err.code || 'INVALID_UPLOAD',
      });
    }
    return next();
  });
}

/**
 * Normalizes and validates the intent payload.
 * Accepts intent either as a JSON string, object, or flat form fields.
 *
 * @param {object} body - Request body
 * @returns {{ valid: boolean, intent?: object, error?: string }}
 */
function parseAndValidateIntent(body) {
  let parsed = null;

  if (body.intent) {
    if (typeof body.intent === 'string') {
      try {
        parsed = JSON.parse(body.intent);
      } catch (_e) {
        return {
          valid: false,
          error: 'Invalid JSON provided for intent field.',
        };
      }
    } else if (typeof body.intent === 'object' && body.intent !== null) {
      parsed = body.intent;
    }
  } else {
    parsed = {
      purpose: body.purpose,
      audience: body.audience,
      mustSay: body.mustSay,
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      valid: false,
      error: 'Missing required intent form: purpose, audience, and mustSay are mandatory.',
    };
  }

  const purpose = typeof parsed.purpose === 'string' ? parsed.purpose.trim() : '';
  const audience = typeof parsed.audience === 'string' ? parsed.audience.trim() : '';

  if (!purpose) {
    return { valid: false, error: 'Intent "purpose" is required.' };
  }

  if (!audience) {
    return { valid: false, error: 'Intent "audience" is required.' };
  }

  let mustSay = parsed.mustSay;
  if (typeof mustSay === 'string') {
    const trimmed = mustSay.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        mustSay = JSON.parse(trimmed);
      } catch (_e) {
        mustSay = [trimmed];
      }
    } else if (trimmed.includes(',')) {
      mustSay = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (trimmed) {
      mustSay = [trimmed];
    } else {
      mustSay = [];
    }
  }

  if (!Array.isArray(mustSay) || mustSay.length === 0) {
    return {
      valid: false,
      error: 'Intent "mustSay" must contain at least one required phrase or key message.',
    };
  }

  const cleanMustSay = mustSay.map((item) => String(item).trim()).filter(Boolean);
  if (cleanMustSay.length === 0) {
    return {
      valid: false,
      error: 'Intent "mustSay" must contain at least one non-empty string.',
    };
  }

  return {
    valid: true,
    intent: {
      purpose,
      audience,
      mustSay: cleanMustSay,
    },
  };
}

/**
 * Determines the draft format from uploaded file or request body.
 *
 * @param {Express.Multer.File} [file]
 * @param {string} [bodyFormat]
 * @returns {string} 'text' | 'docx' | 'pdf'
 */
function resolveDraftFormat(file, bodyFormat) {
  if (file) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf') return 'pdf';
    if (ext === '.docx') return 'docx';
    return 'text'; // .md, .markdown, .txt
  }
  if (bodyFormat && Draft.DRAFT_FORMATS.includes(bodyFormat.toLowerCase())) {
    return bodyFormat.toLowerCase();
  }
  return 'text';
}

/**
 * POST /v1/drafts
 *
 * Accepts multipart/form-data containing:
 *   - file (binary document: DOCX, PDF, MD, TXT) OR content (raw string)
 *   - intent JSON string or individual intent fields (purpose, audience, mustSay)
 *
 * Actions:
 *   1. Scans file for viruses (AV stub) and verifies allow-list formats.
 *   2. Extracts or takes content string.
 *   3. Stores uploaded binary to MinIO if file was provided.
 *   4. Computes SHA-256 contentHash.
 *   5. Executes redaction gateway against org watchlist and logs redacted terms.
 *   6. Persists Draft + initial DraftVersion (v1) in MongoDB.
 *   7. Writes immutable AuditLog event: 'draft_submitted'.
 */
router.post('/', handleDraftUpload, async (req, res, next) => {
  try {
    const orgId = req.org?._id || req.orgId;
    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'Organisation context is required to submit a draft.',
        code: 'MISSING_ORG',
      });
    }

    // 1. Validate intent form
    const intentValidation = parseAndValidateIntent(req.body);
    if (!intentValidation.valid) {
      return res.status(400).json({
        success: false,
        error: intentValidation.error,
        code: 'INVALID_INTENT',
      });
    }
    const validatedIntent = intentValidation.intent;

    // 2. Validate input content (file or body.content)
    let content = typeof req.body.content === 'string' ? req.body.content : '';
    let storageRef = null;
    let fileName = null;
    let fileSize = null;

    if (req.file) {
      fileName = req.file.originalname;
      fileSize = req.file.size;

      // Anti-virus scan verification
      try {
        await performAvScan(req.file.buffer, req.file.originalname);
      } catch (avErr) {
        return res.status(400).json({
          success: false,
          error: avErr.message || 'Anti-virus scan rejected this file.',
          code: 'AV_SCAN_FAILED',
        });
      }

      // If text-based file, extract text content if not already provided
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!content && ['.txt', '.md', '.markdown'].includes(ext)) {
        content = req.file.buffer.toString('utf-8');
      }

      // Upload binary file to MinIO object storage
      const randomSuffix = crypto.randomBytes(8).toString('hex');
      const safeBaseName = path
        .basename(req.file.originalname)
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      storageRef = `drafts/${orgId.toString()}/${Date.now()}-${randomSuffix}-${safeBaseName}`;

      try {
        await uploadObject(
          storageRef,
          req.file.buffer,
          req.file.size,
          req.file.mimetype || 'application/octet-stream'
        );
      } catch (storageErr) {
        console.error('[drafts] MinIO upload error:', storageErr);
        return res.status(502).json({
          success: false,
          error: `Failed to store draft asset in object storage: ${storageErr.message}`,
          code: 'STORAGE_UPLOAD_FAILED',
        });
      }
    }

    // Verify we have either content text or an uploaded file
    if (!content && !req.file) {
      return res.status(400).json({
        success: false,
        error: 'Draft content is required. Provide a file upload or text content.',
        code: 'MISSING_CONTENT',
      });
    }

    // If binary file (PDF/DOCX) was uploaded without explicit text content,
    // establish base content string from file buffer or metadata
    if (!content && req.file) {
      content = `[Draft Asset: ${req.file.originalname}]`;
    }

    // 3. Compute SHA-256 content hash (FR-DS-04 tamper detection)
    // If a raw file was uploaded, we hash the file buffer; otherwise we hash the content text.
    const rawDataForHash = (req.file && req.file.buffer) ? req.file.buffer : content;
    const contentHash = sha256(rawDataForHash);

    // 4. Redaction Gateway: Load org watchlist & redact matches in content copy
    const watchlist = await loadOrgWatchlist(orgId, req.org);
    const redactionResult = redactContent(content, watchlist);

    if (redactionResult.hasRedactions) {
      console.log(
        `[drafts] RedactionGateway applied to draft submission for org ${orgId}: ` +
        redactionResult.redactions.map((r) => `"${r.term}" (${r.count})`).join(', ')
      );
    }

    const format = resolveDraftFormat(req.file, req.body.format);
    const author = req.user?._id || new mongoose.Types.ObjectId();
    const title = (req.body.title && String(req.body.title).trim()) || fileName || validatedIntent.purpose;

    // 5. Persist Draft container document in MongoDB
    const draft = new Draft({
      orgId,
      author,
      status: 'draft',
      format,
      intent: validatedIntent,
      title,
      fileName,
      storageRef,
      fileSize,
      currentVersion: 1,
    });

    await draft.save();

    // 6. Persist initial DraftVersion (v1) in MongoDB
    const draftVersion = new DraftVersion({
      draftId: draft._id,
      orgId,
      versionNumber: 1,
      content,
      contentHash,
      diff: '',
      storageRef,
      author,
    });

    await draftVersion.save();

    // 7. Write immutable AuditLog event: 'draft_submitted' (FR-AP-03)
    await logEvent({
      orgId,
      actor: req.user?._id || null,
      eventType: AUDIT_EVENTS.DRAFT_SUBMITTED,
      entityType: 'draft',
      entityId: draft._id,
      metadata: {
        draftVersionId: draftVersion._id,
        versionNumber: 1,
        contentHash,
        format,
        intent: validatedIntent,
        hasFile: Boolean(req.file),
        fileName,
        fileSize,
        redactionsCount: redactionResult.totalReplacements,
      },
    });

    // 8. Generate presigned download URL if storageRef is present
    let downloadUrl = null;
    if (storageRef) {
      try {
        downloadUrl = await getPresignedUrl(storageRef, 3600);
      } catch (_ignore) {
        // Non-fatal if presign generation fails
      }
    }

    // Build structured response conforming to OpenAPI Draft schema
    const responseData = {
      ...draft.toObject(),
      currentVersion: 1,
      contentHash,
      version: draftVersion.toObject(),
      redactedContent: redactionResult.redactedContent,
      redactions: redactionResult.redactions,
    };

    if (downloadUrl) {
      responseData.downloadUrl = downloadUrl;
    }

    return res.status(201).json(responseData);
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/drafts
 *
 * Lists organisation drafts with status filtering and pagination.
 */
router.get('/', async (req, res, next) => {
  try {
    const orgId = req.org?._id || req.orgId;
    const filter = { orgId };

    if (req.query.status && Draft.DRAFT_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }

    if (req.query.format && Draft.DRAFT_FORMATS.includes(req.query.format)) {
      filter.format = req.query.format;
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [drafts, total] = await Promise.all([
      Draft.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Draft.countDocuments(filter),
    ]);

    return res.json({
      data: drafts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/drafts/:id
 *
 * Retrieves a specific draft's metadata and current status.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId = req.org?._id || req.orgId;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: `Invalid draft ID "${id}".`,
        code: 'INVALID_ID',
      });
    }

    const draft = await Draft.findOne({ _id: id, orgId }).lean();
    if (!draft) {
      return res.status(404).json({
        success: false,
        error: `Draft with ID "${id}" was not found.`,
        code: 'NOT_FOUND',
      });
    }

    // Attach latest version info
    const latestVersion = await DraftVersion.findOne({ draftId: draft._id, orgId })
      .sort({ versionNumber: -1 })
      .lean();

    if (latestVersion) {
      draft.latestVersion = latestVersion;
    }

    return res.json(draft);
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/drafts/:id/versions
 *
 * Lists all draft versions with diffs and cryptographic content hashes.
 */
router.get('/:id/versions', async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId = req.org?._id || req.orgId;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: `Invalid draft ID "${id}".`,
        code: 'INVALID_ID',
      });
    }

    const draft = await Draft.findOne({ _id: id, orgId }).lean();
    if (!draft) {
      return res.status(404).json({
        success: false,
        error: `Draft with ID "${id}" was not found.`,
        code: 'NOT_FOUND',
      });
    }

    const versions = await DraftVersion.find({ draftId: id, orgId })
      .sort({ versionNumber: 1 })
      .lean();

    return res.json({ data: versions });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
