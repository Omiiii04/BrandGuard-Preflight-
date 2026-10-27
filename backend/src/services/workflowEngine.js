/**
 * workflowEngine.js — Content Compliance Workflow & Routing Engine.
 *
 * Implements:
 *   - Claim Shelf-Life logic: checks all retrieved passage expiry dates at review time.
 *     If expired, creates additional Finding with verdict = 'Outdated'.
 *   - FR-WF-02: Draft lifecycle state transitions (draft -> checked -> in-review -> approved -> published).
 *   - FR-WF-06: Routing logic based on contradiction confidence & risky topics.
 */

'use strict';

const mongoose = require('mongoose');
const Finding = require('../models/Finding');
const Source = require('../models/Source');
const Draft = require('../models/Draft');
const { logEventSafe, AUDIT_EVENTS } = require('./auditLogger');

/**
 * Checks all retrieved passage expiry dates at review time.
 * If expired, creates an additional Finding with verdict = 'Outdated'.
 *
 * @param {object} params
 * @param {Array<object>} [params.claims=[]] - Extracted claims with proof passages / evidence
 * @param {Array<object>} [params.passages=[]] - Explicitly retrieved passages
 * @param {mongoose.Types.ObjectId|string} params.draftId - Draft container ID
 * @param {mongoose.Types.ObjectId|string} params.draftVersionId - DraftVersion ID being reviewed
 * @param {mongoose.Types.ObjectId|string} params.orgId - Organisation tenant ID
 * @param {Date|string} [params.now=new Date()] - Reference timestamp for expiry comparison
 * @param {boolean} [params.persist=false] - Whether to insert findings into MongoDB directly
 * @returns {Promise<Array<object>>} - Additional Outdated Finding documents/objects
 */
async function checkClaimShelfLife({
  claims = [],
  passages = [],
  draftId,
  draftVersionId,
  orgId,
  now = new Date(),
  persist = false,
} = {}) {
  if (!draftId) throw new Error('[workflowEngine] draftId is required.');
  if (!draftVersionId) throw new Error('[workflowEngine] draftVersionId is required.');
  if (!orgId) throw new Error('[workflowEngine] orgId is required.');

  const currentDate = new Date(now);
  const additionalFindings = [];

  // Pool all candidates: explicit passages and claims with attached evidence / proof passages
  const candidates = [];

  for (const passage of passages) {
    if (passage) {
      candidates.push({
        evidence: passage,
        span: passage.span || { start: 0, end: 0 },
        confidence: passage.confidence ?? 1.0,
        proofPassageId: passage.proofPassageId || passage.sourceId || null,
        suggestedFix: passage.suggestedFix || null,
        ruleId: passage.ruleId || 'rule.shelf_life.expired',
      });
    }
  }

  for (const claim of claims) {
    if (claim && (claim.evidence || claim.proofPassageId)) {
      candidates.push({
        evidence: claim.evidence || null,
        span: claim.span || { start: 0, end: 0 },
        confidence: claim.confidence ?? 1.0,
        proofPassageId: claim.proofPassageId || null,
        suggestedFix: claim.suggestedFix || null,
        ruleId: claim.ruleId || 'rule.shelf_life.expired',
        claimVerdict: claim.verdict,
        meaningCheck: claim.meaningCheck || null,
      });
    }
  }

  // Evaluate each candidate passage for expiration
  for (const item of candidates) {
    let expiryDate = null;
    let sourceRecord = null;

    // Check evidence.expiryDate if available
    if (item.evidence && item.evidence.expiryDate) {
      const parsed = new Date(item.evidence.expiryDate);
      if (!isNaN(parsed.getTime())) {
        expiryDate = parsed;
      }
    }

    // If proofPassageId or sourceId exists, check database Source document
    const candidateSourceId = item.proofPassageId || (item.evidence && item.evidence.sourceId);
    if (candidateSourceId && mongoose.Types.ObjectId.isValid(candidateSourceId)) {
      try {
        sourceRecord = await Source.findOne({ _id: candidateSourceId, orgId }).lean();
        if (sourceRecord && sourceRecord.expiryDate) {
          const parsed = new Date(sourceRecord.expiryDate);
          if (!isNaN(parsed.getTime())) {
            expiryDate = parsed;
          }
        }
      } catch (err) {
        // Source retrieval fallback error should not abort review workflow
      }
    }

    // Determine if the passage has expired
    if (expiryDate && expiryDate <= currentDate) {
      const fileName =
        item.evidence?.fileName ||
        sourceRecord?.fileName ||
        item.evidence?.passageId ||
        'retrieved passage';

      const formattedExpiry = expiryDate.toISOString().split('T')[0];

      const findingData = {
        orgId: new mongoose.Types.ObjectId(orgId.toString()),
        draftId: new mongoose.Types.ObjectId(draftId.toString()),
        draftVersionId: new mongoose.Types.ObjectId(draftVersionId.toString()),
        span: {
          start: typeof item.span?.start === 'number' ? item.span.start : 0,
          end: typeof item.span?.end === 'number' ? item.span.end : 0,
        },
        type: 'violation',
        verdict: 'Outdated',
        confidence: item.confidence ?? 1.0,
        proofPassageId: candidateSourceId && mongoose.Types.ObjectId.isValid(candidateSourceId)
          ? new mongoose.Types.ObjectId(candidateSourceId.toString())
          : null,
        ruleId: 'rule.shelf_life.expired',
        explanation: `Retrieved passage from "${fileName}" expired on ${formattedExpiry}. The verified claim or fact has lapsed shelf-life and must be updated.`,
        suggestedFix: item.suggestedFix || null,
        evidence: {
          passageId: item.evidence?.passageId || (sourceRecord ? String(sourceRecord._id) : null),
          fileName: fileName,
          page: item.evidence?.page ?? null,
          version: item.evidence?.version || sourceRecord?.version || '1.0',
          expiryDate: expiryDate,
          ownerName: item.evidence?.ownerName || sourceRecord?.ownerName || '',
          passage: item.evidence?.passage || '',
        },
        meaningCheck: item.meaningCheck || null,
        status: 'open',
      };

      additionalFindings.push(findingData);
    }
  }

  if (persist && additionalFindings.length > 0) {
    const inserted = await Finding.insertMany(additionalFindings, { ordered: false });
    return inserted;
  }

  return additionalFindings;
}

