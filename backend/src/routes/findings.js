/**
 * findings.js — Finding action routes.
 *
 * Implements:
 *   PATCH /v1/findings/:id — Action a finding (accept / edit / dismiss / escalate)
 *
 * Status transition matrix (from → [allowed to]):
 *   open       → accepted | edited | dismissed | escalated
 *   escalated  → accepted | edited | dismissed
 *   accepted   → (terminal — no further transitions)
 *   edited     → (terminal — no further transitions)
 *   dismissed  → (terminal — no further transitions)
 *
 * Multi-tenancy: all queries are scoped by orgId (enforced via authenticate +
 *   orgIsolation middleware mounted globally on this router).
 *
 * Roles: reviewer, brand_manager, admin (creator/viewer cannot action findings).
 */

'use strict';

const express  = require('express');
const mongoose = require('mongoose');

const Finding  = require('../models/Finding');
const { authenticate }              = require('../middleware/auth');
const { orgIsolation }              = require('../middleware/orgIsolation');
const { requireRole }               = require('../middleware/rbac');
const { logEvent, AUDIT_EVENTS }    = require('../services/auditLogger');

const router = express.Router();

// ── Router-level middleware ──────────────────────────────────────────────────
// All finding action endpoints require authentication and tenant isolation.
router.use(authenticate, orgIsolation);

// ── Status transition matrix ──────────────────────────────────────────────────
/**
 * Defines which statuses a finding may transition TO from each source status.
 * Terminal statuses (accepted, edited, dismissed) have no outbound transitions.
 */
const ALLOWED_TRANSITIONS = {
  open      : ['accepted', 'edited', 'dismissed', 'escalated'],
  escalated : ['accepted', 'edited', 'dismissed'],
  accepted  : [],
  edited    : [],
  dismissed : [],
};

/**
 * Returns true if the transition from `from` => `to` is permitted.
 *
 * @param {string} from - Current finding status
 * @param {string} to   - Desired target status
 * @returns {boolean}
 */
function isTransitionAllowed(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

// ── Body validation helpers ──────────────────────────────────────────────────

/**
 * Validates the PATCH request body for a finding action.
 *
 * Accepted shapes:
 *   { status: 'accepted' }
 *   { status: 'edited',    editedText: 'new text' }
 *   { status: 'dismissed', reason: 'rationale string' }
 *   { status: 'escalated', reason?: 'optional note' }
 *
 * @param {object} body
 * @returns {{ valid: boolean, error?: string, code?: string }}
 */
function validateBody(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required.', code: 'MISSING_BODY' };
  }

  const { status, reason, editedText } = body;

  // status is required
  if (!status || typeof status !== 'string') {
    return {
      valid : false,
      error : 'Field "status" is required and must be a string.',
      code  : 'MISSING_STATUS',
    };
  }

  const normalised = status.trim().toLowerCase();

  if (!Finding.FINDING_STATUSES.includes(normalised)) {
    return {
      valid : false,
      error : `Status "${status}" is not valid. Allowed values: ${Finding.FINDING_STATUSES.join(', ')}.`,
      code  : 'INVALID_STATUS',
    };
  }

  // 'dismissed' requires a non-empty reason
  if (normalised === 'dismissed') {
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return {
        valid : false,
        error : 'A "reason" is required when dismissing a finding.',
        code  : 'REASON_REQUIRED',
      };
    }
  }

  // 'edited' requires editedText
  if (normalised === 'edited') {
    if (!editedText || typeof editedText !== 'string' || !editedText.trim()) {
      return {
        valid : false,
        error : 'Field "editedText" is required when setting status to "edited".',
        code  : 'EDITED_TEXT_REQUIRED',
      };
    }
  }

  return { valid: true, normalisedStatus: normalised };
}

// ── PATCH /v1/findings/:id ────────────────────────────────────────────────────

/**
 * PATCH /v1/findings/:id
 *
 * Accepts a finding action payload and updates the finding's status.
 *
 * Supported actions by target status:
 *   accepted  — Reviewer accepts the finding as-is (no edit).
 *   edited    — Reviewer supplies a manual correction (editedText).
 *   dismissed — Reviewer dismisses the finding; must supply reason.
 *   escalated — Finding is escalated to senior reviewer / legal; reason optional.
 *
 * Guards:
 *   - Finding must belong to the authenticated user's org (tenant isolation).
 *   - Status transition must be valid per ALLOWED_TRANSITIONS matrix.
 *   - Terminal statuses (accepted, edited, dismissed) cannot be re-actioned.
 *
 * Side-effect:
 *   Writes an immutable AuditLog event with eventType 'finding_actioned'.
 *
 * Minimum required role: reviewer
 */
