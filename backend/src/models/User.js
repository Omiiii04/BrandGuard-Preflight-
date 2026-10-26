/**
 * User.js — User Mongoose model.
 *
 * Users are always members of exactly one Org (orgId).
 * Passwords are not stored here; authentication is handled externally
 * (magic-link / OAuth) or via a future auth service — the User record
 * is the principal that JWTs are issued against.
 */

const mongoose = require('mongoose');

const ROLES = [
  'admin',
  'editor',
  'reviewer',
  'viewer',
  'creator',
  'brand_manager',
  'manager',
  'knowledge_owner',
  'authorised_reviewer',
];

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },

    name: {
      type: String,
      trim: true,
      maxlength: 120,
    },

    /** Reference to the Org this user belongs to. */
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Org',
      required: true,
    },

    /**
     * Role-based access control.
     * - admin:    full CRUD + org settings
     * - editor:   create/update drafts & brand guides
     * - reviewer: approve / reject findings
     * - viewer:   read-only
     */
    role: {
      type: String,
      enum: ROLES,
      default: 'viewer',
    },

    /** Soft-delete — deactivated users cannot obtain new tokens. */
    active: { type: Boolean, default: true },

    /** ISO timestamp of the last successful login (informational). */
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

// Compound index: look up users within an org efficiently.
userSchema.index({ orgId: 1, email: 1 });
userSchema.index({ orgId: 1, role: 1 });

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
