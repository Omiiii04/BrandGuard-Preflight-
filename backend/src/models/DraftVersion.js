/**
 * DraftVersion.js — Immutable Draft Version Mongoose model.
 *
 * Implements DraftVersion entity from OpenAPI spec, SDD (Section 2.7), & FR-DS-04:
 * Stores version history, unified text diffs, and cryptographic SHA-256
 * content hashes for auditability and tamper detection.
 */

const mongoose = require('mongoose');

const draftVersionSchema = new mongoose.Schema(
  {
    /** Reference to parent Draft container */
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Draft',
      required: true,
      index: true,
    },

    /** Reference to organisation tenant */
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Org',
      required: true,
      index: true,
    },

    /** Sequential version counter (v1, v2, etc.) */
    versionNumber: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },

    /** Raw text content of this version */
    content: {
      type: String,
      default: '',
    },

    /**
     * SHA-256 cryptographic digest of the version content.
     * Guaranteed 64-char hexadecimal string.
     */
    contentHash: {
      type: String,
      required: true,
      trim: true,
      match: [/^[a-f0-9]{64}$/i, 'contentHash must be a valid 64-character SHA-256 hex string.'],
    },

    /**
     * Unified diff string comparing this version against the previous version.
     * Empty string for initial v1 version.
     */
    diff: {
      type: String,
      default: '',
    },

    /** MinIO object storage key if associated with binary upload */
    storageRef: {
      type: String,
      trim: true,
    },

    /** Author user who produced this revision */
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    /** Immutable UTC creation timestamp */
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
  },
  {
    timestamps: false, // We use immutable createdAt
    collection: 'draftVersions',
  }
);

// Compound indexes:
// Ensure (draftId, versionNumber) is strictly unique
draftVersionSchema.index({ draftId: 1, versionNumber: 1 }, { unique: true });
draftVersionSchema.index({ orgId: 1, createdAt: -1 });
draftVersionSchema.index({ orgId: 1, contentHash: 1 });

const DraftVersion = mongoose.model('DraftVersion', draftVersionSchema);

module.exports = DraftVersion;