router.patch(
  '/:id',
  requireRole('reviewer', 'brand_manager', 'admin'),
  async (req, res, next) => {
    try {
      const { id }  = req.params;
      const orgId   = req.org?._id || req.orgId;
      const actor   = req.user?._id || null;

      // ── 1. Validate finding ID ──────────────────────────────────────────────
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success : false,
          error   : `Invalid finding ID "${id}".`,
          code    : 'INVALID_ID',
        });
      }

      // ── 2. Validate request body ────────────────────────────────────────────
      const bodyValidation = validateBody(req.body);
      if (!bodyValidation.valid) {
        return res.status(400).json({
          success : false,
          error   : bodyValidation.error,
          code    : bodyValidation.code,
        });
      }

      const { normalisedStatus }  = bodyValidation;
      const reason     = req.body.reason     ? String(req.body.reason).trim()     : null;
      const editedText = req.body.editedText ? String(req.body.editedText).trim() : null;

      // ── 3. Load finding (orgId-scoped) ──────────────────────────────────────
      const finding = await Finding.findOne({ _id: id, orgId });
      if (!finding) {
        return res.status(404).json({
          success : false,
          error   : `Finding "${id}" was not found in your organisation.`,
          code    : 'FINDING_NOT_FOUND',
        });
      }

      // ── 4. Validate status transition ───────────────────────────────────────
      const currentStatus = finding.status;

      if (currentStatus === normalisedStatus) {
        return res.status(409).json({
          success : false,
          error   : `Finding is already in status "${currentStatus}". No change was made.`,
          code    : 'STATUS_UNCHANGED',
          currentStatus,
        });
      }

      if (!isTransitionAllowed(currentStatus, normalisedStatus)) {
        const terminal = ALLOWED_TRANSITIONS[currentStatus]?.length === 0;
        return res.status(422).json({
          success       : false,
          error         : terminal
            ? `Finding is in terminal status "${currentStatus}" and cannot be changed.`
            : `Transition from "${currentStatus}" to "${normalisedStatus}" is not permitted.`,
          code          : terminal ? 'TERMINAL_STATUS' : 'INVALID_TRANSITION',
          currentStatus,
          targetStatus  : normalisedStatus,
          allowedTargets: ALLOWED_TRANSITIONS[currentStatus] || [],
        });
      }

      // ── 5. Capture previous state for audit metadata ────────────────────────
      const previousStatus       = finding.status;
      const previousSuggestedFix = finding.suggestedFix;

      // ── 6. Apply the action ─────────────────────────────────────────────────
      finding.status = normalisedStatus;

      // For 'edited' actions, overwrite the suggestedFix with the reviewer's text
      if (normalisedStatus === 'edited' && editedText) {
        finding.suggestedFix = editedText;
      }

      await finding.save();

      // ── 7. Write AuditLog event: 'finding_actioned' ─────────────────────────
      const auditMetadata = {
        previousStatus,
        newStatus      : normalisedStatus,
        draftId        : finding.draftId,
        draftVersionId : finding.draftVersionId,
        verdict        : finding.verdict,
        type           : finding.type,
        ruleId         : finding.ruleId || null,
      };

      if (reason)     auditMetadata.reason     = reason;
      if (editedText) auditMetadata.editedText = editedText;
      if (normalisedStatus === 'edited' && previousSuggestedFix !== editedText) {
        auditMetadata.previousSuggestedFix = previousSuggestedFix;
      }

      try {
        await logEvent({
          orgId,
          actor,
          eventType  : AUDIT_EVENTS.FINDING_ACTIONED,
          entityType : 'finding',
          entityId   : finding._id,
          metadata   : auditMetadata,
        });
      } catch (auditErr) {
        // Audit failure must not roll back the finding update.
        // Log the failure and continue.
        console.error('[findings] AuditLog write failed for finding_actioned:', auditErr.message);
      }

      // ── 8. Return updated finding ────────────────────────────────────────────
      return res.json({
        success        : true,
        finding        : finding.toObject(),
        previousStatus,
        newStatus      : normalisedStatus,
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /v1/findings/:id

 *
 * Retrieves a single finding by ID, scoped to the caller's organisation.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId  = req.org?._id || req.orgId;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success : false,
        error   : `Invalid finding ID "${id}".`,
        code    : 'INVALID_ID',
      });
    }

    const finding = await Finding.findOne({ _id: id, orgId }).lean();
    if (!finding) {
      return res.status(404).json({
        success : false,
        error   : `Finding "${id}" was not found in your organisation.`,
        code    : 'FINDING_NOT_FOUND',
      });
    }

    return res.json(finding);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

