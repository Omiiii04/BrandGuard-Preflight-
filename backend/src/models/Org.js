/**
 * Org.js — Organisation Mongoose model.
 *
 * Every user belongs to exactly one Org.
 * All uploaded documents, findings, and brand-guide entries are scoped
 * to an Org so that tenant data never leaks across boundaries.
 */

const mongoose = require('mongoose');

const orgSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9-]+$/,
    },

    /**
     * Per-org feature flags and behavioural overrides.
     * Extend this object as new Phase features are added.
     */
    settings: {
      allowExternalModel: { type: Boolean, default: false }, // allow OpenAI calls
      shelfLifeWarnDays:  { type: Number,  default: 30 },    // days before source expiry
      maxUploadBytes:     { type: Number,  default: 10 * 1024 * 1024 }, // 10 MB
      rules_only:         { type: Boolean, default: false }, // rules-only mode: skips LM calls
    },

    /**
     * Org-specific confidential watchlist terms (embargoed products, secret codenames, etc.)
     */
    watchlist: {
      type: [String],
      default: [],
    },

    /** Soft-delete support — deactivated orgs cannot log in. */
    active: { type: Boolean, default: true },
  },
  {
    timestamps: true, // createdAt, updatedAt
    collection: 'orgs',
  }
);

module.exports = mongoose.model('Org', orgSchema);
