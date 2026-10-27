/**
 * drafts.js — Draft content management routes.
 *
 * Implements Block 3 & OpenAPI Drafts Specification:
 *   POST /v1/drafts              — Submit a new draft with intent form (multipart or JSON)
 *   GET  /v1/drafts              — List organisation drafts with pagination & filtering
 *   GET  /v1/drafts/:id          — Get draft metadata and current status
 *   GET  /v1/drafts/:id/versions — List all version revisions of a draft with SHA-256 hashes
 *   POST /v1/drafts/:id/review   — Trigger ML review pipeline; persist findings; write AuditLog
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const multer = require('multer');

const Draft = require('../models/Draft');
const DraftVersion = require('../models/DraftVersion');
const Finding = require('../models/Finding');
const Comment = require('../models/Comment');
const Passport = require('../models/Passport');
const { authenticate } = require('../middleware/auth');
const { orgIsolation } = require('../middleware/orgIsolation');
const { requireRole, hasRole } = require('../middleware/rbac');
const { performAvScan, MAX_FILE_SIZE } = require('../middleware/uploadScan');
const { redactContent, loadOrgWatchlist } = require('../middleware/redactionGateway');
const { sha256 } = require('../utils/hash');
const { logEvent, logEventSafe, AUDIT_EVENTS } = require('../services/auditLogger');
const { uploadObject, getPresignedUrl } = require('../utils/minio');
const { extractClaims } = require('../services/mlOrchestrator');
const { buildPassport } = require('../services/passportBuilder');
const { resolveFindingEvidence } = require('../services/findingEvidence');
const { getVersions, createDraftVersionOnAcceptedFix } = require('../services/versionManager');
const { checkClaimShelfLife, determineReviewRouting } = require('../services/workflowEngine');

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

    const versions = await getVersions(id, orgId);

    return res.json({ success: true, data: versions, versions });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/drafts/:id/passport
 *
 * Retrieves the Brand Passport record associated with an approved draft.
 */
