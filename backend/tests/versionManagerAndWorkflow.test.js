/**
 * versionManagerAndWorkflow.test.js — Tests for versionManager, workflowEngine shelf-life, and passport routes.
 */

'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'brandguard-super-secret-jwt-key-change-me-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const Draft = require('../src/models/Draft');
const DraftVersion = require('../src/models/DraftVersion');
const Finding = require('../src/models/Finding');
const Passport = require('../src/models/Passport');
const Source = require('../src/models/Source');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const { sha256 } = require('../src/utils/hash');

const {
  computeLineDiff,
  computeTextDiff,
  createDraftVersionOnAcceptedFix,
  getVersions,
} = require('../src/services/versionManager');

const {
  checkClaimShelfLife,
  determineReviewRouting,
  canTransitionDraft,
} = require('../src/services/workflowEngine');

const passportsRouter = require('../src/routes/passports');
const draftsRouter = require('../src/routes/drafts');
const findingsRouter = require('../src/routes/findings');
const { errorHandler } = require('../src/middleware/errorHandler');

describe('VersionManager, Claim Shelf-Life & Passport Routes', () => {
  const testOrgId = new mongoose.Types.ObjectId();
  const otherOrgId = new mongoose.Types.ObjectId();
  const managerUserId = new mongoose.Types.ObjectId();
  const creatorUserId = new mongoose.Types.ObjectId();

  const managerToken = jwt.sign(
    { sub: managerUserId.toString(), orgId: testOrgId.toString(), role: 'manager' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const creatorToken = jwt.sign(
    { sub: creatorUserId.toString(), orgId: testOrgId.toString(), role: 'creator' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const otherOrgToken = jwt.sign(
    { sub: creatorUserId.toString(), orgId: otherOrgId.toString(), role: 'creator' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  let server;
  let baseUrl;

  // In-memory collections for mocking
  const memoryDrafts = new Map();
  const memoryDraftVersions = new Map();
  const memoryFindings = new Map();
  const memoryPassports = new Map();
  const memorySources = new Map();

  const originalUserFindById = User.findById;
  const originalAuditLogSave = AuditLog.prototype.save;

  before(async () => {
    AuditLog.prototype.save = async function () { return this; };

    // Mock User.findById
    User.findById = function (id) {
      const idStr = id?.toString ? id.toString() : id;
      const isOther = idStr === otherOrgId.toString();
      const orgId = isOther ? otherOrgId : testOrgId;
      const role = idStr === managerUserId.toString() ? 'manager' : 'creator';

      return {
        populate: function () {
          return {
            select: function () {
              return {
                lean: async function () {
                  return {
                    _id: new mongoose.Types.ObjectId(idStr),
                    name: role === 'manager' ? 'Test Manager' : 'Test Creator',
                    email: `${role}@test.com`,
                    role,
                    active: true,
                    orgId: {
                      _id: orgId,
                      name: 'Test Tenant',
                      active: true,
                      watchlist: [],
                    },
                  };
                },
              };
            },
          };
        },
      };
    };

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.use('/v1/passports', passportsRouter);
    app.use('/v1/drafts', draftsRouter);
    app.use('/v1/findings', findingsRouter);
    app.use(errorHandler);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    User.findById = originalUserFindById;
    AuditLog.prototype.save = originalAuditLogSave;
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    memoryDrafts.clear();
    memoryDraftVersions.clear();
    memoryFindings.clear();
    memoryPassports.clear();
    memorySources.clear();
  });

  // =========================================================================
  // 1. VersionManager Unit Tests
  // =========================================================================
  describe('versionManager.js unit tests', () => {
    it('computeLineDiff produces line changes correctly', () => {
      const oldText = 'Line 1\nLine 2';
      const newText = 'Line 1\nLine 2 modified';

      const diff = computeLineDiff(oldText, newText);
      assert.ok(Array.isArray(diff));
      assert.equal(diff[0].type, 'unchanged');
      assert.equal(diff[0].text, 'Line 1');
      assert.equal(diff[1].type, 'removed');
      assert.equal(diff[1].text, 'Line 2');
      assert.equal(diff[2].type, 'added');
      assert.equal(diff[2].text, 'Line 2 modified');
    });

    it('computeTextDiff returns empty string when texts are identical', () => {
      const text = 'Identical content across versions.';
      assert.equal(computeTextDiff(text, text), '');
    });

    it('computeTextDiff produces unified diff format with version headers', () => {
      const oldText = 'Original terms: 14 days refund policy.';
      const newText = 'Updated terms: 30 days refund policy.';

      const diff = computeTextDiff(oldText, newText, { oldVersion: 1, newVersion: 2 });
      assert.ok(diff.includes('--- v1'));
      assert.ok(diff.includes('+++ v2'));
      assert.ok(diff.includes('-Original terms: 14 days refund policy.'));
      assert.ok(diff.includes('+Updated terms: 30 days refund policy.'));
    });

    it('createDraftVersionOnAcceptedFix increments version, stores SHA-256 and computes diff', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const initialContent = 'Free returns within 14 days of purchase.';
      const initialHash = sha256(initialContent);

      const mockDraft = {
        _id: draftId,
        orgId: testOrgId,
        currentVersion: 1,
        status: 'in-review',
        save: async function () { return this; },
      };

      const mockV1 = {
        _id: new mongoose.Types.ObjectId(),
        draftId,
        orgId: testOrgId,
        versionNumber: 1,
        content: initialContent,
        contentHash: initialHash,
      };

      // Mock DB calls
      const origDraftFindOne = Draft.findOne;
      const origVersionFindOne = DraftVersion.findOne;
      let savedVersionDoc = null;
      const origVersionSave = DraftVersion.prototype.save;

      Draft.findOne = async () => mockDraft;
      DraftVersion.findOne = () => ({
        sort: () => mockV1,
      });
      DraftVersion.prototype.save = async function () {
        savedVersionDoc = this;
        return this;
      };

      try {
        const finding = {
          _id: new mongoose.Types.ObjectId(),
          draftId,
          orgId: testOrgId,
          span: { start: 20, end: 27 }, // "14 days"
          suggestedFix: '30 days',
        };

        const result = await createDraftVersionOnAcceptedFix({
          finding,
          draftId,
          orgId: testOrgId,
          actor: managerUserId,
        });

        assert.ok(result);
        assert.equal(result.versionNumber, 2);
        assert.equal(mockDraft.currentVersion, 2);

        const expectedContent = 'Free returns within 30 days of purchase.';
        assert.equal(result.draftVersion.content, expectedContent);
        assert.equal(result.contentHash, sha256(expectedContent));
        assert.ok(result.diff.includes('--- v1'));
        assert.ok(result.diff.includes('+++ v2'));
        assert.ok(result.diff.includes('-Free returns within 14 days of purchase.'));
        assert.ok(result.diff.includes('+Free returns within 30 days of purchase.'));
      } finally {
        Draft.findOne = origDraftFindOne;
        DraftVersion.findOne = origVersionFindOne;
        DraftVersion.prototype.save = origVersionSave;
      }
    });

    it('getVersions returns all versions sorted by versionNumber', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const mockVersions = [
        { versionNumber: 1, contentHash: '1'.repeat(64) },
        { versionNumber: 2, contentHash: '2'.repeat(64) },
      ];

      const origFind = DraftVersion.find;
      DraftVersion.find = () => ({
        sort: () => ({
          lean: async () => mockVersions,
        }),
      });

      try {
        const versions = await getVersions(draftId, testOrgId);
        assert.equal(versions.length, 2);
        assert.equal(versions[0].versionNumber, 1);
        assert.equal(versions[1].versionNumber, 2);
      } finally {
        DraftVersion.find = origFind;
      }
    });
  });

  // =========================================================================
  // 2. WorkflowEngine Claim Shelf-Life Unit Tests
  // =========================================================================
  describe('workflowEngine.js Claim Shelf-Life logic', () => {
    it('creates additional Finding with verdict = Outdated when passage expiryDate has passed', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const draftVersionId = new mongoose.Types.ObjectId();
      const pastDate = new Date('2025-01-01T00:00:00.000Z');

      const claims = [
        {
          span: { start: 0, end: 35 },
          verdict: 'Supported',
          confidence: 0.98,
          suggestedFix: null,
          evidence: {
            passageId: 'pass_returns_2024',
            fileName: 'Returns Policy 2024.pdf',
            expiryDate: pastDate,
            passage: 'Returns accepted within 14 days.',
          },
        },
      ];

      const findings = await checkClaimShelfLife({
        claims,
        draftId,
        draftVersionId,
        orgId: testOrgId,
        now: new Date('2026-10-27T00:00:00.000Z'),
      });

      assert.equal(findings.length, 1);
      const outdatedFinding = findings[0];
      assert.equal(outdatedFinding.verdict, 'Outdated');
      assert.equal(outdatedFinding.type, 'violation');
      assert.equal(outdatedFinding.ruleId, 'rule.shelf_life.expired');
      assert.equal(outdatedFinding.span.start, 0);
      assert.equal(outdatedFinding.span.end, 35);
      assert.ok(outdatedFinding.explanation.includes('expired on 2025-01-01'));
      assert.equal(outdatedFinding.evidence.fileName, 'Returns Policy 2024.pdf');
    });

    it('does NOT create Outdated finding when passage expiryDate is in the future', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const draftVersionId = new mongoose.Types.ObjectId();
      const futureDate = new Date('2028-12-31T00:00:00.000Z');

      const claims = [
        {
          span: { start: 10, end: 40 },
          verdict: 'Supported',
          confidence: 0.95,
          evidence: {
            passageId: 'pass_active_terms',
            fileName: 'Active Terms.pdf',
            expiryDate: futureDate,
            passage: 'Valid active terms passage.',
          },
        },
      ];

      const findings = await checkClaimShelfLife({
        claims,
        draftId,
        draftVersionId,
        orgId: testOrgId,
        now: new Date('2026-10-27T00:00:00.000Z'),
      });

      assert.equal(findings.length, 0);
    });

    it('resolves expiryDate from Source database record when not on evidence object', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const draftVersionId = new mongoose.Types.ObjectId();
      const sourceId = new mongoose.Types.ObjectId();
      const expiredDate = new Date('2024-06-30T00:00:00.000Z');

      const origSourceFindOne = Source.findOne;
      Source.findOne = () => ({
        lean: async () => ({
          _id: sourceId,
          orgId: testOrgId,
          fileName: 'DB Source Policy.pdf',
          expiryDate: expiredDate,
        }),
      });

      try {
        const claims = [
          {
            span: { start: 5, end: 25 },
            verdict: 'Supported',
            confidence: 0.92,
            proofPassageId: sourceId,
            evidence: {
              passageId: 'pass_db_source',
              fileName: 'DB Source Policy.pdf',
              // expiryDate absent on evidence
            },
          },
        ];

        const findings = await checkClaimShelfLife({
          claims,
          draftId,
          draftVersionId,
          orgId: testOrgId,
          now: new Date('2026-10-27T00:00:00.000Z'),
        });

        assert.equal(findings.length, 1);
        assert.equal(findings[0].verdict, 'Outdated');
        assert.ok(findings[0].explanation.includes('2024-06-30'));
      } finally {
        Source.findOne = origSourceFindOne;
      }
    });

    it('determineReviewRouting routes high confidence contradictions to creator and manager', () => {
      const findings = [
        { verdict: 'Contradicted', confidence: 0.90 },
      ];
      const routing = determineReviewRouting({}, findings);
      assert.deepEqual(routing.targetRoles, ['creator', 'manager']);
      assert.equal(routing.priority, 'high');
    });

    it('canTransitionDraft enforces lifecycle state transitions', () => {
      assert.equal(canTransitionDraft('draft', 'checked'), true);
      assert.equal(canTransitionDraft('checked', 'in-review'), true);
      assert.equal(canTransitionDraft('in-review', 'approved'), true);
      assert.equal(canTransitionDraft('approved', 'published'), true);
      assert.equal(canTransitionDraft('draft', 'published'), false);
    });
  });

  // =========================================================================
  // 3. GET /v1/passports/:id Integration Route Tests
  // =========================================================================
  describe('GET /v1/passports/:id Route', () => {
    it('returns 400 for invalid ObjectId format', async () => {
      const res = await fetch(`${baseUrl}/v1/passports/not-an-id`, {
        headers: { Authorization: `Bearer ${managerToken}` },
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'INVALID_ID');
    });

    it('returns 404 when passport is not found', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const origFindOne = Passport.findOne;
      Passport.findOne = () => ({
        populate: () => ({
          lean: async () => null,
          sort: () => ({ lean: async () => null }),
        }),
      });

      try {
        const res = await fetch(`${baseUrl}/v1/passports/${nonExistentId}`, {
          headers: { Authorization: `Bearer ${managerToken}` },
        });
        assert.equal(res.status, 404);
        const data = await res.json();
        assert.equal(data.code, 'NOT_FOUND');
      } finally {
        Passport.findOne = origFindOne;
      }
    });

    it('retrieves Brand Passport by passport _id with populated approvers', async () => {
      const passportId = new mongoose.Types.ObjectId();
      const draftId = new mongoose.Types.ObjectId();
      const contentHash = sha256('Approved content string');

      const mockPassport = {
        _id: passportId,
        orgId: testOrgId,
        draftId,
        contentHash,
        checksRun: ['claim_match', 'contradiction', 'rules', 'premortem'],
        rulesVersion: 'v1.2',
        aiUsed: true,
        approvers: [{ _id: managerUserId, name: 'Test Manager', email: 'manager@test.com', role: 'manager' }],
        timestamp: new Date(),
      };

      const origFindOne = Passport.findOne;
      Passport.findOne = (query) => ({
        populate: () => ({
          lean: async () => (query._id?.toString() === passportId.toString() ? mockPassport : null),
          sort: () => ({ lean: async () => null }),
        }),
      });

      try {
        const res = await fetch(`${baseUrl}/v1/passports/${passportId}`, {
          headers: { Authorization: `Bearer ${managerToken}` },
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data._id.toString(), passportId.toString());
        assert.equal(data.contentHash, contentHash);
        assert.equal(data.checksRun.length, 4);
        assert.equal(data.approvers[0].name, 'Test Manager');
      } finally {
        Passport.findOne = origFindOne;
      }
    });

    it('retrieves Brand Passport for draft via GET /v1/drafts/:id/passport', async () => {
      const passportId = new mongoose.Types.ObjectId();
      const draftId = new mongoose.Types.ObjectId();
      const contentHash = sha256('Approved content for draftId lookup');

      const mockPassport = {
        _id: passportId,
        orgId: testOrgId,
        draftId,
        contentHash,
        checksRun: ['claim_match', 'rules'],
        rulesVersion: 'v1.2',
        aiUsed: true,
        approvers: [{ _id: managerUserId, name: 'Test Manager', email: 'manager@test.com', role: 'manager' }],
        timestamp: new Date(),
      };

      const origFindOne = Passport.findOne;
      Passport.findOne = (query) => ({
        populate: () => ({
          sort: () => ({
            lean: async () => (query.draftId ? mockPassport : null),
          }),
          lean: async () => (query.draftId ? mockPassport : null),
        }),
      });

      try {
        const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/passport`, {
          headers: { Authorization: `Bearer ${managerToken}` },
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data._id.toString(), passportId.toString());
        assert.equal(data.draftId.toString(), draftId.toString());
      } finally {
        Passport.findOne = origFindOne;
      }
    });

    it('rejects mutation attempts (PATCH /v1/passports/:id) with 405 Method Not Allowed', async () => {
      const passportId = new mongoose.Types.ObjectId();
      const res = await fetch(`${baseUrl}/v1/passports/${passportId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contentHash: 'tampered' }),
      });
      assert.equal(res.status, 405);
      const data = await res.json();
      assert.equal(data.code, 'METHOD_NOT_ALLOWED');
    });
  });

  // =========================================================================
  // 4. GET /v1/drafts/:id/versions Route Tests
  // =========================================================================
  describe('GET /v1/drafts/:id/versions Route', () => {
    it('returns version history via versionManager', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const mockDraft = { _id: draftId, orgId: testOrgId, title: 'Draft Promo' };
      const mockVersions = [
        { _id: new mongoose.Types.ObjectId(), draftId, versionNumber: 1, contentHash: sha256('v1 text'), diff: '' },
        { _id: new mongoose.Types.ObjectId(), draftId, versionNumber: 2, contentHash: sha256('v2 text'), diff: '--- v1\n+++ v2' },
      ];

      const origDraftFindOne = Draft.findOne;
      const origVersionFind = DraftVersion.find;

      Draft.findOne = () => ({ lean: async () => mockDraft });
      DraftVersion.find = () => ({
        sort: () => ({ lean: async () => mockVersions }),
      });

      try {
        const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/versions`, {
          headers: { Authorization: `Bearer ${creatorToken}` },
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data.data));
        assert.equal(data.data.length, 2);
        assert.equal(data.data[0].versionNumber, 1);
        assert.equal(data.data[1].versionNumber, 2);
        assert.ok(data.data[1].diff.includes('--- v1'));
      } finally {
        Draft.findOne = origDraftFindOne;
        DraftVersion.find = origVersionFind;
      }
    });
  });

  // =========================================================================
  // 5. Finding Action -> versionManager integration test
  // =========================================================================
  describe('PATCH /v1/findings/:id accepting fix triggers versionManager', () => {
    it('creates new DraftVersion when finding fix is accepted', async () => {
      const findingId = new mongoose.Types.ObjectId();
      const draftId = new mongoose.Types.ObjectId();
      const initialText = 'Our policy offers 14 days returns.';

      const mockDraft = {
        _id: draftId,
        orgId: testOrgId,
        currentVersion: 1,
        save: async function () { return this; },
      };

      const mockFinding = {
        _id: findingId,
        orgId: testOrgId,
        draftId,
        draftVersionId: new mongoose.Types.ObjectId(),
        status: 'open',
        span: { start: 18, end: 25 }, // "14 days"
        suggestedFix: '30 days',
        verdict: 'Contradicted',
        type: 'violation',
        save: async function () { return this; },
        toObject: function () { return { ...this }; },
      };

      const mockLatestVersion = {
        _id: new mongoose.Types.ObjectId(),
        draftId,
        orgId: testOrgId,
        versionNumber: 1,
        content: initialText,
        contentHash: sha256(initialText),
      };

      const origFindingFindOne = Finding.findOne;
      const origDraftFindOne = Draft.findOne;
      const origVersionFindOne = DraftVersion.findOne;
      let createdVersionDoc = null;
      const origVersionSave = DraftVersion.prototype.save;

      Finding.findOne = async () => mockFinding;
      Draft.findOne = async () => mockDraft;
      DraftVersion.findOne = () => ({
        sort: () => mockLatestVersion,
      });
      DraftVersion.prototype.save = async function () {
        createdVersionDoc = this;
        return this;
      };

      try {
        const res = await fetch(`${baseUrl}/v1/findings/${findingId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${managerToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status: 'accepted' }),
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.newStatus, 'accepted');
        assert.ok(data.version);
        assert.equal(data.version.versionNumber, 2);
        assert.equal(data.version.content, 'Our policy offers 30 days returns.');
        assert.ok(data.version.diff.includes('--- v1'));
        assert.ok(data.version.diff.includes('+++ v2'));
      } finally {
        Finding.findOne = origFindingFindOne;
        Draft.findOne = origDraftFindOne;
        DraftVersion.findOne = origVersionFindOne;
        DraftVersion.prototype.save = origVersionSave;
      }
    });
  });
});
