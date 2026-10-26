/**
 * insights.test.js — Tests for Insights Aggregator and API Endpoints.
 *
 * Verifies:
 *   - POST /v1/drafts/:id/request-changes:
 *       - RBAC enforcement (manager allowed, creator/viewer blocked with 403)
 *       - Sets draft.status = 'draft'
 *       - Records AuditLog event 'changes_requested'
 *       - Creates threaded Comment with action = 'request-changes'
 *   - insightsAggregator.js:
 *       - getRuleInsights(): per-rule flag counts, override counts, overrideRate, sorting
 *       - getMistakeInsights(): category grouping, count, topExample extraction
 *       - getTimeToApproval(): avgMs, avgHours, medianMs, medianHours, approvedCount, details
 *       - Graceful handling of empty collections
 *   - GET /v1/insights/rules:
 *       - Requires authentication (401)
 *       - Requires manager role (403 for creator)
 *       - Scoped to tenant organisation
 *       - Returns array of RuleInsight objects
 *   - GET /v1/insights/mistakes:
 *       - Returns repeated mistake categories and timeToApproval
 *       - Requires manager role
 *   - GET /v1/insights/time-to-approval:
 *       - Returns detailed time-to-approval metrics
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
const Finding = require('../src/models/Finding');
const Comment = require('../src/models/Comment');
const Passport = require('../src/models/Passport');
const AuditLog = require('../src/models/AuditLog');
const User = require('../src/models/User');

const {
  getRuleInsights,
  getMistakeInsights,
  getTimeToApproval,
} = require('../src/services/insightsAggregator');

describe('Insights Aggregator & Insights / Request-Changes Routes', () => {
  let server;
  let baseUrl;

  let testOrgId;
  let otherOrgId;
  let managerUserId;
  let creatorUserId;
  let managerToken;
  let creatorToken;

  const originalUserFindById = User.findById;
  const originalFindingFind = Finding.find;
  const originalDraftFind = Draft.find;
  const originalDraftFindOne = Draft.findOne;
  const originalAuditLogFind = AuditLog.find;
  const originalAuditLogSave = AuditLog.prototype.save;
  const originalCommentFind = Comment.find;
  const originalCommentSave = Comment.prototype.save;
  const originalPassportFind = Passport.find;

  let memoryDrafts = new Map();
  let memoryFindings = new Map();
  let memoryComments = new Map();
  let memoryPassports = new Map();
  let memoryAuditLogs = [];

  before(async () => {
    testOrgId = new mongoose.Types.ObjectId();
    otherOrgId = new mongoose.Types.ObjectId();
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

    // Mock User.findById for auth middleware
    User.findById = function (id) {
      const idStr = id.toString();
      const isManager = idStr === managerUserId.toString();
      const userId = isManager ? managerUserId : creatorUserId;
      const role = isManager ? 'manager' : 'creator';
      const name = isManager ? 'Priya Mehta' : 'Rohan Das';

      return {
        populate: function () {
          return {
            select: function () {
              return {
                lean: async function () {
                  return {
                    _id: userId,
                    email: isManager ? 'manager@acme.com' : 'creator@acme.com',
                    name,
                    role,
                    active: true,
                    orgId: {
                      _id: testOrgId,
                      name: 'Acme Corp',
                      active: true,
                      watchlist: ['Project Nova'],
                    },
                  };
                },
              };
            },
          };
        },
      };
    };

    // Express app mounting drafts and insights
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const draftsRouter = require('../src/routes/drafts');
    const insightsRouter = require('../src/routes/insights');

    app.use('/v1/drafts', draftsRouter);
    app.use('/v1/insights', insightsRouter);

    app.use((err, _req, res, _next) => {
      res.status(err.status || 500).json({ success: false, error: err.message, code: err.code });
    });

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    User.findById = originalUserFindById;
    Finding.find = originalFindingFind;
    Draft.find = originalDraftFind;
    Draft.findOne = originalDraftFindOne;
    AuditLog.find = originalAuditLogFind;
    AuditLog.prototype.save = originalAuditLogSave;
    Comment.find = originalCommentFind;
    Comment.prototype.save = originalCommentSave;
    Passport.find = originalPassportFind;

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    memoryDrafts.clear();
    memoryFindings.clear();
    memoryComments.clear();
    memoryPassports.clear();
    memoryAuditLogs = [];

    // Mock Finding.find
    Finding.find = function (query) {
      let items = Array.from(memoryFindings.values());
      if (query.orgId) {
        items = items.filter((f) => f.orgId.toString() === query.orgId.toString());
      }
      if (query.verdict && query.verdict.$ne) {
        items = items.filter((f) => f.verdict !== query.verdict.$ne);
      }
      return {
        lean: async () => items,
        sort: () => ({
          skip: () => ({
            limit: () => ({
              lean: async () => items,
            }),
          }),
        }),
      };
    };

    // Mock Draft.find
    Draft.find = function (query) {
      let items = Array.from(memoryDrafts.values());
      if (query.orgId) {
        items = items.filter((d) => d.orgId.toString() === query.orgId.toString());
      }
      if (query.status) {
        items = items.filter((d) => d.status === query.status);
      }
      return {
        lean: async () => items,
      };
    };

    // Mock Draft.findOne
    Draft.findOne = function (query) {
      const { _id, orgId } = query;
      const found = memoryDrafts.get(_id.toString());
      if (found && (!orgId || found.orgId.toString() === orgId.toString())) {
        const doc = {
          ...found,
          toObject: function () {
            return { ...this };
          },
          save: async function () {
            memoryDrafts.set(this._id.toString(), { ...this });
            return this;
          },
        };
        return {
          ...doc,
          lean: async () => doc,
          then: (resolve) => resolve(doc),
        };
      }
      return {
        lean: async () => null,
        then: (resolve) => resolve(null),
      };
    };

    // Mock AuditLog.find
    AuditLog.find = function (query) {
      let items = memoryAuditLogs.slice();
      if (query.orgId) {
        items = items.filter((l) => l.orgId.toString() === query.orgId.toString());
      }
      if (query.eventType) {
        if (typeof query.eventType === 'string') {
          items = items.filter((l) => l.eventType === query.eventType);
        } else if (query.eventType.$in) {
          items = items.filter((l) => query.eventType.$in.includes(l.eventType));
        }
      }
      return {
        lean: async () => items,
      };
    };

    // Mock AuditLog save
    AuditLog.prototype.save = async function () {
      const obj = {
        _id: new mongoose.Types.ObjectId(),
        orgId: this.orgId,
        actor: this.actor,
        eventType: this.eventType,
        entityType: this.entityType,
        entityId: this.entityId,
        metadata: this.metadata,
        timestamp: this.timestamp || new Date(),
      };
      memoryAuditLogs.push(obj);
      return obj;
    };

    // Mock Comment.find
    Comment.find = function (query) {
      let items = Array.from(memoryComments.values());
      if (query.orgId) {
        items = items.filter((c) => c.orgId.toString() === query.orgId.toString());
      }
      if (query.action) {
        items = items.filter((c) => c.action === query.action);
      }
      return {
        lean: async () => items,
      };
    };

    // Mock Comment.prototype.save
    Comment.prototype.save = async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      const obj = {
        _id: this._id,
        orgId: this.orgId,
        draftId: this.draftId,
        findingId: this.findingId,
        action: this.action,
        type: this.type,
        author: this.author,
        authorName: this.authorName,
        authorRole: this.authorRole,
        text: this.text,
        reason: this.reason,
        thread: this.thread || [],
        createdAt: this.createdAt || new Date(),
        updatedAt: this.updatedAt || new Date(),
        toObject: function () {
          return { ...this };
        },
      };
      memoryComments.set(this._id.toString(), obj);
      return obj;
    };

    // Mock Passport.find
    Passport.find = function (query) {
      let items = Array.from(memoryPassports.values());
      if (query.orgId) {
        items = items.filter((p) => p.orgId.toString() === query.orgId.toString());
      }
      return {
        lean: async () => items,
      };
    };
  });

  describe('POST /v1/drafts/:id/request-changes', () => {
    it('blocks creator from requesting changes (RBAC 403)', async () => {
      const draftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        status: 'in-review',
        author: creatorUserId,
      });

      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/request-changes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creatorToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Needs update.' }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.code, 'ROLE_INSUFFICIENT');
    });

    it('sets draft status back to draft, logs changes_requested AuditLog, and saves comment', async () => {
      const draftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        status: 'in-review',
        author: creatorUserId,
      });

      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/request-changes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Please remove unqualified superlative.' }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.draft.status, 'draft');
      assert.equal(data.comment.action, 'request-changes');
      assert.equal(data.comment.text, 'Please remove unqualified superlative.');

      // Check draft in memory updated
      const updatedDraft = memoryDrafts.get(draftId.toString());
      assert.equal(updatedDraft.status, 'draft');

      // Check AuditLog
      const audit = memoryAuditLogs.find((l) => l.eventType === 'changes_requested');
      assert.ok(audit, 'changes_requested audit event must be logged');
      assert.equal(audit.entityId.toString(), draftId.toString());
      assert.equal(audit.metadata.reason, 'Please remove unqualified superlative.');
    });

    it('returns 404 if draft does not exist', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await fetch(`${baseUrl}/v1/drafts/${nonExistentId}/request-changes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Non-existent draft' }),
      });

      assert.equal(res.status, 404);
    });
  });

  describe('insightsAggregator.js Unit Functions', () => {
    it('getRuleInsights calculates per-rule flag counts, override counts, and overrideRate', async () => {
      const f1Id = new mongoose.Types.ObjectId();
      const f2Id = new mongoose.Types.ObjectId();
      const f3Id = new mongoose.Types.ObjectId();
      const f4Id = new mongoose.Types.ObjectId();

      // Rule A: 3 flags, 2 dismissed/overridden (overrideRate: 0.67)
      memoryFindings.set(f1Id.toString(), {
        _id: f1Id,
        orgId: testOrgId,
        ruleId: 'rule.superlative.unqualified',
        verdict: 'Contradicted',
        status: 'dismissed',
      });
      memoryFindings.set(f2Id.toString(), {
        _id: f2Id,
        orgId: testOrgId,
        ruleId: 'rule.superlative.unqualified',
        verdict: 'Contradicted',
        status: 'open',
      });
      memoryFindings.set(f3Id.toString(), {
        _id: f3Id,
        orgId: testOrgId,
        ruleId: 'rule.superlative.unqualified',
        verdict: 'Contradicted',
        status: 'open',
      });
      // Add override comment for f3
      memoryComments.set('comm1', {
        orgId: testOrgId,
        findingId: f3Id,
        action: 'override',
        reason: 'Manager agreed to keep superlative in context.',
      });

      // Rule B: 1 flag, 0 overridden (overrideRate: 0.0)
      memoryFindings.set(f4Id.toString(), {
        _id: f4Id,
        orgId: testOrgId,
        ruleId: 'rule.cost.claim',
        verdict: 'Contradicted',
        status: 'open',
      });

      const insights = await getRuleInsights(testOrgId);

      assert.equal(insights.length, 2);
      // Ranked by override rate descending: Rule A should be first
      const ruleA = insights.find((r) => r.ruleId === 'rule.superlative.unqualified');
      assert.ok(ruleA);
      assert.equal(ruleA.flagsCount, 3);
      assert.equal(ruleA.totalTriggered, 3);
      assert.equal(ruleA.overrideCount, 2);
      assert.equal(ruleA.overrideRate, 0.67);
      assert.equal(ruleA.description, 'Unqualified superlative detected');

      const ruleB = insights.find((r) => r.ruleId === 'rule.cost.claim');
      assert.ok(ruleB);
      assert.equal(ruleB.flagsCount, 1);
      assert.equal(ruleB.overrideCount, 0);
      assert.equal(ruleB.overrideRate, 0.0);
    });

    it('getMistakeInsights categorizes mistakes and extracts representative topExample', async () => {
      const f1Id = new mongoose.Types.ObjectId();
      const f2Id = new mongoose.Types.ObjectId();
      const f3Id = new mongoose.Types.ObjectId();

      memoryFindings.set(f1Id.toString(), {
        _id: f1Id,
        orgId: testOrgId,
        ruleId: 'rule.date.outdated',
        verdict: 'Outdated',
        suggestedFix: 'Our 30-day return window is fair.',
        status: 'open',
      });

      memoryFindings.set(f2Id.toString(), {
        _id: f2Id,
        orgId: testOrgId,
        ruleId: 'rule.date.outdated',
        verdict: 'Outdated',
        suggestedFix: 'Returns are accepted within 30 days.',
        status: 'open',
      });

      memoryFindings.set(f3Id.toString(), {
        _id: f3Id,
        orgId: testOrgId,
        ruleId: 'rule.superlative.unqualified',
        verdict: 'Contradicted',
        suggestedFix: 'We offer an industry standard returns policy.',
        status: 'open',
      });

      const mistakes = await getMistakeInsights(testOrgId);

      assert.equal(mistakes.length, 2);
      // Top category should be Contradicted temporal claim (count: 2)
      assert.equal(mistakes[0].category, 'Contradicted temporal claim');
      assert.equal(mistakes[0].count, 2);
      assert.ok(mistakes[0].topExample.length > 0);

      assert.equal(mistakes[1].category, 'Unqualified superlative claim');
      assert.equal(mistakes[1].count, 1);
    });

    it('getTimeToApproval computes average and median durations across approved drafts', async () => {
      const draft1Id = new mongoose.Types.ObjectId();
      const draft2Id = new mongoose.Types.ObjectId();

      const baseTime = Date.now() - 3600000 * 10; // 10 hours ago

      // Draft 1: took 2 hours to approve
      memoryDrafts.set(draft1Id.toString(), {
        _id: draft1Id,
        orgId: testOrgId,
        status: 'approved',
        createdAt: new Date(baseTime),
        updatedAt: new Date(baseTime + 3600000 * 2), // 2 hours later
      });

      // Draft 2: took 4 hours to approve
      memoryDrafts.set(draft2Id.toString(), {
        _id: draft2Id,
        orgId: testOrgId,
        status: 'approved',
        createdAt: new Date(baseTime),
        updatedAt: new Date(baseTime + 3600000 * 4), // 4 hours later
      });

      // Add audit log for draft 2 approval
      memoryAuditLogs.push({
        orgId: testOrgId,
        eventType: 'draft_approved',
        entityId: draft2Id,
        timestamp: new Date(baseTime + 3600000 * 4),
      });

      const metrics = await getTimeToApproval(testOrgId);

      assert.equal(metrics.approvedCount, 2);
      assert.equal(metrics.avgHours, 3.0); // (2 + 4) / 2 = 3.0
      assert.equal(metrics.medianHours, 3.0);
      assert.equal(metrics.minMs, 3600000 * 2);
      assert.equal(metrics.maxMs, 3600000 * 4);
      assert.equal(metrics.details.length, 2);
    });

    it('returns empty results gracefully when organisation has no findings or drafts', async () => {
      const emptyOrgId = new mongoose.Types.ObjectId();

      const rules = await getRuleInsights(emptyOrgId);
      assert.deepEqual(rules, []);

      const mistakes = await getMistakeInsights(emptyOrgId);
      assert.deepEqual(mistakes, []);

      const timeMetrics = await getTimeToApproval(emptyOrgId);
      assert.equal(timeMetrics.approvedCount, 0);
      assert.equal(timeMetrics.avgHours, 0);
      assert.deepEqual(timeMetrics.details, []);
    });
  });

  describe('GET /v1/insights/rules Endpoint', () => {
    it('returns 401 when no token is provided', async () => {
      const res = await fetch(`${baseUrl}/v1/insights/rules`);
      assert.equal(res.status, 401);
    });

    it('returns 403 when called by a creator', async () => {
      const res = await fetch(`${baseUrl}/v1/insights/rules`, {
        headers: { Authorization: `Bearer ${creatorToken}` },
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.code, 'ROLE_INSUFFICIENT');
    });

    it('returns 200 with rules data when called by a manager', async () => {
      const fId = new mongoose.Types.ObjectId();
      memoryFindings.set(fId.toString(), {
        _id: fId,
        orgId: testOrgId,
        ruleId: 'rule.superlative.unqualified',
        verdict: 'Contradicted',
        status: 'dismissed',
      });

      const res = await fetch(`${baseUrl}/v1/insights/rules`, {
        headers: { Authorization: `Bearer ${managerToken}` },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(Array.isArray(data.data));
      assert.equal(data.data.length, 1);
      assert.equal(data.data[0].ruleId, 'rule.superlative.unqualified');
      assert.equal(data.data[0].overrideRate, 1.0);
      assert.equal(data.data[0].totalTriggered, 1);
    });
  });

  describe('GET /v1/insights/mistakes Endpoint', () => {
    it('returns 200 with mistakes data and timeToApproval when called by a manager', async () => {
      const fId = new mongoose.Types.ObjectId();
      memoryFindings.set(fId.toString(), {
        _id: fId,
        orgId: testOrgId,
        ruleId: 'rule.date.outdated',
        verdict: 'Outdated',
        suggestedFix: '30-day returns policy applies.',
        status: 'open',
      });

      const draftId = new mongoose.Types.ObjectId();
      const createTime = Date.now() - 3600000;
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        status: 'approved',
        createdAt: new Date(createTime),
        updatedAt: new Date(createTime + 1800000), // 30 mins
      });

      const res = await fetch(`${baseUrl}/v1/insights/mistakes`, {
        headers: { Authorization: `Bearer ${managerToken}` },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(Array.isArray(data.data));
      assert.equal(data.data[0].category, 'Contradicted temporal claim');
      assert.equal(data.data[0].count, 1);

      assert.ok(data.timeToApproval);
      assert.equal(data.timeToApproval.approvedCount, 1);
      assert.equal(data.timeToApproval.avgHours, 0.5);
    });
  });

  describe('GET /v1/insights/time-to-approval Endpoint', () => {
    it('returns detailed duration statistics for managers', async () => {
      const res = await fetch(`${baseUrl}/v1/insights/time-to-approval`, {
        headers: { Authorization: `Bearer ${managerToken}` },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(data.data);
      assert.equal(typeof data.data.avgHours, 'number');
    });
  });
});
