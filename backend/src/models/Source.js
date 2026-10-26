/**
 * Source.js — Source document Mongoose model.
 *
 * Sources represent approved knowledge artifacts (brand guidelines,
 * fact sheets, glossaries, past content, and brand assets) uploaded
 * by organisation owners and admins.
 *
 * All sources are tenant-isolated by `orgId`.
 */

const mongoose = require('mongoose');

const SOURCE_TYPES = ['guideline', 'fact-sheet', 'glossary', 'past-content', 'asset'];
const SOURCE_STATUSES = ['active', 'ready', 'processing', 'expired', 'superseded', 'error'];

const sourceSchema = new mongoose.Schema(
  {
    /** Reference to the organisation owning this source */
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Org',
      required: true,
      index: true,
    },

    /** Original filename uploaded by the user */
    fileName: {
      type: String,
      required: true,
      trim: true,
    },

    /** Object key / path in MinIO object storage */
    storageRef: {
      type: String,
      required: true,
      trim: true,
    },

    /** File size in bytes */
    fileSize: {
      type: Number,
      required: true,
    },

    /** MIME type detected or supplied during upload */
    mimeType: {
      type: String,
      default: 'application/octet-stream',
    },

    /** Source category */
    type: {
      type: String,
      enum: SOURCE_TYPES,
      default: 'guideline',
      index: true,
    },

    /** User reference for source owner */
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    /** Display name or label of the source owner */
    ownerName: {
      type: String,
      trim: true,
      default: '',
    },

    /** Version identifier (e.g., '1.0', '2.1') */
    version: {
      type: String,
      default: '1.0',
      trim: true,
    },

    /** Effective start date */
    effectiveDate: {
      type: Date,
      default: Date.now,
    },

    /** Shelf-life expiry date */
    expiryDate: {
      type: Date,
      default: null,
      index: true,
    },

    /** Lifecycle status of the source */
    status: {
      type: String,
      enum: SOURCE_STATUSES,
      default: 'ready',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'sources',
  }
);

// Compound indexes for multi-tenant querying & sorting
sourceSchema.index({ orgId: 1, createdAt: -1 });
sourceSchema.index({ orgId: 1, status: 1 });
sourceSchema.index({ orgId: 1, type: 1 });

module.exports = mongoose.model('Source', sourceSchema);
module.exports.SOURCE_TYPES = SOURCE_TYPES;
module.exports.SOURCE_STATUSES = SOURCE_STATUSES;