/**
 * Implements FR-WF-06 Review Routing Logic:
 *   - High-confidence contradictions (>= 0.85) route to creator then manager
 *   - Low-confidence or risky topics route to authorised reviewer
 *
 * @param {object} draft
 * @param {Array<object>} findings
 * @returns {{ targetRoles: Array<string>, reason: string, priority: string }}
 */
function determineReviewRouting(draft, findings = []) {
  const highConfidenceContradictions = findings.filter(
    (f) => f.verdict === 'Contradicted' && (f.confidence ?? 0) >= 0.85
  );

  if (highConfidenceContradictions.length > 0) {
    return {
      targetRoles: ['creator', 'manager'],
      priority: 'high',
      reason: `Detected ${highConfidenceContradictions.length} high-confidence contradiction(s) (>= 0.85). Requires creator remediation before manager sign-off.`,
    };
  }

  const riskyOrAmbiguous = findings.filter(
    (f) => f.verdict === 'Unclear' || f.verdict === 'Outdated' || (f.confidence ?? 1) < 0.70
  );

  if (riskyOrAmbiguous.length > 0) {
    return {
      targetRoles: ['reviewer'],
      priority: 'medium',
      reason: `Flagged ${riskyOrAmbiguous.length} ambiguous or outdated item(s). Routes to authorised subject-matter reviewer.`,
    };
  }

  return {
    targetRoles: ['manager'],
    priority: 'normal',
    reason: 'Standard review routing to brand manager.',
  };
}

/**
 * Implements FR-WF-02 State transitions:
 *   draft -> checked -> in-review -> approved -> published
 */
const VALID_DRAFT_TRANSITIONS = {
  draft: ['checked', 'in-review'],
  checked: ['in-review', 'draft'],
  'in-review': ['approved', 'draft'],
  approved: ['published', 'draft'],
  published: [],
};

function canTransitionDraft(currentStatus, targetStatus) {
  const allowed = VALID_DRAFT_TRANSITIONS[currentStatus] || [];
  return allowed.includes(targetStatus);
}

module.exports = {
  checkClaimShelfLife,
  determineReviewRouting,
  canTransitionDraft,
  VALID_DRAFT_TRANSITIONS,
};
