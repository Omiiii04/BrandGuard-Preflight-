/**
 * guidelineDebuggerAndRedaction.test.js — Tests for Block 7 Features:
 *   1. Guideline Debugger logic:
 *      - Query findings for rules with override rate > 50%
 *      - Call /rewrite ML call to suggest clearer rewording
 *      - Expose in GET /v1/insights/rules response as { rule, overrideRate, suggestedRewording }
 *   2. Redaction preview endpoint:
 *      - POST /v1/drafts/redaction-preview
 *      - GET / POST /v1/drafts/:id/redaction-preview
 *      - Show user preview of what content (after redaction) would be sent
 *   3. Rules-only mode:
 *      - When org setting rules_only = true, skip all LM calls and return only exact-rule findings
 *      - Record rules_only_fallback AuditLog event
 *      - Org settings management (GET/PATCH /v1/orgs/settings)
 */

'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const JWT_SECRET = process.env.JWT_SECRET || 'brandguard-super-secret-jwt-key-change-me-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const Draft = require('../src/models/Draft');
const DraftVersion = require('../src/models/DraftVersion');
const Finding = require('../src/models/Finding');
const Org = require('../src/models/Org');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const Comment = require('../src/models/Comment');

const {
  getRuleInsights,
} = require('../src/services/insightsAggregator');
const {
  extractExactRuleFindings,
  extractClaims,
  rewriteClaim,
} = require('../src/services/mlOrchestrator');

