/**
 * facts.js — Brand Knowledge Facts routes.
 *
 * Implements:
 *   POST /v1/facts — Add an approved fact with explicit owner assignment and
 *                    optional expiry date.
 *
 * Access control:
 *   - Requires authentication (JWT Bearer token).
 *   - Requires minimum role: knowledge_owner  (admins pass via RBAC hierarchy).
 *   - Multi-tenancy enforced via orgIsolation middleware; every fact is scoped
 *     to the authenticated user's orgId.
 *
 * Audit trail:
 *   - Every successful creation writes an immutable 'fact_added' AuditLog event.
 *
 * Validation:
 *   - Full server-side schema validation before any DB write.
 *   - Returns structured 422 on validation failure so clients can display
 *     field-level errors.
 */

'use strict';

const express  = require('express');
const mongoose = require('mongoose');

const Fact     = require('../models/Fact');
const { authenticate }           = require('../middleware/auth');
const { orgIsolation }           = require('../middleware/orgIsolation');
const { requireRole }            = require('../middleware/rbac');
const { logEvent, AUDIT_EVENTS } = require('../services/auditLogger');

const router = express.Router();

// ── Router-level middleware ──────────────────────────────────────────────────
// All facts endpoints require authentication and tenant boundary enforcement.
router.use(authenticate, orgIsolation);

// ── Request body validation ──────────────────────────────────────────────────

/**
 * Maximum tag count and individual tag length constraints.
 */
const MAX_TAGS      = 20;
const MAX_TAG_LEN   = 80;

/**
 * Validates the POST /v1/facts request body against the Fact schema rules.
 *
 * Required fields:
 *   label     : string (1–200 chars)
 *   statement : string (5–5000 chars)
 *
 * Optional fields:
 *   ownerId          : MongoDB ObjectId string — defaults to authenticated user
 *   category         : Fact.FACT_CATEGORIES member — defaults to 'other'
 *   status           : Fact.FACT_STATUSES member — defaults to 'active'
 *   expiresAt        : ISO 8601 datetime string — must be in the future if provided
 *   sourceRef        : string (max 500 chars)
 *   tags             : string[] (max 20 items, each max 80 chars)
 *   confidenceWeight : number [0, 1] — defaults to 1.0
 *
 * @param {object} body            - Raw request body
 * @param {string} actorUserId     - Fallback ownerId (authenticated user's _id)
 * @returns {{ valid: boolean, error?: string, code?: string, details?: object, data?: object }}
 */
