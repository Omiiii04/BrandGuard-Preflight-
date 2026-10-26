/**
 * passportBuilder.js — Brand Passport Generation Service.
 *
 * Implements FR-AP-01, SDD Section 2.10, and Block 6 passport builder:
 * Generates an append-only, tamper-evident Brand Passport document:
 *   - SHA-256 contentHash of the approved content
 *   - checksRun: array of checks executed (e.g. ['claim_match', 'contradiction', 'rules', 'premortem'])
 *   - rulesVersion: active compliance rules version (e.g. 'v1.2')
 *   - approvers: array of authorising user ObjectIds
 *   - aiUsed: boolean flag indicating if AI was utilised
 *   - timestamp: immutable approval date
 *
 * Stores the record in the append-only `passports` collection.
 */

'use strict';

const mongoose = require('mongoose');
const Passport = require('../models/Passport');
const { sha256 } = require('../utils/hash');

/**
 * Builds and persists a Brand Passport.
 *
 * @param {object} params
 * @param {mongoose.Types.ObjectId|string} params.orgId
 * @param {mongoose.Types.ObjectId|string} params.draftId
 * @param {mongoose.Types.ObjectId|string} [params.draftVersionId]
 * @param {string} [params.content] - Approved text content (used to compute or verify hash)
 * @param {string} [params.contentHash] - Pre-computed SHA-256 digest
 * @param {Array<string>} [params.checksRun] - List of checks executed
 * @param {string} [params.rulesVersion] - Rules version string
 * @param {mongoose.Types.ObjectId|string|Array} [params.approverId] - Authorising manager user ID
 * @param {Array<mongoose.Types.ObjectId|string>} [params.approvers] - Authorising managers
 * @param {boolean} [params.aiUsed] - Whether AI models were engaged
 * @returns {Promise<import('mongoose').Document>} Persisted Passport document
 */
async function buildPassport(params) {
  if (!params || typeof params !== 'object') {
    throw new Error('[passportBuilder] params object is required.');
  }

  const {
    orgId,
    draftId,
    draftVersionId = null,
    content = '',
    contentHash: providedHash,
    checksRun = ['claim_match', 'contradiction', 'rules', 'premortem'],
    rulesVersion = process.env.RULES_VERSION || 'v1.2',
    approverId,
    approvers: providedApprovers,
    aiUsed = true,
  } = params;

  if (!orgId) throw new Error('[passportBuilder] orgId is required.');
  if (!draftId) throw new Error('[passportBuilder] draftId is required.');

  // Determine contentHash: use provided hash or compute from content
  let computedHash = providedHash;
  if (!computedHash && typeof content === 'string') {
    computedHash = sha256(content);
  }

  if (!computedHash || !/^[a-f0-9]{64}$/i.test(computedHash)) {
    throw new Error('[passportBuilder] A valid 64-character SHA-256 contentHash is required.');
  }

  // Normalize approvers list
  let approversList = [];
  if (Array.isArray(providedApprovers) && providedApprovers.length > 0) {
    approversList = providedApprovers.map((a) => (a?._id || a));
  } else if (approverId) {
    approversList = [approverId?._id || approverId];
  }

  const passport = new Passport({
    orgId,
    draftId,
    draftVersionId,
    contentHash: computedHash,
    checksRun: Array.isArray(checksRun) && checksRun.length > 0 ? checksRun : ['claim_match', 'contradiction', 'rules', 'premortem'],
    rulesVersion: rulesVersion || 'v1.2',
    approvers: approversList,
    aiUsed: Boolean(aiUsed),
    timestamp: new Date(),
  });

  await passport.save();
  return passport;
}

module.exports = {
  buildPassport,
  passportBuilder: buildPassport,
};