describe('Block 7 — Guideline Debugger, Redaction Preview & Rules-Only Mode', () => {
  let server;
  let baseUrl;
  let mockMlServer;
  let mlCalls = [];

  let testOrgId;
  let managerUserId;
  let creatorUserId;
  let managerToken;
  let creatorToken;

  let memoryDrafts = new Map();
  let memoryDraftVersions = new Map();
  let memoryFindings = new Map();
  let memoryAuditLogs = [];
  let memoryComments = new Map();
  let memoryOrg = null;

  const originalUserFindById = User.findById;
  const originalOrgFindById = Org.findById;
  const originalOrgFindByIdAndUpdate = Org.findByIdAndUpdate;
  const originalDraftFind = Draft.find;
  const originalDraftFindOne = Draft.findOne;
  const originalDraftVersionFindOne = DraftVersion.findOne;
  const originalFindingFind = Finding.find;
  const originalFindingInsertMany = Finding.insertMany;
  const originalCommentFind = Comment.find;
  const originalAuditLogFind = AuditLog.find;
  const originalAuditLogSave = AuditLog.prototype.save;

  before(async () => {
    testOrgId = new mongoose.Types.ObjectId();
    managerUserId = new mongoose.Types.ObjectId();
    creatorUserId = new mongoose.Types.ObjectId();

    managerToken = jwt.sign(
      { sub: managerUserId.toString(), email: 'manager@acme.com', role: 'manager' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    creatorToken = jwt.sign(
      { sub: creatorUserId.toString(), email: 'creator@acme.com', role: 'creator' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    memoryOrg = {
      _id: testOrgId,
      name: 'Acme Brand Co',
      slug: 'acme-brand',
      settings: {
        rules_only: false,
        allowExternalModel: false,
        shelfLifeWarnDays: 30,
        maxUploadBytes: 10485760,
      },
      watchlist: ['Project Falcon', 'Secret Sauce', 'Acme Ultra'],
      active: true,
    };

    // Spin up mock ML server for /rewrite and /extract-claims
    mockMlServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const parsed = body ? JSON.parse(body) : {};
        mlCalls.push({ url: req.url, method: req.method, body: parsed });

        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/rewrite') {
          res.end(
            JSON.stringify({
              suggestedFix: 'Claims must avoid unverified superlatives ("best", "market leader"). State verified benchmark numbers.',
              suggestedRewording: 'Claims must avoid unverified superlatives ("best", "market leader"). State verified benchmark numbers.',
              meaningCheck: { kept: [], changed: [], dropped: [] },
            })
          );
        } else if (req.url === '/extract-claims') {
          res.end(
            JSON.stringify({
              claims: [
                {
                  span: { start: 0, end: 15 },
                  type: 'violation',
                  verdict: 'Contradicted',
                  confidence: 0.95,
                  ruleId: 'rule.superlative.unqualified',
                  suggestedFix: 'We offer standard terms.',
                },
              ],
            })
          );
        } else {
          res.end(JSON.stringify({ status: 'ok' }));
        }
      });
    });

    await new Promise((resolve) => mockMlServer.listen(0, '127.0.0.1', resolve));
    process.env.ML_SERVICE_URL = `http://127.0.0.1:${mockMlServer.address().port}`;

    // Mock Mongoose models
    User.findById = function (id) {
      const idStr = id.toString();
      const isManager = idStr === managerUserId.toString();
      const role = isManager ? 'manager' : 'creator';
      return {
        populate: function () {
          return {
            select: function () {
              return {
                lean: async function () {
                  return {
                    _id: isManager ? managerUserId : creatorUserId,
                    email: isManager ? 'manager@acme.com' : 'creator@acme.com',
                    name: isManager ? 'Manager Priya' : 'Creator Rohan',
                    role,
                    active: true,
                    orgId: memoryOrg,
                  };
                },
              };
            },
          };
        },
      };
    };

    Org.findById = function (id) {
      return {
        select: function () {
          return {
            lean: async function () {
              return memoryOrg;
            },
          };
        },
      };
    };

    Org.findByIdAndUpdate = function (id, update) {
      if (update.$set) {
        if (update.$set['settings.rules_only'] !== undefined) {
          memoryOrg.settings.rules_only = update.$set['settings.rules_only'];
        }
      }
      return {
        select: function () {
          return {
            lean: async function () {
              return memoryOrg;
            },
          };
        },
      };
    };

    Draft.findOne = function (filter) {
      const idStr = filter?._id?.toString();
      const draft = memoryDrafts.get(idStr);
      if (!draft) {
        return {
          then: (resolve) => resolve(null),
          lean: async () => null,
        };
      }
      const doc = {
        ...draft,
        save: async function () {
          memoryDrafts.set(idStr, { ...draft, ...this });
          return this;
        },
      };
      return {
        ...doc,
        then: (resolve) => resolve(doc),
        lean: async () => draft,
        save: doc.save,
      };
    };

    DraftVersion.findOne = function (filter) {
      const draftIdStr = filter?.draftId?.toString();
      const versions = Array.from(memoryDraftVersions.values()).filter(
        (v) => v.draftId.toString() === draftIdStr
      );
      versions.sort((a, b) => b.versionNumber - a.versionNumber);
      const latest = versions[0] || null;
      return {
        sort: () => ({
          lean: async () => latest,
        }),
        lean: async () => latest,
      };
    };

    Finding.find = function (filter) {
      const orgFilter = filter?.orgId?.toString();
      const ruleFilter = filter?.ruleId;
      const results = Array.from(memoryFindings.values()).filter((f) => {
        if (orgFilter && f.orgId.toString() !== orgFilter) return false;
        if (ruleFilter && f.ruleId !== ruleFilter) return false;
        return true;
      });
      return {
        lean: async () => results,
      };
    };

    Finding.insertMany = async function (docs) {
      for (const doc of docs) {
        const id = doc._id || new mongoose.Types.ObjectId();
        memoryFindings.set(id.toString(), { ...doc, _id: id });
      }
      return docs;
    };

    Comment.find = function () {
      return {
        lean: async () => Array.from(memoryComments.values()),
      };
    };

    AuditLog.find = function () {
      return {
        lean: async () => memoryAuditLogs,
      };
    };

    AuditLog.prototype.save = async function () {
      memoryAuditLogs.push(this.toObject ? this.toObject() : this);
      return this;
    };

    // Spin up Express test app
    const app = express();
    app.use(express.json());

    const draftsRouter = require('../src/routes/drafts');
    const insightsRouter = require('../src/routes/insights');
    const orgsRouter = require('../src/routes/orgs');

    app.use('/v1/drafts', draftsRouter);
    app.use('/v1/insights', insightsRouter);
    app.use('/v1/orgs', orgsRouter);

    app.use((err, _req, res, _next) => {
      res.status(err.status || 500).json({ success: false, error: err.message, code: err.code });
    });

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    User.findById = originalUserFindById;
    Org.findById = originalOrgFindById;
    Org.findByIdAndUpdate = originalOrgFindByIdAndUpdate;
    Draft.find = originalDraftFind;
    Draft.findOne = originalDraftFindOne;
    DraftVersion.findOne = originalDraftVersionFindOne;
    Finding.find = originalFindingFind;
    Finding.insertMany = originalFindingInsertMany;
    Comment.find = originalCommentFind;
    AuditLog.find = originalAuditLogFind;
    AuditLog.prototype.save = originalAuditLogSave;

    if (server) await new Promise((resolve) => server.close(resolve));
    if (mockMlServer) await new Promise((resolve) => mockMlServer.close(resolve));
  });

  beforeEach(() => {
    memoryDrafts.clear();
    memoryDraftVersions.clear();
    memoryFindings.clear();
    memoryAuditLogs = [];
    memoryComments.clear();
    memoryOrg.settings.rules_only = false;
    mlCalls = [];
  });

  // =========================================================================
  // Requirement 1: Guideline Debugger Logic & GET /v1/insights/rules
  // =========================================================================
  describe('Guideline Debugger: Override rate > 50% & suggestedRewording via /rewrite', () => {
    it('queries findings for rules with override rate > 50% and populates suggestedRewording via /rewrite', async () => {
      // Seed findings for rule.superlative.unqualified (3 total, 2 dismissed = 67% override rate)
      const f1 = new mongoose.Types.ObjectId();
      const f2 = new mongoose.Types.ObjectId();
      const f3 = new mongoose.Types.ObjectId();

      memoryFindings.set(f1.toString(), {
        _id: f1,
        orgId: testOrgId,
        ruleId: 'rule.superlative.unqualified',
        verdict: 'Contradicted',
        status: 'dismissed',
        draftSpan: 'The absolute best returns in the industry.',
      });
      memoryFindings.set(f2.toString(), {
        _id: f2,
        orgId: testOrgId,
        ruleId: 'rule.superlative.unqualified',
        verdict: 'Contradicted',
        status: 'dismissed',
        draftSpan: 'Fastest delivery guaranteed.',
      });
      memoryFindings.set(f3.toString(), {
        _id: f3,
        orgId: testOrgId,
        ruleId: 'rule.superlative.unqualified',
        verdict: 'Contradicted',
        status: 'open',
        draftSpan: 'Leading consumer provider.',
      });

      // Seed finding for rule.cost.claim (2 total, 0 dismissed = 0% override rate)
      const f4 = new mongoose.Types.ObjectId();
      const f5 = new mongoose.Types.ObjectId();
      memoryFindings.set(f4.toString(), {
        _id: f4,
        orgId: testOrgId,
        ruleId: 'rule.cost.claim',
        verdict: 'Not Found',
        status: 'open',
        draftSpan: 'Free zero-charge trial.',
      });
      memoryFindings.set(f5.toString(), {
        _id: f5,
        orgId: testOrgId,
        ruleId: 'rule.cost.claim',
        verdict: 'Not Found',
        status: 'open',
        draftSpan: 'No hidden costs.',
      });

      const res = await fetch(`${baseUrl}/v1/insights/rules`, {
        headers: { Authorization: `Bearer ${managerToken}` },
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data));
      assert.equal(body.data.length, 2);

      const highOverrideRule = body.data.find((r) => r.rule === 'rule.superlative.unqualified');
      assert.ok(highOverrideRule, 'Should contain rule.superlative.unqualified');
      assert.equal(highOverrideRule.rule, 'rule.superlative.unqualified');
      assert.equal(highOverrideRule.overrideRate, 0.67);
      assert.ok(highOverrideRule.overrideRate > 0.5, 'Override rate must be > 50%');
      assert.ok(
        typeof highOverrideRule.suggestedRewording === 'string' && highOverrideRule.suggestedRewording.length > 0,
        'Should contain suggestedRewording from /rewrite ML call'
      );

      // Low override rule should have null suggestedRewording
      const lowOverrideRule = body.data.find((r) => r.rule === 'rule.cost.claim');
      assert.ok(lowOverrideRule, 'Should contain rule.cost.claim');
      assert.equal(lowOverrideRule.rule, 'rule.cost.claim');
      assert.equal(lowOverrideRule.overrideRate, 0);
      assert.equal(lowOverrideRule.suggestedRewording, null);

      // Verify that the ML server received a POST /rewrite call
      const rewriteCall = mlCalls.find((c) => c.url === '/rewrite');
      assert.ok(rewriteCall, 'ML service must be called at /rewrite for rules > 50% override rate');
      assert.equal(rewriteCall.body.rule, 'rule.superlative.unqualified');
    });

    it('falls back gracefully to clear default rewording if /rewrite ML call fails or is offline', async () => {
      // Temporarily point ML_SERVICE_URL to unreachable port
      const prevUrl = process.env.ML_SERVICE_URL;
      process.env.ML_SERVICE_URL = 'http://127.0.0.1:59999';

      const fId = new mongoose.Types.ObjectId();
      memoryFindings.set(fId.toString(), {
        _id: fId,
        orgId: testOrgId,
        ruleId: 'rule.date.outdated',
        verdict: 'Outdated',
        status: 'dismissed',
        draftSpan: 'Return within 14 days.',
      });

      try {
        const insights = await getRuleInsights(testOrgId);
        assert.equal(insights.length, 1);
        assert.equal(insights[0].rule, 'rule.date.outdated');
        assert.equal(insights[0].overrideRate, 1.0);
        assert.ok(
          insights[0].suggestedRewording.includes('30-day return window'),
          'Fallback rewording should provide clear policy guidance'
        );
      } finally {
        process.env.ML_SERVICE_URL = prevUrl;
      }
    });
  });

  // =========================================================================
  // Requirement 2: Redaction Preview Endpoint
  // =========================================================================
  describe('Redaction Preview Endpoint', () => {
    it('POST /v1/drafts/redaction-preview returns preview of what content would be sent externally', async () => {
      const rawContent = 'Announcing Project Falcon with our Secret Sauce technology for all buyers.';

      const res = await fetch(`${baseUrl}/v1/drafts/redaction-preview`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creatorToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: rawContent }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.ok(json.data);
      assert.equal(json.data.original, rawContent);
      assert.equal(
        json.data.redactedContent,
        'Announcing [REDACTED] with our [REDACTED] technology for all buyers.'
      );
      assert.equal(json.data.hasRedactions, true);
      assert.equal(json.data.totalReplacements, 2);
      assert.equal(json.data.redactions.length, 2);
      assert.ok(Array.isArray(json.data.whatWasRemoved));
      assert.equal(json.data.whatWasRemoved.length, 2);
      assert.equal(json.data.rulesOnlyRecommended, true);
    });

    it('GET /v1/drafts/:id/redaction-preview returns preview for existing draft version', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const versionId = new mongoose.Types.ObjectId();

      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        title: 'Embargo Campaign',
        status: 'draft',
      });

      memoryDraftVersions.set(versionId.toString(), {
        _id: versionId,
        draftId,
        orgId: testOrgId,
        versionNumber: 1,
        content: 'Upgrade today to Acme Ultra for top performance.',
      });

      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/redaction-preview`, {
        headers: { Authorization: `Bearer ${creatorToken}` },
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.draftId, draftId.toString());
      assert.equal(json.data.redactedContent, 'Upgrade today to [REDACTED] for top performance.');
      assert.equal(json.data.totalReplacements, 1);
      assert.equal(json.data.redactions[0].term, 'Acme Ultra');
    });

    it('returns 404 for non-existent draft ID in redaction preview', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await fetch(`${baseUrl}/v1/drafts/${nonExistentId}/redaction-preview`, {
        headers: { Authorization: `Bearer ${creatorToken}` },
      });

      assert.equal(res.status, 404);
      const json = await res.json();
      assert.equal(json.code, 'DRAFT_NOT_FOUND');
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/v1/drafts/redaction-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Test' }),
      });
      assert.equal(res.status, 401);
    });
  });

  // =========================================================================
  // Requirement 3: Rules-Only Mode
  // =========================================================================
  describe('Rules-Only Mode (org setting rules_only = true)', () => {
    it('skips all LM calls and returns only exact-rule findings when rules_only = true', async () => {
      memoryOrg.settings.rules_only = true;

      const draftId = new mongoose.Types.ObjectId();
      const versionId = new mongoose.Types.ObjectId();

      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        title: 'Seeded Rule Violations Draft',
        status: 'draft',
        intent: { purpose: 'Marketing', audience: 'Consumers', mustSay: [] },
      });

      // Content with 2 exact rule violations: superlative + 14-day return window
      memoryDraftVersions.set(versionId.toString(), {
        _id: versionId,
        draftId,
        orgId: testOrgId,
        versionNumber: 1,
        content: 'We offer the best customer experience with returns within 14 days of delivery.',
      });

      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/review`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${managerToken}` },
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);

      // Verify that NO call was made to the ML server for extract-claims
      const extractClaimsCall = mlCalls.find((c) => c.url === '/extract-claims');
      assert.equal(extractClaimsCall, undefined, 'Must skip all LM calls when rules_only is true');

      // Verify exact rule findings were returned
      assert.ok(json.findingsCount >= 2, 'Should detect exact-rule findings');
      const ruleIds = json.findings.map((f) => f.ruleId);
      assert.ok(ruleIds.includes('rule.superlative.unqualified'), 'Must flag unqualified superlative');
      assert.ok(ruleIds.includes('rule.date.outdated'), 'Must flag outdated 14-day window');

      // Verify audit log event rules_only_fallback was recorded
      const fallbackAudit = memoryAuditLogs.find((l) => l.eventType === 'rules_only_fallback');
      assert.ok(fallbackAudit, 'Must record rules_only_fallback event in AuditLog');
    });

    it('runs normal LM calls when rules_only = false', async () => {
      memoryOrg.settings.rules_only = false;

      const draftId = new mongoose.Types.ObjectId();
      const versionId = new mongoose.Types.ObjectId();

      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        title: 'Normal Draft',
        status: 'draft',
      });

      memoryDraftVersions.set(versionId.toString(), {
        _id: versionId,
        draftId,
        orgId: testOrgId,
        versionNumber: 1,
        content: 'Normal compliant copy.',
      });

      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/review`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${managerToken}` },
      });

      assert.equal(res.status, 200);
      const extractClaimsCall = mlCalls.find((c) => c.url === '/extract-claims');
      assert.ok(extractClaimsCall, 'Must call ML service when rules_only is false');
    });

    it('allows manager to query and toggle rules_only setting via /v1/orgs/settings', async () => {
      // GET settings
      const getRes = await fetch(`${baseUrl}/v1/orgs/settings`, {
        headers: { Authorization: `Bearer ${managerToken}` },
      });
      assert.equal(getRes.status, 200);
      const getJson = await getRes.json();
      assert.equal(getJson.success, true);
      assert.equal(getJson.data.settings.rules_only, false);

      // PATCH settings to toggle rules_only: true
      const patchRes = await fetch(`${baseUrl}/v1/orgs/settings`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rules_only: true }),
      });
      assert.equal(patchRes.status, 200);
      const patchJson = await patchRes.json();
      assert.equal(patchJson.success, true);
      assert.equal(patchJson.data.settings.rules_only, true);
      assert.equal(memoryOrg.settings.rules_only, true);
    });
  });
});