function validateBody(body, actorUserId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a JSON object.', code: 'MISSING_BODY' };
  }

  const {
    label,
    statement,
    ownerId,
    category,
    status,
    expiresAt,
    sourceRef,
    tags,
    confidenceWeight,
  } = body;

  const errors = {};

  // ── label ──────────────────────────────────────────────────────────────────
  if (!label || typeof label !== 'string' || !label.trim()) {
    errors.label = 'label is required and must be a non-empty string.';
  } else if (label.trim().length > 200) {
    errors.label = 'label must be at most 200 characters.';
  }

  // ── statement ──────────────────────────────────────────────────────────────
  if (!statement || typeof statement !== 'string' || !statement.trim()) {
    errors.statement = 'statement is required and must be a non-empty string.';
  } else if (statement.trim().length < 5) {
    errors.statement = 'statement must be at least 5 characters.';
  } else if (statement.trim().length > 5000) {
    errors.statement = 'statement must be at most 5000 characters.';
  }

  // ── ownerId (optional — defaults to caller) ────────────────────────────────
  let resolvedOwnerId = actorUserId;
  if (ownerId !== undefined) {
    if (typeof ownerId !== 'string' || !mongoose.Types.ObjectId.isValid(ownerId)) {
      errors.ownerId = 'ownerId must be a valid MongoDB ObjectId string.';
    } else {
      resolvedOwnerId = ownerId;
    }
  }

  // ── category ───────────────────────────────────────────────────────────────
  let resolvedCategory = 'other';
  if (category !== undefined) {
    if (typeof category !== 'string' || !Fact.FACT_CATEGORIES.includes(category.trim().toLowerCase())) {
      errors.category = `category must be one of: ${Fact.FACT_CATEGORIES.join(', ')}.`;
    } else {
      resolvedCategory = category.trim().toLowerCase();
    }
  }

  // ── status ─────────────────────────────────────────────────────────────────
  let resolvedStatus = 'active';
  if (status !== undefined) {
    if (typeof status !== 'string' || !Fact.FACT_STATUSES.includes(status.trim().toLowerCase())) {
      errors.status = `status must be one of: ${Fact.FACT_STATUSES.join(', ')}.`;
    } else {
      resolvedStatus = status.trim().toLowerCase();
    }
  }

  // ── expiresAt (optional — must be a future date if provided) ───────────────
  let resolvedExpiresAt = null;
  if (expiresAt !== undefined && expiresAt !== null) {
    const parsed = new Date(expiresAt);
    if (isNaN(parsed.getTime())) {
      errors.expiresAt = 'expiresAt must be a valid ISO 8601 date string.';
    } else if (parsed <= new Date()) {
      errors.expiresAt = 'expiresAt must be a date in the future.';
    } else {
      resolvedExpiresAt = parsed;
    }
  }

  // ── sourceRef (optional) ───────────────────────────────────────────────────
  let resolvedSourceRef = null;
  if (sourceRef !== undefined && sourceRef !== null) {
    if (typeof sourceRef !== 'string') {
      errors.sourceRef = 'sourceRef must be a string.';
    } else if (sourceRef.trim().length > 500) {
      errors.sourceRef = 'sourceRef must be at most 500 characters.';
    } else {
      resolvedSourceRef = sourceRef.trim() || null;
    }
  }

  // ── tags (optional) ────────────────────────────────────────────────────────
  let resolvedTags = [];
  if (tags !== undefined) {
    if (!Array.isArray(tags)) {
      errors.tags = 'tags must be an array of strings.';
    } else if (tags.length > MAX_TAGS) {
      errors.tags = `tags may contain at most ${MAX_TAGS} items.`;
    } else {
      const invalidTags = [];
      const cleanedTags = [];

      for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        if (typeof t !== 'string') {
          invalidTags.push(`tags[${i}]: must be a string`);
        } else if (t.trim().length > MAX_TAG_LEN) {
          invalidTags.push(`tags[${i}]: must be at most ${MAX_TAG_LEN} characters`);
        } else if (t.trim()) {
          cleanedTags.push(t.trim());
        }
      }

      if (invalidTags.length > 0) {
        errors.tags = invalidTags.join('; ');
      } else {
        // Deduplicate tags
        resolvedTags = [...new Set(cleanedTags)];
      }
    }
  }

  // ── confidenceWeight (optional) ────────────────────────────────────────────
  let resolvedConfidenceWeight = 1.0;
  if (confidenceWeight !== undefined) {
    if (typeof confidenceWeight !== 'number' || isNaN(confidenceWeight)) {
      errors.confidenceWeight = 'confidenceWeight must be a number.';
    } else if (confidenceWeight < 0 || confidenceWeight > 1) {
      errors.confidenceWeight = 'confidenceWeight must be between 0 and 1 (inclusive).';
    } else {
      resolvedConfidenceWeight = confidenceWeight;
    }
  }

  // ── Collect errors ─────────────────────────────────────────────────────────
  if (Object.keys(errors).length > 0) {
    return {
      valid   : false,
      error   : 'Request body failed validation.',
      code    : 'VALIDATION_ERROR',
      details : errors,
    };
  }

  return {
    valid : true,
    data  : {
      label            : label.trim(),
      statement        : statement.trim(),
      ownerId          : resolvedOwnerId,
      category         : resolvedCategory,
      status           : resolvedStatus,
      expiresAt        : resolvedExpiresAt,
      sourceRef        : resolvedSourceRef,
      tags             : resolvedTags,
      confidenceWeight : resolvedConfidenceWeight,
    },
  };
}

