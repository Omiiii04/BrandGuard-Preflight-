/**
 * AuditLog.js — Immutable Append-Only Audit Log Mongoose model.
 *
 * Implements FR-AP-03 & Architectural Blueprint:
 * An append-only log recording every critical action across BrandGuard Preflight:
 *   - source uploads / expiry warnings
 *   - draft submissions / reviews / approvals / change requests
 *   - finding actions / overrides
 *   - Brand Passport creations
 *   - redaction gateway rejections / ML response discards
 *
 * Immutability Guarantee:
 *   - Records have no PATCH, PUT, or DELETE routes
 *   - Mongoose pre-save and pre-query hooks prevent updates and deletions at runtime
 */

const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    /** Reference to the organisation tenant owning this audit event */
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Org',
      required: true,
      index: true,
    },

    /** Reference to user principal or null for automated/system processes */
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    /**
     * Action event type, e.g.:
     *   - source_uploaded, source_indexed, expiry_warning, source_expired
     *   - draft_submitted, review_completed, draft_approved, changes_requested
     *   - finding_actioned, finding_accepted, finding_overridden
     *   - passport_created, confidential_term_blocked, ml_response_discarded
     */
    eventType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    /**
     * Target entity category (e.g., 'source', 'draft', 'finding', 'passport', 'fact', 'rule')
     */
    entityType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    /** Target entity ID (MongoDB ObjectId or unique string reference) */
    entityId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      index: true,
    },

    /** Structured metadata payload containing context, diffs, or reasons */
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },

    /** Immutable UTC event creation timestamp */
    timestamp: {
      type: Date,
      default: Date.now,
      immutable: true,
      index: true,
    },
  },
  {
    timestamps: false, // We use immutable `timestamp`
    collection: 'auditLog',
  }
);

// Compound indexes for audit querying, compliance exports, and tenant isolation
auditLogSchema.index({ orgId: 1, timestamp: -1 });
auditLogSchema.index({ orgId: 1, eventType: 1 });
auditLogSchema.index({ orgId: 1, entityType: 1, entityId: 1 });

/**
 * Immutability Hook: Prevent document updates once created.
 */
auditLogSchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(new Error('AuditLog records are append-only and cannot be updated.'));
  }
  return next();
});

/**
 * Immutability Hook: Reject any query-level updates or deletions.
 */
function preventAuditMutation(next) {
  const err = new Error('AuditLog records are append-only. Modification or deletion is strictly prohibited.');
  return next(err);
}

auditLogSchema.pre('updateOne', preventAuditMutation);
auditLogSchema.pre('updateMany', preventAuditMutation);
auditLogSchema.pre('findOneAndUpdate', preventAuditMutation);
auditLogSchema.pre('replaceOne', preventAuditMutation);
auditLogSchema.pre('findOneAndReplace', preventAuditMutation);
auditLogSchema.pre('deleteOne', preventAuditMutation);
auditLogSchema.pre('deleteMany', preventAuditMutation);
auditLogSchema.pre('findOneAndDelete', preventAuditMutation);

module.exports = mongoose.model('AuditLog', auditLogSchema);
