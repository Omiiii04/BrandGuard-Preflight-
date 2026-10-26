/**
 * Passport.js — Brand Passport Mongoose model.
 *
 * Implements Passport entity from OpenAPI spec & SDD (Section 2.10):
 * A tamper-evident, append-only cryptographic approval record containing:
 * - SHA-256 digest of approved content
 * - List of checks executed
 * - Rules version applied
 * - Approver user IDs
 * - AI usage flag
 * - Immutable timestamp
 */

'use strict';

const mongoose = require('mongoose');

const passportSchema = new mongoose.Schema(
  {
    /** Owning organisation tenant */
    orgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Org',
      required: true,
      index: true,
    },

    /** Reference to approved Draft */
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Draft',
      required: true,
      index: true,
    },

    /** Reference to approved DraftVersion revision */
    draftVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DraftVersion',
      required: false,
      index: true,
    },

    /** SHA-256 hex digest of the approved content */
    contentHash: {
      type: String,
      required: true,
      trim: true,
      match: [/^[a-f0-9]{64}$/i, 'contentHash must be a valid 64-character SHA-256 hex string.'],
    },

    /** Checks evaluated during review */
    checksRun: {
      type: [String],
      required: true,
      default: ['claim_match', 'contradiction', 'rules', 'premortem'],
    },

    /** Rules version in effect at time of sign-off */
    rulesVersion: {
      type: String,
      required: true,
      default: 'v1.2',
    },

    /** Manager(s) who signed off on the draft */
    approvers: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      required: true,
      default: [],
    },

    /** Whether AI models were utilised in generating or checking this asset */
    aiUsed: {
      type: Boolean,
      required: true,
      default: true,
    },

    /** Immutable sign-off timestamp */
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
  },
  {
    timestamps: false,
    collection: 'passports',
  }
);

passportSchema.index({ orgId: 1, draftId: 1 });
passportSchema.index({ orgId: 1, contentHash: 1 });

const Passport = mongoose.model('Passport', passportSchema);

module.exports = Passport;