router.get('/:id/passport', async (req, res, next) => {
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

    const passport = await Passport.findOne({ draftId: id, orgId })
      .populate('approvers', 'name email role')
      .sort({ timestamp: -1 })
      .lean();

    if (!passport) {
      return res.status(404).json({
        success: false,
        error: `Brand Passport was not found for draft "${id}".`,
        code: 'NOT_FOUND',
      });
    }

    return res.json(passport);
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/drafts/:id/findings
 *
 * Lists all compliance findings for a draft, scoped to the authenticated
 * user's organisation.
 *
 * Query parameters:
 *   page    {number}  — 1-indexed page number (default: 1)
 *   limit   {number}  — Records per page, 1–100 (default: 20)
 *   status  {string}  — Filter by finding status (open|accepted|edited|dismissed|escalated)
 *   verdict {string}  — Filter by ML verdict
 *   type    {string}  — Filter by finding type (violation|question)
 *
 * Returns: { data, pagination: { page, limit, total, totalPages } }
 */
router.get('/:id/findings', async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId  = req.org?._id || req.orgId;

    // ── 1. Validate draft ID ────────────────────────────────────────────────
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success : false,
        error   : `Invalid draft ID "${id}".`,
        code    : 'INVALID_ID',
      });
    }

    // ── 2. Verify draft exists and belongs to this org ──────────────────────
    const draft = await Draft.findOne({ _id: id, orgId }).lean();
    if (!draft) {
      return res.status(404).json({
        success : false,
        error   : `Draft "${id}" was not found in your organisation.`,
        code    : 'DRAFT_NOT_FOUND',
      });
    }

    // ── 3. Build orgId-scoped filter ────────────────────────────────────────
    const filter = { orgId, draftId: id };

    if (req.query.status && Finding.FINDING_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }

    if (req.query.verdict && Finding.FINDING_VERDICTS.includes(req.query.verdict)) {
      filter.verdict = req.query.verdict;
    }

    if (req.query.type && Finding.FINDING_TYPES.includes(req.query.type)) {
      filter.type = req.query.type;
    }

    // ── 4. Pagination params ────────────────────────────────────────────────
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip  = (page - 1) * limit;

    // ── 5. Query findings ───────────────────────────────────────────────────
    const [findings, total] = await Promise.all([
      Finding.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Finding.countDocuments(filter),
    ]);

    return res.json({
      data       : findings,
      pagination : {
        page,
        limit,
        total,
        totalPages : Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /v1/drafts/redaction-preview
 *
 * Previews what content (after redaction) would be sent before any external ML call.
 * Accepts { content } or { draftContent } in request body.
 */
router.post('/redaction-preview', async (req, res, next) => {
  try {
    const orgId = req.org?._id || req.orgId || req.user?.orgId;
    const content = req.body?.content || req.body?.draftContent || req.draftContent || '';

    const watchlist = await loadOrgWatchlist(orgId, req.org);
    const result = redactContent(content, watchlist);

    return res.status(200).json({
      success: true,
      data: {
        original: result.original,
        redactedContent: result.redactedContent,
        hasRedactions: result.hasRedactions,
        totalReplacements: result.totalReplacements,
        redactions: result.redactions,
        whatWasRemoved: result.redactions.map((r) => ({
          term: r.term,
          count: r.count,
          category: 'confidential_watchlist',
          replacement: '[REDACTED]',
        })),
        provider: {
          name: 'BrandGuard ML Service / External LLM',
          type: 'Language Model Inference',
          destination: 'External Review Service',
        },
        rulesOnlyRecommended: result.hasRedactions,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Helper to generate redaction preview for a specific draft ID.
 */
async function getDraftRedactionPreview(req, res, next) {
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
        error: `Draft "${id}" was not found in your organisation.`,
        code: 'DRAFT_NOT_FOUND',
      });
    }

    let content = req.body?.content;
    if (typeof content !== 'string') {
      const draftVersion = await DraftVersion.findOne({ draftId: draft._id, orgId })
        .sort({ versionNumber: -1 })
        .lean();
      content = draftVersion?.content || '';
    }

    const watchlist = await loadOrgWatchlist(orgId, req.org);
    const result = redactContent(content, watchlist);

    return res.status(200).json({
      success: true,
      data: {
        draftId: id,
        original: result.original,
        redactedContent: result.redactedContent,
        hasRedactions: result.hasRedactions,
        totalReplacements: result.totalReplacements,
        redactions: result.redactions,
        whatWasRemoved: result.redactions.map((r) => ({
          term: r.term,
          count: r.count,
          category: 'confidential_watchlist',
          replacement: '[REDACTED]',
        })),
        provider: {
          name: 'BrandGuard ML Service / External LLM',
          type: 'Language Model Inference',
          destination: 'External Review Service',
        },
        rulesOnlyRecommended: result.hasRedactions,
      },
    });
  } catch (err) {
    return next(err);
  }
}

router.get('/:id/redaction-preview', getDraftRedactionPreview);
router.post('/:id/redaction-preview', getDraftRedactionPreview);

/**
 * POST /v1/drafts/:id/review
 *
 * Triggers the ML compliance review pipeline for a submitted draft.
 *
 * Pipeline:
 *   1. Validate and resolve the draft (orgId-scoped, must exist).
 *   2. Load the latest DraftVersion — this is what the ML analyses.
 *   3. Load the org watchlist and run redaction gateway on version content.
 *      Only the redacted content is forwarded to ML (never raw text).
 *   4. Call mlOrchestrator.extractClaims() → POST ML_SERVICE_URL/extract-claims.
 *      - Enforces configurable timeout (ML_TIMEOUT_MS, default 30 s).
 *      - Validates response schema; writes ml_response_discarded on failure.
 *   5. Bulk-insert validated claims as Finding documents in MongoDB.
 *      Each Finding is orgId-scoped and tied to the draftVersionId.
 *   6. Update Draft status: 'draft' → 'checked'.
 *   7. Write immutable AuditLog event: 'review_completed'.
 *   8. Return summary: { draftId, draftVersionId, findingsCount, findings[] }.
 *
 * Error handling:
 *   - ML timeout / network: 502 Bad Gateway.
 *   - ML schema invalid: 502 Bad Gateway (with ml_response_discarded audit).
 *   - ML not configured: 503 Service Unavailable.
 *   - Draft not found: 404.
 *   - MongoDB errors: propagated to error handler middleware.
 */
router.post('/:id/review', async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId  = req.org?._id || req.orgId;
    const actor  = req.user?._id || null;

    // ── 1. Validate draft ID ────────────────────────────────────────────────
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success : false,
        error   : `Invalid draft ID "${id}".`,
        code    : 'INVALID_ID',
      });
    }

    // ── 2. Load draft (orgId-scoped) ────────────────────────────────────────
    const draft = await Draft.findOne({ _id: id, orgId });
    if (!draft) {
      return res.status(404).json({
        success : false,
        error   : `Draft "${id}" was not found in your organisation.`,
        code    : 'DRAFT_NOT_FOUND',
      });
    }

    // ── 3. Load latest DraftVersion ─────────────────────────────────────────
    const draftVersion = await DraftVersion.findOne({ draftId: draft._id, orgId })
      .sort({ versionNumber: -1 })
      .lean();

    if (!draftVersion) {
      return res.status(409).json({
        success : false,
        error   : 'Draft has no content version to review. Submit content first.',
        code    : 'NO_VERSION',
      });
    }

    // ── 4. Redaction gateway — strip confidential terms before ML call ───────
    const watchlist       = await loadOrgWatchlist(orgId, req.org);
    const redactionResult = redactContent(draftVersion.content || '', watchlist);

    if (redactionResult.hasRedactions) {
      console.log(
        `[drafts/review] Redacted ${redactionResult.totalReplacements} term(s) before ML call` +
        ` for draft ${id} / org ${orgId}`
      );
    }

    // ── Check if organisation has rules_only enabled ─────────────────────────
    const Org = require('../models/Org');
    let isRulesOnly = Boolean(
      req.org?.settings?.rules_only ||
      req.org?.rules_only ||
      req.body?.rulesOnly
    );

    if (!isRulesOnly && orgId) {
      try {
        const orgDoc = await Org.findById(orgId).select('settings').lean();
        if (orgDoc?.settings?.rules_only) {
          isRulesOnly = true;
        }
      } catch (_e) {}
    }

    // ── 5. Call ML Orchestrator ─────────────────────────────────────────────
    let claims;
    try {
      claims = await extractClaims({
        redactedContent : redactionResult.redactedContent,
        orgId           : orgId.toString(),
        intent          : draft.intent,
        draftId         : draft._id,
        actor,
        rulesOnly       : isRulesOnly,
      });
    } catch (mlErr) {
      const mlCode = mlErr.code || 'ML_ERROR';

      // ML not configured — operator error, not transient
      if (mlCode === 'ML_URL_NOT_CONFIGURED') {
        return res.status(503).json({
          success : false,
          error   : 'ML service is not configured. Contact the system administrator.',
          code    : mlCode,
        });
      }

      // Timeout, network, schema failures — transient / ML-side
      return res.status(502).json({
        success : false,
        error   : `ML service call failed: ${mlErr.message}`,
        code    : mlCode,
      });
    }

    // ── 6. Bulk-insert Finding documents (orgId-scoped) ─────────────────────
    let savedFindings = [];
    let findingDocs = [];

    if (claims.length > 0) {
      findingDocs = await Promise.all(claims.map(async (claim) => {
        const resolved = await resolveFindingEvidence({ claim, orgId });
        return {
          orgId          : orgId,
          draftId        : draft._id,
          draftVersionId : draftVersion._id,
          span           : {
            start : claim.span.start,
            end   : claim.span.end,
          },
          type           : resolved.proofPassageId ? claim.type : 'question',
          verdict        : claim.verdict,
          confidence     : claim.confidence,
          suggestedFix   : claim.suggestedFix   || null,
          ruleId         : claim.ruleId         || null,
          meaningCheck   : claim.meaningCheck   || null,
          explanation    : claim.explanation    || null,
          evidence       : resolved.evidence,
          proofPassageId : resolved.proofPassageId,
          status         : 'open',
        };
      }));
    }

    // ── 6b. Claim Shelf-Life logic (workflowEngine.js) ───────────────────────
    // At review time check all retrieved passage expiry dates; if expired, create additional Finding with verdict = Outdated.
    const shelfLifeFindings = await checkClaimShelfLife({
      claims,
      passages: req.body?.passages || [],
      draftId: draft._id,
      draftVersionId: draftVersion._id,
      orgId,
    });

    const allFindings = [...findingDocs, ...shelfLifeFindings];
    if (allFindings.length > 0) {
      savedFindings = await Finding.insertMany(allFindings, { ordered: false });
    }

    // ── 7. Update draft status: draft → checked ──────────────────────────────
    draft.status = 'checked';
    await draft.save();

    // ── 8. Write review_completed AuditLog event ────────────────────────────
    await logEventSafe({
      orgId,
      actor,
      eventType  : AUDIT_EVENTS.REVIEW_COMPLETED,
      entityType : 'draft',
      entityId   : draft._id,
      metadata   : {
        draftVersionId     : draftVersion._id,
        versionNumber      : draftVersion.versionNumber,
        findingsCount      : savedFindings.length,
        verdictSummary     : summariseVerdicts(savedFindings),
        hasRedactions      : redactionResult.hasRedactions,
        redactionsCount    : redactionResult.totalReplacements,
        mlServiceUrl       : (process.env.ML_SERVICE_URL || '').replace(/\/$/, ''),
      },
    });

    // ── 9. Return review summary ─────────────────────────────────────────────
    return res.status(200).json({
      success        : true,
      draftId        : draft._id,
      draftVersionId : draftVersion._id,
      status         : draft.status,
      findingsCount  : savedFindings.length,
      findings       : savedFindings.map((f) => f.toObject ? f.toObject() : f),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Produces a compact verdict distribution summary for audit metadata.
 *
 * @param {Array<object>} findings
 * @returns {object} e.g. { Supported: 2, Contradicted: 1, Unclear: 1 }
 */
function summariseVerdicts(findings) {
  return findings.reduce((acc, f) => {
    const v = f.verdict || 'Unknown';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
}

// ── Collaboration & Approval Endpoints ────────────────────────────────────────

/**
 * POST /v1/drafts/:id/comments
 *
 * Adds a threaded comment or workflow action (comment, approve, request-changes, override)
 * to a draft, scoped to the caller's organisation.
 *
 * Body parameters:
 *   - text: string (required)
 *   - action: string ('comment' | 'approve' | 'request-changes' | 'override') (optional, default 'comment')
 *   - findingId: ObjectId (optional)
 *   - reason: string (required if action === 'override')
 *   - commentId / parentCommentId: ObjectId (optional, appends reply to existing comment thread)
 *
 * Side-effect:
 *   Emits AuditLog event 'comment_added'.
 */
router.post('/:id/comments', async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId = req.org?._id || req.orgId;
    const actor = req.user;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: `Invalid draft ID "${id}".`,
        code: 'INVALID_ID',
      });
    }

    const draft = await Draft.findOne({ _id: id, orgId });
    if (!draft) {
      return res.status(404).json({
        success: false,
        error: `Draft "${id}" was not found in your organisation.`,
        code: 'DRAFT_NOT_FOUND',
      });
    }

    const {
      text,
      action = 'comment',
      findingId = null,
      reason = null,
      commentId,
      parentCommentId,
    } = req.body || {};

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Comment text is required and cannot be empty.',
        code: 'MISSING_TEXT',
      });
    }

    const trimmedText = text.trim();
    const allowedActions = Comment.COMMENT_ACTIONS;
    const normalisedAction = action ? String(action).trim().toLowerCase() : 'comment';

    if (!allowedActions.includes(normalisedAction)) {
      return res.status(400).json({
        success: false,
        error: `Action "${action}" is invalid. Allowed actions: ${allowedActions.join(', ')}.`,
        code: 'INVALID_ACTION',
      });
    }

    if (normalisedAction === 'approve' && !hasRole(actor?.role, 'manager')) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Insufficient privileges. Only managers can record approval actions.',
        code: 'ROLE_INSUFFICIENT',
        requiredRoles: ['manager'],
        userRole: actor?.role,
      });
    }

    if (normalisedAction === 'override' && !hasRole(actor?.role, ['reviewer', 'manager'])) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Insufficient privileges. Only reviewers or managers can record override actions.',
        code: 'ROLE_INSUFFICIENT',
        requiredRoles: ['reviewer', 'manager'],
        userRole: actor?.role,
      });
    }

    if (normalisedAction === 'override' && (!reason || !String(reason).trim())) {
      return res.status(400).json({
        success: false,
        error: 'A reason is required when action is "override".',
        code: 'REASON_REQUIRED',
      });
    }

    if (findingId) {
      if (!mongoose.Types.ObjectId.isValid(findingId)) {
        return res.status(400).json({
          success: false,
          error: `Invalid finding ID "${findingId}".`,
          code: 'INVALID_FINDING_ID',
        });
      }
      const existingFinding = await Finding.findOne({ _id: findingId, orgId, draftId: draft._id });
      if (!existingFinding) {
        return res.status(404).json({
          success: false,
          error: `Finding "${findingId}" was not found for this draft in your organisation.`,
          code: 'FINDING_NOT_FOUND',
        });
      }
    }

    const targetCommentId = commentId || parentCommentId;
    let commentDoc;

    const threadEntry = {
      author: actor?._id,
      authorName: actor?.name || 'User',
      authorRole: actor?.role || 'reviewer',
      text: trimmedText,
      timestamp: new Date(),
    };

    if (targetCommentId) {
      if (!mongoose.Types.ObjectId.isValid(targetCommentId)) {
        return res.status(400).json({
          success: false,
          error: `Invalid comment ID "${targetCommentId}".`,
          code: 'INVALID_COMMENT_ID',
        });
      }

      commentDoc = await Comment.findOne({
        _id: targetCommentId,
        draftId: draft._id,
        orgId,
      });

      if (!commentDoc) {
        return res.status(404).json({
          success: false,
          error: `Comment thread "${targetCommentId}" not found.`,
          code: 'COMMENT_NOT_FOUND',
        });
      }

      commentDoc.thread.push(threadEntry);
      commentDoc.updatedAt = new Date();
      await commentDoc.save();
    } else {
      commentDoc = new Comment({
        orgId,
        draftId: draft._id,
        findingId: findingId || null,
        action: normalisedAction,
        type: normalisedAction === 'approve'
          ? 'approved'
          : normalisedAction === 'request-changes'
          ? 'changes-requested'
          : normalisedAction,
        author: actor?._id,
        authorName: actor?.name || 'User',
        authorRole: actor?.role || 'reviewer',
        text: trimmedText,
        reason: reason ? String(reason).trim() : null,
        thread: [threadEntry],
        createdAt: new Date(),
      });
      await commentDoc.save();
    }

    // Write AuditLog: comment_added
    await logEventSafe({
      orgId,
      actor,
      eventType: AUDIT_EVENTS.COMMENT_ADDED,
      entityType: 'comment',
      entityId: commentDoc._id,
      metadata: {
        draftId: draft._id,
        findingId: findingId || null,
        action: commentDoc.action,
        commentId: commentDoc._id,
        threadLength: commentDoc.thread.length,
      },
    });

    const populated = await Comment.findById(commentDoc._id)
      .populate('author', 'name email role')
      .populate('thread.author', 'name email role')
      .lean();

    return res.status(201).json({
      success: true,
      ...populated,
      data: populated,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/drafts/:id/comments
 *
 * Lists all threaded comments for a draft, scoped to the caller's organisation.
 * Supports optional filtering by `findingId`.
 */
router.get('/:id/comments', async (req, res, next) => {
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
        error: `Draft "${id}" was not found in your organisation.`,
        code: 'DRAFT_NOT_FOUND',
      });
    }

    const filter = { draftId: draft._id, orgId };
    if (req.query.findingId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.findingId)) {
        return res.status(400).json({
          success: false,
          error: `Invalid finding ID "${req.query.findingId}".`,
          code: 'INVALID_FINDING_ID',
        });
      }
      filter.findingId = req.query.findingId;
    }

    const comments = await Comment.find(filter)
      .sort({ createdAt: 1 })
      .populate('author', 'name email role')
      .populate('thread.author', 'name email role')
      .lean();

    const mapped = comments.map((c) => ({
      ...c,
      authorName: c.authorName || c.author?.name || 'User',
      authorRole: c.authorRole || c.author?.role || 'reviewer',
      type: c.type || (c.action === 'approve' ? 'approved' : c.action === 'request-changes' ? 'changes-requested' : c.action || 'comment'),
      text: c.text || (c.thread?.[0]?.text ?? ''),
    }));

    return res.json({
      success: true,
      data: mapped,
      count: mapped.length,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /v1/drafts/:id/approve
 *
 * Approves a draft, increments and creates a new DraftVersion, triggers passportBuilder,
 * sets draft status to 'approved', and writes AuditLog event 'draft_approved'.
 *
 * RBAC: Manager role required (manager, brand_manager, admin, owner).
 */
router.post(
  '/:id/approve',
  requireRole('manager'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const orgId = req.org?._id || req.orgId;
      const actor = req.user;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          error: `Invalid draft ID "${id}".`,
          code: 'INVALID_ID',
        });
      }

      const draft = await Draft.findOne({ _id: id, orgId });
      if (!draft) {
        return res.status(404).json({
          success: false,
          error: `Draft "${id}" was not found in your organisation.`,
          code: 'DRAFT_NOT_FOUND',
        });
      }

      // Check for open / unresolved findings
      const openFindingsCount = await Finding.countDocuments({
        draftId: draft._id,
        orgId,
        status: 'open',
      });

      if (openFindingsCount > 0) {
        return res.status(409).json({
          success: false,
          error: `Open findings must be resolved before approval. Found ${openFindingsCount} open finding(s).`,
          code: 'OPEN_FINDINGS_EXIST',
          openFindingsCount,
        });
      }

      // Retrieve latest DraftVersion to base approved version upon
      const latestVersion = await DraftVersion.findOne({ draftId: draft._id, orgId })
        .sort({ versionNumber: -1 });

      const currentVersionNum = latestVersion ? latestVersion.versionNumber : (draft.currentVersion || 1);
      const nextVersionNum = currentVersionNum + 1;

      // Extract approved content (from body or fallback to latest version's content)
      const approvedContent =
        req.body?.content !== undefined
          ? String(req.body.content)
          : req.body?.approvedContent !== undefined
          ? String(req.body.approvedContent)
          : (latestVersion?.content || '');

      const contentHash = sha256(approvedContent);

      // Create new DraftVersion representing the approved revision
      const newDraftVersion = new DraftVersion({
        draftId: draft._id,
        orgId,
        versionNumber: nextVersionNum,
        content: approvedContent,
        contentHash,
        diff: latestVersion ? `Approved version v${nextVersionNum}` : '',
        author: actor?._id || null,
        createdAt: new Date(),
      });
      await newDraftVersion.save();

      // Update draft status and currentVersion
      draft.status = 'approved';
      draft.currentVersion = nextVersionNum;
      await draft.save();

      // Trigger passportBuilder
      const passport = await buildPassport({
        orgId,
        draftId: draft._id,
        draftVersionId: newDraftVersion._id,
        content: approvedContent,
        contentHash,
        checksRun: req.body?.checksRun || ['claim_match', 'contradiction', 'rules', 'premortem'],
        rulesVersion: req.body?.rulesVersion || process.env.RULES_VERSION || 'v1.2',
        approverId: actor?._id,
        aiUsed: req.body?.aiUsed !== undefined ? req.body.aiUsed : true,
      });

      // Record AuditLog: draft_approved
      await logEventSafe({
        orgId,
        actor,
        eventType: AUDIT_EVENTS.DRAFT_APPROVED,
        entityType: 'draft',
        entityId: draft._id,
        metadata: {
          draftVersionId: newDraftVersion._id,
          versionNumber: nextVersionNum,
          passportId: passport._id,
          contentHash,
        },
      });

      // Record AuditLog: passport_created
      await logEventSafe({
        orgId,
        actor,
        eventType: AUDIT_EVENTS.PASSPORT_CREATED,
        entityType: 'passport',
        entityId: passport._id,
        metadata: {
          draftId: draft._id,
          draftVersionId: newDraftVersion._id,
          contentHash,
          rulesVersion: passport.rulesVersion,
          approvers: passport.approvers,
        },
      });

      // Also record approval action in Comment collection for threaded collaboration history
      try {
        const approvalCommentText = req.body?.comment || `${actor?.name || 'Manager'} approved this draft.`;
        const approvalComment = new Comment({
          orgId,
          draftId: draft._id,
          action: 'approve',
          type: 'approved',
          author: actor?._id || draft.author,
          authorName: actor?.name || 'Manager',
          authorRole: actor?.role || 'manager',
          text: approvalCommentText,
          thread: [
            {
              author: actor?._id || draft.author,
              authorName: actor?.name || 'Manager',
              authorRole: actor?.role || 'manager',
              text: approvalCommentText,
              timestamp: new Date(),
            },
          ],
          createdAt: new Date(),
        });
        await approvalComment.save();
      } catch (commErr) {
        console.warn('[drafts] Approval comment recording skipped:', commErr.message);
      }

      return res.status(200).json({
        success: true,
        draft: draft.toObject(),
        passport: passport.toObject(),
        version: newDraftVersion.toObject(),
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /v1/drafts/:id/request-changes
 *
 * Sends a draft back to the creator with revision requests.
 * Sets draft status back to 'draft' and emits AuditLog event 'changes_requested'.
 *
 * RBAC: Manager role required.
 */
router.post(
  '/:id/request-changes',
  requireRole('manager'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const orgId = req.org?._id || req.orgId;
      const actor = req.user;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          error: `Invalid draft ID "${id}".`,
          code: 'INVALID_ID',
        });
      }

      const draft = await Draft.findOne({ _id: id, orgId });
      if (!draft) {
        return res.status(404).json({
          success: false,
          error: `Draft "${id}" was not found in your organisation.`,
          code: 'DRAFT_NOT_FOUND',
        });
      }

      const reason = req.body?.reason || req.body?.text || 'Changes requested by reviewer.';

      draft.status = 'draft';
      await draft.save();

      const changeComment = new Comment({
        orgId,
        draftId: draft._id,
        action: 'request-changes',
        type: 'changes-requested',
        author: actor?._id || draft.author,
        authorName: actor?.name || 'Manager',
        authorRole: actor?.role || 'manager',
        text: reason,
        thread: [
          {
            author: actor?._id || draft.author,
            authorName: actor?.name || 'Manager',
            authorRole: actor?.role || 'manager',
            text: reason,
            timestamp: new Date(),
          },
        ],
        createdAt: new Date(),
      });
      await changeComment.save();

      await logEventSafe({
        orgId,
        actor,
        eventType: AUDIT_EVENTS.CHANGES_REQUESTED,
        entityType: 'draft',
        entityId: draft._id,
        metadata: {
          reason,
          commentId: changeComment._id,
        },
      });

      return res.status(200).json({
        success: true,
        draft: draft.toObject(),
        comment: changeComment.toObject(),
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /v1/drafts/:id/override
 *
 * Records a finding or draft override with a mandatory written reason.
 * Emits AuditLog event 'finding_overridden'.
 *
 * RBAC: Manager / Reviewer role required.
 */
router.post(
  '/:id/override',
  requireRole('reviewer', 'manager'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const orgId = req.org?._id || req.orgId;
      const actor = req.user;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          error: `Invalid draft ID "${id}".`,
          code: 'INVALID_ID',
        });
      }

      const draft = await Draft.findOne({ _id: id, orgId });
      if (!draft) {
        return res.status(404).json({
          success: false,
          error: `Draft "${id}" was not found in your organisation.`,
          code: 'DRAFT_NOT_FOUND',
        });
      }

      const reason = req.body?.reason || req.body?.text;
      if (!reason || !String(reason).trim()) {
        return res.status(400).json({
          success: false,
          error: 'A reason is required when overriding a finding.',
          code: 'REASON_REQUIRED',
        });
      }

      const findingId = req.body?.findingId;
      let findingDoc = null;
      if (findingId && mongoose.Types.ObjectId.isValid(findingId)) {
        findingDoc = await Finding.findOne({ _id: findingId, orgId });
        if (findingDoc && findingDoc.status === 'open') {
          findingDoc.status = 'dismissed';
          await findingDoc.save();
        }
      }

      const trimmedReason = String(reason).trim();
      const overrideComment = new Comment({
        orgId,
        draftId: draft._id,
        findingId: findingDoc?._id || (findingId && mongoose.Types.ObjectId.isValid(findingId) ? findingId : null),
        action: 'override',
        type: 'override',
        author: actor?._id || draft.author,
        authorName: actor?.name || 'Reviewer',
        authorRole: actor?.role || 'reviewer',
        text: trimmedReason,
        reason: trimmedReason,
        thread: [
          {
            author: actor?._id || draft.author,
            authorName: actor?.name || 'Reviewer',
            authorRole: actor?.role || 'reviewer',
            text: trimmedReason,
            timestamp: new Date(),
          },
        ],
        createdAt: new Date(),
      });
      await overrideComment.save();

      await logEventSafe({
        orgId,
        actor,
        eventType: AUDIT_EVENTS.FINDING_OVERRIDDEN,
        entityType: 'finding',
        entityId: findingDoc?._id || draft._id,
        metadata: {
          draftId: draft._id,
          findingId: findingDoc?._id || null,
          ruleId: findingDoc?.ruleId || null,
          reason: trimmedReason,
          commentId: overrideComment._id,
        },
      });

      return res.status(200).json({
        success: true,
        comment: overrideComment.toObject(),
        finding: findingDoc ? findingDoc.toObject() : null,
      });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;