// ── POST /v1/facts ────────────────────────────────────────────────────────────

/**
 * POST /v1/facts
 *
 * Creates a new approved brand knowledge fact.
 *
 * Request body (JSON):
 *   Required:
 *     label     {string}  — Human-readable title
 *     statement {string}  — Approved brand statement (5–5000 chars)
 *
 *   Optional:
 *     ownerId          {ObjectId string} — Defaults to the authenticated user
 *     category         {string}          — Fact.FACT_CATEGORIES (default 'other')
 *     status           {string}          — Fact.FACT_STATUSES (default 'active')
 *     expiresAt        {ISO date string} — Must be a future date
 *     sourceRef        {string}          — Citation / source document reference
 *     tags             {string[]}        — Up to 20 tags (each max 80 chars)
 *     confidenceWeight {number}          — 0.0–1.0 (default 1.0)
 *
 * Response 201:
 *   { success: true, fact: FactDocument }
 *
 * Side-effects:
 *   - Writes a 'fact_added' AuditLog event.
 *
 * Minimum required role: knowledge_owner
 */
router.post(
  '/',
  requireRole('knowledge_owner', 'admin'),
  async (req, res, next) => {
    try {
      const orgId     = req.org?._id || req.orgId;
      const actorId   = req.user?._id;

      // ── 1. Validate request body ────────────────────────────────────────────
      const validation = validateBody(req.body, actorId?.toString());

      if (!validation.valid) {
        return res.status(400).json({
          success : false,
          error   : validation.error,
          code    : validation.code,
          details : validation.details || undefined,
        });
      }

      const {
        label,
        statement,
        ownerId,
        category,
        status,
        expiresAt,
        sourceRef,
        tags,
        confidenceWeight,
      } = validation.data;

      // ── 2. Create and persist the Fact document ─────────────────────────────
      const fact = new Fact({
        orgId,
        ownerId,
        label,
        statement,
        category,
        status,
        expiresAt,
        sourceRef,
        tags,
        confidenceWeight,
      });

      await fact.save();

      // ── 3. Write AuditLog event: 'fact_added' ───────────────────────────────
      try {
        await logEvent({
          orgId,
          actor      : actorId,
          eventType  : AUDIT_EVENTS.FACT_ADDED,
          entityType : 'fact',
          entityId   : fact._id,
          metadata   : {
            label,
            category,
            status,
            ownerId  : ownerId.toString(),
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
            tagCount : tags.length,
            confidenceWeight,
          },
        });
      } catch (auditErr) {
        // Audit failure must not roll back the fact creation.
        console.error('[facts] AuditLog write failed for fact_added:', auditErr.message);
      }

      // ── 4. Return created fact ──────────────────────────────────────────────
      return res.status(201).json({
        success : true,
        fact    : fact.toObject(),
      });
    } catch (err) {
      // Mongoose schema validation errors (belt-and-suspenders fallback)
      if (err.name === 'ValidationError') {
        const details = Object.fromEntries(
          Object.entries(err.errors).map(([k, v]) => [k, v.message])
        );
        return res.status(422).json({
          success : false,
          error   : 'Fact validation failed.',
          code    : 'VALIDATION_ERROR',
          details,
        });
      }
      return next(err);
    }
  }
);

/**
 * GET /v1/facts
 *
 * Lists approved brand facts for the organisation with optional pagination.
 */
router.get('/', async (req, res, next) => {
  try {
    const orgId = req.org?._id || req.orgId;
    const page  = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const skip  = (page - 1) * limit;

    const filter = { orgId };
    if (req.query.status) {
      filter.status = req.query.status;
    }
    if (req.query.category) {
      filter.category = req.query.category;
    }

    const [facts, total] = await Promise.all([
      Fact.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Fact.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: facts,
      total,
      page,
      limit,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
