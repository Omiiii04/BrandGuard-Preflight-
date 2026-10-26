/**
 * commentsAndApproval.test.js — Integration tests for Comments, Approval, and Brand Passport routes.
 *
 * Verifies:
 *   - POST /v1/drafts/:id/comments (threaded, orgId-scoped, AuditLog: comment_added)
 *   - GET  /v1/drafts/:id/comments (orgId-scoped, findingId filter, populated thread)
 *   - POST /v1/drafts/:id/approve (RBAC manager only; new DraftVersion; triggers passportBuilder; status = approved; AuditLog: draft_approved & passport_created)
 *   - Conflict handling: blocks approval when open findings exist (409)
 *   - POST /v1/drafts/:id/request-changes (RBAC manager only; status = draft; AuditLog: changes_requested)
 *   - GET  /v1/passports/:id (retrieves Brand Passport record)
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
const Comment = require('../src/models/Comment');
const Passport = require('../src/models/Passport');
const AuditLog = require('../src/models/AuditLog');
const User = require('../src/models/User');

describe('Drafts Comments, Approval, and Passport Routes', () => {
  let server;
  let baseUrl;

  let testOrgId;
  let otherOrgId;
  let managerUserId;
  let creatorUserId;
  let managerToken;
  let creatorToken;

  const originalUserFindById = User.findById;

  let memoryDrafts = new Map();
  let memoryDraftVersions = new Map();
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

    // Mock User.findById for authentication
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

    // Express app mounting drafts and passports routers
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const draftsRouter = require('../src/routes/drafts');
    const passportsRouter = require('../src/routes/passports');

    app.use('/v1/drafts', draftsRouter);
    app.use('/v1/passports', passportsRouter);

    app.use((err, _req, res, _next) => {
      res.status(err.status || 500).json({ success: false, error: err.message });
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
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    memoryDrafts.clear();
    memoryDraftVersions.clear();
    memoryFindings.clear();
    memoryComments.clear();
    memoryPassports.clear();
    memoryAuditLogs = [];

    // Mock Draft methods
    Draft.findOne = function (query) {
      const { _id, orgId } = query;
      const found = memoryDrafts.get(_id.toString());
      if (found && found.orgId.toString() === orgId.toString()) {
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
          lean: async () => ({ ...found }),
          then: (resolve) => resolve(doc),
        };
      }
      return {
        lean: async () => null,
        then: (resolve) => resolve(null),
      };
    };

    // Mock DraftVersion methods
    DraftVersion.findOne = function (query) {
      return {
        sort: function (_sortObj) {
          const matching = Array.from(memoryDraftVersions.values()).filter(
            (v) => v.draftId.toString() === query.draftId.toString() && v.orgId.toString() === query.orgId.toString()
          );
          matching.sort((a, b) => b.versionNumber - a.versionNumber);
          const top = matching[0] || null;
          return {
            then: (resolve) => resolve(top),
          };
        },
      };
    };

    DraftVersion.prototype.save = async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      memoryDraftVersions.set(this._id.toString(), {
        _id: this._id,
        draftId: this.draftId,
        orgId: this.orgId,
        versionNumber: this.versionNumber,
        content: this.content,
        contentHash: this.contentHash,
        diff: this.diff,
        author: this.author,
        createdAt: this.createdAt || new Date(),
        toObject: function () {
          return { ...this };
        },
      });
      return this;
    };

    // Mock Finding methods
    Finding.countDocuments = async function (query) {
      let count = 0;
      for (const finding of memoryFindings.values()) {
        if (
          finding.draftId.toString() === query.draftId.toString() &&
          finding.orgId.toString() === query.orgId.toString() &&
          (!query.status || finding.status === query.status)
        ) {
          count++;
        }
      }
      return count;
    };

    // Mock Comment methods
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
      };
      memoryComments.set(this._id.toString(), obj);
      return this;
    };

    Comment.findOne = function (query) {
      const { _id, draftId, orgId } = query;
      const c = memoryComments.get(_id.toString());
      if (c && c.draftId.toString() === draftId.toString() && c.orgId.toString() === orgId.toString()) {
        const doc = {
          ...c,
          save: async function () {
            memoryComments.set(this._id.toString(), { ...this });
            return this;
          },
        };
        return {
          then: (resolve) => resolve(doc),
        };
      }
      return {
        then: (resolve) => resolve(null),
      };
    };

    Comment.findById = function (id) {
      const c = memoryComments.get(id.toString());
      return {
        populate: function () {
          return {
            populate: function () {
              return {
                lean: async function () {
                  return c ? { ...c } : null;
                },
              };
            },
            lean: async function () {
              return c ? { ...c } : null;
            },
          };
        },
        lean: async function () {
          return c ? { ...c } : null;
        },
      };
    };

    Comment.find = function (query) {
      const filtered = Array.from(memoryComments.values()).filter((c) => {
        if (query.draftId && c.draftId.toString() !== query.draftId.toString()) return false;
        if (query.orgId && c.orgId.toString() !== query.orgId.toString()) return false;
        if (query.findingId && (!c.findingId || c.findingId.toString() !== query.findingId.toString())) return false;
        return true;
      });

      return {
        sort: function () {
          return {
            populate: function () {
              return {
                populate: function () {
                  return {
                    lean: async () => filtered.map((item) => ({ ...item })),
                  };
                },
                lean: async () => filtered.map((item) => ({ ...item })),
              };
            },
            lean: async () => filtered.map((item) => ({ ...item })),
          };
        },
      };
    };

    // Mock Passport methods
    Passport.prototype.save = async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      const obj = {
        _id: this._id,
        orgId: this.orgId,
        draftId: this.draftId,
        draftVersionId: this.draftVersionId,
        contentHash: this.contentHash,
        checksRun: this.checksRun,
        rulesVersion: this.rulesVersion,
        approvers: this.approvers,
        aiUsed: this.aiUsed,
        timestamp: this.timestamp || new Date(),
        toObject: function () {
          return { ...this };
        },
      };
      memoryPassports.set(this._id.toString(), obj);
      return this;
    };

    Passport.findOne = function (query) {
      const { _id, orgId } = query;
      const found = memoryPassports.get(_id.toString());
      if (found && found.orgId.toString() === orgId.toString()) {
        return {
          populate: function () {
            return {
              lean: async function () {
                return { ...found };
              },
            };
          },
          lean: async function () {
            return { ...found };
          },
        };
      }
      return {
        populate: function () {
          return {
            lean: async function () {
              return null;
            },
          };
        },
        lean: async function () {
          return null;
        },
      };
    };

    // Mock AuditLog.prototype.save
    AuditLog.prototype.save = async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      memoryAuditLogs.push(this);
      return this;
    };
  });

  describe('POST /v1/drafts/:id/comments', () => {
    it('rejects missing or empty text with 400 MISSING_TEXT', async () => {
      const draftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        status: 'draft',
      });

      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creatorToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: '   ' }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.code, 'MISSING_TEXT');
    });

    it('rejects invalid action with 400 INVALID_ACTION', async () => {
      const draftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        status: 'draft',
      });

      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creatorToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Some note', action: 'invalid-action' }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'INVALID_ACTION');
    });

    it('requires a reason when action is override (400 REASON_REQUIRED)', async () => {
      const draftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        status: 'draft',
      });

      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Overriding claim', action: 'override' }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'REASON_REQUIRED');
    });

    it('successfully creates root comment, persists thread, and writes comment_added AuditLog', async () => {
      const draftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        status: 'draft',
      });

      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creatorToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Please check returns policy section 4.2.',
          action: 'comment',
        }),
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.text, 'Please check returns policy section 4.2.');
      assert.equal(data.action, 'comment');
      assert.equal(data.thread.length, 1);
      assert.equal(data.thread[0].text, 'Please check returns policy section 4.2.');

      // Check AuditLog entry
      const audit = memoryAuditLogs.find((l) => l.eventType === 'comment_added');
      assert.ok(audit, 'AuditLog event comment_added should be logged');
      assert.equal(audit.entityType, 'comment');
    });

    it('successfully appends threaded reply when parentCommentId is provided', async () => {
      const draftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        status: 'draft',
      });

      // 1. Create root comment
      const rootRes = await fetch(`${baseUrl}/v1/drafts/${draftId}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creatorToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Initial comment on draft' }),
      });
      const rootData = await rootRes.json();
      const commentId = rootData._id;

      // 2. Post reply
      const replyRes = await fetch(`${baseUrl}/v1/drafts/${draftId}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Agreed, revised in section 2.',
          commentId,
        }),
      });

      assert.equal(replyRes.status, 201);
      const replyData = await replyRes.json();
      assert.equal(replyData.thread.length, 2);
      assert.equal(replyData.thread[1].text, 'Agreed, revised in section 2.');
    });

    it('enforces org isolation: returns 404 for draft in another organisation', async () => {
      const otherDraftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(otherDraftId.toString(), {
        _id: otherDraftId,
        orgId: otherOrgId,
        status: 'draft',
      });

      const res = await fetch(`${baseUrl}/v1/drafts/${otherDraftId}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creatorToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Cross-tenant attempt' }),
      });

      assert.equal(res.status, 404);
    });
  });

  describe('GET /v1/drafts/:id/comments', () => {
    it('retrieves all comments for a draft including findingId filtering', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const findingId1 = new mongoose.Types.ObjectId();
      const findingId2 = new mongoose.Types.ObjectId();

      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        status: 'draft',
      });

      // Add two comments
      memoryComments.set('c1', {
        _id: 'c1',
        orgId: testOrgId,
        draftId,
        findingId: findingId1,
        text: 'Issue on finding 1',
        action: 'comment',
        thread: [{ text: 'Issue on finding 1', timestamp: new Date() }],
        createdAt: new Date(),
      });

      memoryComments.set('c2', {
        _id: 'c2',
        orgId: testOrgId,
        draftId,
        findingId: findingId2,
        text: 'Issue on finding 2',
        action: 'comment',
        thread: [{ text: 'Issue on finding 2', timestamp: new Date() }],
        createdAt: new Date(),
      });

      // Get all
      const resAll = await fetch(`${baseUrl}/v1/drafts/${draftId}/comments`, {
        headers: { Authorization: `Bearer ${creatorToken}` },
      });
      assert.equal(resAll.status, 200);
      const allData = await resAll.json();
      assert.equal(allData.data.length, 2);

      // Filter by findingId
      const resFilter = await fetch(`${baseUrl}/v1/drafts/${draftId}/comments?findingId=${findingId1}`, {
        headers: { Authorization: `Bearer ${creatorToken}` },
      });
      assert.equal(resFilter.status, 200);
      const filterData = await resFilter.json();
      assert.equal(filterData.data.length, 1);
      assert.equal(filterData.data[0]._id, 'c1');
    });
  });

  describe('POST /v1/drafts/:id/approve', () => {
    it('enforces RBAC: returns 403 when called by a creator', async () => {
      const draftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        status: 'checked',
      });

      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creatorToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.code, 'ROLE_INSUFFICIENT');
    });

    it('returns 409 Conflict when draft has open findings', async () => {
      const draftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        status: 'checked',
      });

      // Add an open finding
      const findingId = new mongoose.Types.ObjectId();
      memoryFindings.set(findingId.toString(), {
        _id: findingId,
        orgId: testOrgId,
        draftId,
        status: 'open',
      });

      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 409);
      const data = await res.json();
      assert.equal(data.code, 'OPEN_FINDINGS_EXIST');
      assert.equal(data.openFindingsCount, 1);
    });

    it('manager approval creates new DraftVersion, triggers passportBuilder, sets status=approved, writes draft_approved & passport_created AuditLogs', async () => {
      const draftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        status: 'checked',
        currentVersion: 1,
      });

      // Previous v1 DraftVersion
      memoryDraftVersions.set('v1', {
        _id: new mongoose.Types.ObjectId(),
        draftId,
        orgId: testOrgId,
        versionNumber: 1,
        content: 'Original draft content with 14-day returns.',
        contentHash: 'a'.repeat(64),
      });

      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'Approved draft content with 30-day returns.',
          comment: 'Approved by Priya Mehta.',
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);

      // 1. Draft status updated to 'approved' and currentVersion incremented
      assert.equal(data.draft.status, 'approved');
      assert.equal(data.draft.currentVersion, 2);

      // 2. New DraftVersion created
      assert.ok(data.version);
      assert.equal(data.version.versionNumber, 2);
      assert.equal(data.version.content, 'Approved draft content with 30-day returns.');
      assert.equal(data.version.contentHash.length, 64);

      // 3. Brand Passport generated via passportBuilder
      assert.ok(data.passport);
      assert.equal(data.passport.contentHash, data.version.contentHash);
      assert.deepEqual(data.passport.checksRun, ['claim_match', 'contradiction', 'rules', 'premortem']);
      assert.equal(data.passport.rulesVersion, 'v1.2');
      assert.equal(data.passport.aiUsed, true);
      assert.equal(data.passport.approvers.length, 1);

      // 4. Stored in append-only passports collection
      const storedPassport = memoryPassports.get(data.passport._id.toString());
      assert.ok(storedPassport, 'Passport must be stored in collection');

      // 5. AuditLog events: draft_approved and passport_created
      const approvedLog = memoryAuditLogs.find((l) => l.eventType === 'draft_approved');
      assert.ok(approvedLog, 'draft_approved audit event must be logged');
      assert.equal(approvedLog.entityId.toString(), draftId.toString());

      const passportLog = memoryAuditLogs.find((l) => l.eventType === 'passport_created');
      assert.ok(passportLog, 'passport_created audit event must be logged');
    });
  });

  describe('POST /v1/drafts/:id/request-changes', () => {
    it('sets status back to draft, logs changes_requested AuditLog, and records comment', async () => {
      const draftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: testOrgId,
        status: 'checked',
      });

      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/request-changes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Please remove superlative claims.' }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.draft.status, 'draft');
      assert.equal(data.comment.action, 'request-changes');
      assert.equal(data.comment.text, 'Please remove superlative claims.');

      const audit = memoryAuditLogs.find((l) => l.eventType === 'changes_requested');
      assert.ok(audit, 'AuditLog event changes_requested must be recorded');
    });
  });

  describe('GET /v1/passports/:id', () => {
    it('retrieves saved Brand Passport by ID', async () => {
      const passportId = new mongoose.Types.ObjectId();
      const draftId = new mongoose.Types.ObjectId();

      memoryPassports.set(passportId.toString(), {
        _id: passportId,
        orgId: testOrgId,
        draftId,
        contentHash: 'b'.repeat(64),
        checksRun: ['claim_match', 'contradiction', 'rules', 'premortem'],
        rulesVersion: 'v1.2',
        approvers: [managerUserId],
        aiUsed: true,
        timestamp: new Date(),
      });

      const res = await fetch(`${baseUrl}/v1/passports/${passportId}`, {
        headers: { Authorization: `Bearer ${managerToken}` },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data._id.toString(), passportId.toString());
      assert.equal(data.contentHash, 'b'.repeat(64));
    });

    it('returns 404 when passport does not exist', async () => {
      const randomId = new mongoose.Types.ObjectId();
      const res = await fetch(`${baseUrl}/v1/passports/${randomId}`, {
        headers: { Authorization: `Bearer ${managerToken}` },
      });

      assert.equal(res.status, 404);
    });
  });
});
