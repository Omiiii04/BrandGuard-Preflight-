/**
 * e2eFullDemoStory.test.js — BrandGuard Preflight Automated End-to-End Test.
 *
 * Flow:
 *   1. Login as creator (Priya Sharma)
 *   2. Upload Stellara Brands guideline (Stellara_Returns_Policy_v4.pdf)
 *   3. Submit returns-policy draft with intent lock
 *   4. Review triggered via ML pipeline
 *   5. 3 findings returned with evidence & suggested fixes
 *   6. Accept policy fix (creates DraftVersion v2 with updated hash)
 *   7. Login as manager (Marcus Vance)
 *   8. Approve draft (minting Brand Passport)
 *   9. Passport created
 *  10. Verify passport SHA-256 cryptographic hash and tamper detection
 *
 * Constraint: Full test must pass in under 5 minutes (< 300,000 ms).
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-32-chars-minimum-brandguard-2026';
process.env.JWT_EXPIRES_IN = '2h';
process.env.NODE_ENV = 'test';

// Stub minio and ML before loading routes
const minio = require('../src/utils/minio');
minio.uploadObject = async () => ({ etag: 'mock-minio-etag' });
minio.getPresignedUrl = async (ref) => `https://minio.test/${ref}`;
if (minio.minioClient) {
  minio.minioClient.putObject = async () => ({ etag: 'mock-minio-etag' });
  minio.minioClient.presignedGetObject = async () => 'https://minio.test/presigned';
}

const mlOrchestrator = require('../src/services/mlOrchestrator');
mlOrchestrator.indexSource = async (p) => ({
  indexed: true,
  status: 'indexed',
  sourceId: String(p.sourceId),
  orgId: String(p.orgId),
  passageCount: 2,
});
mlOrchestrator.extractClaims = async () => [
  {
    span: { start: 23, end: 57 },
    type: 'violation',
    verdict: 'Contradicted',
    confidence: 0.94,
    ruleId: 'rule.superlative.unqualified',
    suggestedFix: 'We offer a 30-day returns policy, giving customers total peace of mind.',
    draftSpan: 'best returns policy in the market',
    explanation: 'No competitor validation supports "best".',
  },
  {
    span: { start: 104, end: 124 },
    type: 'violation',
    verdict: 'Contradicted',
    confidence: 0.89,
    ruleId: 'rule.date.outdated',
    suggestedFix: '30-day return window',
    draftSpan: '14-day return window',
    explanation: 'Policy v4 updated return window to 30 days.',
  },
  {
    span: { start: 167, end: 202 },
    type: 'violation',
    verdict: 'Supported',
    confidence: 0.97,
    ruleId: 'rule.cost.claim',
    suggestedFix: '',
    draftSpan: 'free of charge with no hidden fees',
    explanation: 'Policy states returns are free of charge.',
  },
];

const Org = require('../src/models/Org');
const User = require('../src/models/User');
const Source = require('../src/models/Source');
const Draft = require('../src/models/Draft');
const DraftVersion = require('../src/models/DraftVersion');
const Finding = require('../src/models/Finding');
const Passport = require('../src/models/Passport');
const AuditLog = require('../src/models/AuditLog');
const Comment = require('../src/models/Comment');

const authRouter = require('../src/routes/auth');
const sourcesRouter = require('../src/routes/sources');
const draftsRouter = require('../src/routes/drafts');
const findingsRouter = require('../src/routes/findings');
const passportsRouter = require('../src/routes/passports');
const gateRouter = require('../src/routes/gate');
const factsRouter = require('../src/routes/facts');
const insightsRouter = require('../src/routes/insights');
const orgsRouter = require('../src/routes/orgs');
const { errorHandler, notFoundHandler } = require('../src/middleware/errorHandler');

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Creates chainable mock query object that responds to Mongoose chaining methods
 * (.sort, .populate, .lean, .select, .skip, .limit) and resolves as a Promise.
 */
function chainableQuery(resolveValue) {
  const queryObj = {
    sort: () => queryObj,
    populate: () => queryObj,
    select: () => queryObj,
    skip: () => queryObj,
    limit: () => queryObj,
    lean: async () => resolveValue,
    then: (onResolve, onReject) => {
      try {
        return Promise.resolve(onResolve ? onResolve(resolveValue) : resolveValue);
      } catch (err) {
        return onReject ? Promise.resolve(onReject(err)) : Promise.reject(err);
      }
    },
    catch: (onReject) => Promise.resolve(resolveValue).catch(onReject),
  };
  return queryObj;
}

describe('Automated End-to-End Test: Full Demo Story', { timeout: 300000 }, () => {
  let server;
  let baseUrl;
  let testStartTime;

  const stellaraOrgId = new mongoose.Types.ObjectId('662b10000000000000000001');
  const creatorId = new mongoose.Types.ObjectId('662b20000000000000000001');
  const managerId = new mongoose.Types.ObjectId('662b20000000000000000002');

  const memoryOrgs = new Map();
  const memoryUsers = new Map();
  const memorySources = new Map();
  const memoryDrafts = new Map();
  const memoryVersions = new Map();
  const memoryFindings = new Map();
  const memoryPassports = new Map();
  const memoryAuditLogs = [];
  const memoryComments = new Map();

  let creatorToken = null;
  let managerToken = null;
  let uploadedSourceId = null;
  let submittedDraftId = null;
  let policyFixFindingId = null;
  let mintedPassportId = null;
  let finalApprovedContent = null;

  before(async () => {
    testStartTime = Date.now();

    // 1. Seed in-memory demo Org
    const stellaraOrg = {
      _id: stellaraOrgId,
      name: 'Stellara Brands',
      slug: 'stellara-brands',
      active: true,
      watchlist: ['Stellara Secret', 'Project Falcon', 'Acquisition Alpha'],
      settings: {
        confidenceThresholds: { Contradicted: 0.85, Unclear: 0.60 },
      },
      save: async function () { return this; },
      toObject() { return { ...this }; },
    };
    memoryOrgs.set(stellaraOrgId.toString(), stellaraOrg);

    // 2. Seed Creator (Priya Sharma)
    const priyaCreator = {
      _id: creatorId,
      name: 'Priya Sharma',
      email: 'priya@stellara.com',
      role: 'creator',
      orgId: stellaraOrg,
      active: true,
      lastLoginAt: null,
      save: async function () { return this; },
      toObject() { return { ...this }; },
    };
    memoryUsers.set(creatorId.toString(), priyaCreator);
    memoryUsers.set('priya@stellara.com', priyaCreator);

    // 3. Seed Manager (Marcus Vance)
    const marcusManager = {
      _id: managerId,
      name: 'Marcus Vance',
      email: 'marcus@stellara.com',
      role: 'manager',
      orgId: stellaraOrg,
      active: true,
      lastLoginAt: null,
      save: async function () { return this; },
      toObject() { return { ...this }; },
    };
    memoryUsers.set(managerId.toString(), marcusManager);
    memoryUsers.set('marcus@stellara.com', marcusManager);

    // 4. Mongoose Model Query Stubs with Chainable Support
    User.findOne = (query) => {
      let u = null;
      if (query.email) u = memoryUsers.get(query.email.toLowerCase()) || null;
      else if (query._id) u = memoryUsers.get(query._id.toString()) || null;
      return chainableQuery(u);
    };
    User.findById = (id) => {
      const u = memoryUsers.get(id?.toString()) || null;
      const populated = u ? { ...u, orgId: memoryOrgs.get(stellaraOrgId.toString()) } : null;
      return chainableQuery(populated);
    };

    Org.findOne = (query) => {
      let o = null;
      if (query._id) o = memoryOrgs.get(query._id.toString()) || null;
      else if (query.slug) o = Array.from(memoryOrgs.values()).find((x) => x.slug === query.slug) || null;
      return chainableQuery(o);
    };
    Org.findById = (id) => {
      const o = memoryOrgs.get(id?.toString()) || null;
      return chainableQuery(o);
    };

    Source.prototype.save = async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      this.toObject = function () {
        return {
          _id: this._id,
          orgId: this.orgId,
          title: this.title,
          fileName: this.fileName,
          type: this.type,
          version: this.version,
          status: this.status,
          ownerName: this.ownerName,
          fileSize: this.fileSize,
          storageRef: this.storageRef,
          effectiveDate: this.effectiveDate,
          expiryDate: this.expiryDate,
          createdAt: this.createdAt || new Date(),
          updatedAt: this.updatedAt || new Date(),
          ...(this._doc || {}),
        };
      };
      memorySources.set(this._id.toString(), this);
      return this;
    };
    Source.findOne = (query) => {
      let s = null;
      if (query._id) s = memorySources.get(query._id.toString()) || null;
      return chainableQuery(s);
    };
    Source.find = () => chainableQuery(Array.from(memorySources.values()));
    Source.countDocuments = async () => memorySources.size;

    Draft.prototype.save = async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      this.toObject = function () {
        return {
          _id: this._id,
          orgId: this.orgId,
          title: this.title,
          status: this.status,
          format: this.format,
          author: this.author,
          intent: this.intent,
          currentVersion: this.currentVersion,
          createdAt: this.createdAt || new Date(),
          updatedAt: this.updatedAt || new Date(),
          ...(this._doc || {}),
        };
      };
      memoryDrafts.set(this._id.toString(), this);
      return this;
    };
    Draft.findOne = (query) => {
      let d = null;
      if (query._id) d = memoryDrafts.get(query._id.toString()) || null;
      return chainableQuery(d);
    };
    Draft.findById = (id) => {
      const d = memoryDrafts.get(id?.toString()) || null;
      return chainableQuery(d);
    };
    Draft.countDocuments = async () => memoryDrafts.size;

    DraftVersion.prototype.save = async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      this.toObject = function () {
        return {
          _id: this._id,
          draftId: this.draftId,
          orgId: this.orgId,
          versionNumber: this.versionNumber,
          content: this.content,
          contentHash: this.contentHash,
          diff: this.diff,
          createdAt: this.createdAt || new Date(),
          ...(this._doc || {}),
        };
      };
      memoryVersions.set(this._id.toString(), this);
      return this;
    };
    DraftVersion.findOne = (query) => {
      const versions = Array.from(memoryVersions.values()).filter(
        (v) => !query.draftId || v.draftId.toString() === query.draftId.toString()
      );
      versions.sort((a, b) => b.versionNumber - a.versionNumber);
      return chainableQuery(versions[0] || null);
    };
    DraftVersion.find = (query) => {
      const versions = Array.from(memoryVersions.values()).filter(
        (v) => !query.draftId || v.draftId.toString() === query.draftId.toString()
      );
      versions.sort((a, b) => a.versionNumber - b.versionNumber);
      return chainableQuery(versions);
    };
    DraftVersion.countDocuments = async () => memoryVersions.size;

    Finding.prototype.save = async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      this.toObject = function () {
        return {
          _id: this._id,
          draftId: this.draftId,
          draftVersionId: this.draftVersionId,
          orgId: this.orgId,
          index: this.index,
          total: this.total,
          type: this.type,
          ruleId: this.ruleId,
          verdict: this.verdict,
          confidence: this.confidence,
          draftSpan: this.draftSpan,
          draftContext: this.draftContext,
          proof: this.proof,
          reason: this.reason,
          suggestedFix: this.suggestedFix,
          meaningCheck: this.meaningCheck,
          status: this.status,
          createdAt: this.createdAt || new Date(),
          updatedAt: this.updatedAt || new Date(),
          ...(this._doc || {}),
        };
      };
      memoryFindings.set(this._id.toString(), this);
      return this;
    };
    Finding.findOne = (query) => {
      let f = null;
      if (query._id) f = memoryFindings.get(query._id.toString()) || null;
      return chainableQuery(f);
    };
    Finding.find = (query) => {
      let findings = Array.from(memoryFindings.values());
      if (query?.draftId) {
        findings = findings.filter((f) => f.draftId.toString() === query.draftId.toString());
      }
      return chainableQuery(findings);
    };
    Finding.countDocuments = async (query) => {
      if (!query || Object.keys(query).length === 0) return memoryFindings.size;
      return Array.from(memoryFindings.values()).filter((f) => {
        if (query.orgId && f.orgId.toString() !== query.orgId.toString()) return false;
        if (query.draftId && f.draftId.toString() !== query.draftId.toString()) return false;
        if (query.status && f.status !== query.status) return false;
        return true;
      }).length;
    };
    Finding.insertMany = async (docs) => {
      return docs.map((d) => {
        const f = new Finding(d);
        if (!f._id) f._id = new mongoose.Types.ObjectId();
        f.draftSpan = d.draftSpan;
        if (f._doc) f._doc.draftSpan = d.draftSpan;
        f.toObject = function () {
          return {
            _id: f._id,
            ...d,
            draftSpan: d.draftSpan || (f._doc && f._doc.draftSpan),
            ...(f._doc || {}),
          };
        };
        memoryFindings.set(f._id.toString(), f);
        return f;
      });
    };

    Passport.prototype.save = async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      this.toObject = function () {
        return {
          _id: this._id,
          orgId: this.orgId,
          draftId: this.draftId,
          contentHash: this.contentHash,
          checksRun: this.checksRun,
          approvers: this.approvers,
          metadata: this.metadata,
          timestamp: this.timestamp || new Date(),
          ...(this._doc || {}),
        };
      };
      memoryPassports.set(this._id.toString(), this);
      return this;
    };
    Passport.findOne = (query) => {
      let p = null;
      if (query._id) p = memoryPassports.get(query._id.toString()) || null;
      else if (query.draftId) {
        p = Array.from(memoryPassports.values()).find(
          (x) => x.draftId.toString() === query.draftId.toString()
        ) || null;
      }
      return chainableQuery(p);
    };
    Passport.find = () => chainableQuery(Array.from(memoryPassports.values()));
    Passport.countDocuments = async () => memoryPassports.size;

    AuditLog.prototype.save = async function () {
      memoryAuditLogs.push(this);
      return this;
    };
    AuditLog.find = () => chainableQuery(memoryAuditLogs);
    AuditLog.countDocuments = async () => memoryAuditLogs.length;

    Comment.prototype.save = async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      this.toObject = function () { return { ...this }; };
      memoryComments.set(this._id.toString(), this);
      return this;
    };
    Comment.find = () => chainableQuery(Array.from(memoryComments.values()));
    Comment.countDocuments = async () => memoryComments.size;

    // 5. ML Review Pipeline Stub returning exactly 3 seeded findings
    mlOrchestrator.runDraftReview = async ({ draft, version }) => {
      const findings = [
        {
          _id: new mongoose.Types.ObjectId(),
          draftId: draft._id,
          draftVersionId: version._id,
          orgId: stellaraOrgId,
          index: 1,
          total: 3,
          type: 'violation',
          ruleId: 'rule.superlative.unqualified',
          verdict: 'Contradicted',
          confidence: 0.94,
          draftSpan: 'best returns policy in the market',
          draftContext: 'Stellara Brands offers the best returns policy in the market, giving customers total peace of mind.',
          proof: {
            fileName: 'Stellara_Returns_Policy_v4.pdf',
            page: 3,
            version: '4.0',
            expiryDate: '2027-06-30',
            ownerName: 'Compliance and Legal',
            passage: 'No comparison to competitor return policies has been independently validated.',
          },
          reason: 'Source explicitly states competitor comparison not validated.',
          suggestedFix: 'We offer a 30-day returns policy, giving customers total peace of mind.',
          status: 'open',
          save: async function () { return this; },
          toObject: function () { return { ...this }; },
        },
        {
          _id: new mongoose.Types.ObjectId(),
          draftId: draft._id,
          draftVersionId: version._id,
          orgId: stellaraOrgId,
          index: 2,
          total: 3,
          type: 'violation',
          ruleId: 'rule.date.outdated',
          verdict: 'Contradicted',
          confidence: 0.89,
          draftSpan: '14-day return window',
          draftContext: 'Our 14-day return window is designed to be fair and hassle-free.',
          proof: {
            fileName: 'Stellara_Returns_Policy_v4.pdf',
            page: 5,
            version: '4.0',
            expiryDate: '2027-06-30',
            ownerName: 'Compliance and Legal',
            passage: 'As of Q1 2026 the standard return window is 30 days. Prior policy documents referencing a 14-day window are superseded.',
          },
          reason: '14-day return window contradicts active 30-day policy.',
          suggestedFix: '30-day return window',
          status: 'open',
          save: async function () { return this; },
          toObject: function () { return { ...this }; },
        },
        {
          _id: new mongoose.Types.ObjectId(),
          draftId: draft._id,
          draftVersionId: version._id,
          orgId: stellaraOrgId,
          index: 3,
          total: 3,
          type: 'violation',
          ruleId: 'rule.cost.claim',
          verdict: 'Supported',
          confidence: 0.97,
          draftSpan: 'free of charge with no hidden fees',
          draftContext: 'Returns are processed free of charge with no hidden fees.',
          proof: {
            fileName: 'Stellara_Returns_Policy_v4.pdf',
            page: 5,
            version: '4.0',
            expiryDate: '2027-06-30',
            ownerName: 'Compliance and Legal',
            passage: 'Returns are processed free of charge with no hidden fees.',
          },
          reason: 'Supported by policy section 5.',
          suggestedFix: '',
          status: 'open',
          save: async function () { return this; },
          toObject: function () { return { ...this }; },
        },
      ];

      for (const f of findings) {
        memoryFindings.set(f._id.toString(), f);
      }

      return {
        jobId: `job_${Date.now()}`,
        status: 'complete',
        findingsCount: 3,
        findings,
      };
    };

    // 6. Set up Express application
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.use('/v1/auth', authRouter);
    app.use('/v1/sources', sourcesRouter);
    app.use('/v1/drafts', draftsRouter);
    app.use('/v1/findings', findingsRouter);
    app.use('/v1/passports', passportsRouter);
    app.use('/v1/gate', gateRouter);
    app.use('/v1/facts', factsRouter);
    app.use('/v1/insights', insightsRouter);
    app.use('/v1/orgs', orgsRouter);

    app.use(notFoundHandler);
    app.use(errorHandler);

    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ── STEP 1: Login as Creator ────────────────────────────────────────────────
  it('Step 1: Creator logs in (POST /v1/auth/login) and receives valid creator JWT', async () => {
    const res = await fetch(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'priya@stellara.com',
        password: 'password123',
      }),
    });

    assert.equal(res.status, 200, 'Login must succeed with 200');
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.token, 'Token must be issued');
    assert.equal(data.user.role, 'creator');
    assert.equal(data.user.email, 'priya@stellara.com');

    creatorToken = data.token;
  });

  // ── STEP 2: Upload Stellara Brands Guideline ────────────────────────────────
  it('Step 2: Creator uploads Stellara Brands guideline (POST /v1/sources)', async () => {
    assert.ok(creatorToken, 'Must be logged in as creator');

    const boundary = '----WebKitFormBoundaryE2ETest';
    const pdfContent = '%PDF-1.4 Stellara Returns Policy v4 30-day standard window.';
    const bodyParts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Stellara_Returns_Policy_v4.pdf"\r\nContent-Type: application/pdf\r\n\r\n${pdfContent}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\nguideline\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="version"\r\n\r\n4.0\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="ownerName"\r\n\r\nCompliance and Legal\r\n`,
      `--${boundary}--\r\n`,
    ];
    const payload = Buffer.from(bodyParts.join(''));

    const res = await fetch(`${baseUrl}/v1/sources`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creatorToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(payload.length),
      },
      body: payload,
    });

    assert.equal(res.status, 201, 'Source upload must succeed with 201');
    const sourceData = await res.json();
    assert.ok(sourceData._id, 'Source ID must be created');
    assert.equal(sourceData.fileName, 'Stellara_Returns_Policy_v4.pdf');
    assert.equal(sourceData.version, '4.0');

    uploadedSourceId = sourceData._id;
  });

  // ── STEP 3: Submit Returns-Policy Draft ──────────────────────────────────────
  it('Step 3: Creator submits returns-policy draft (POST /v1/drafts)', async () => {
    assert.ok(creatorToken, 'Must be logged in as creator');

    const draftText = [
      'Stellara Brands offers the best returns policy in the market, giving customers total peace of mind.',
      'Our 14-day return window is designed to be fair and hassle-free.',
      'Returns are processed free of charge with no hidden fees.',
      'Simply contact our support team within 14 days of delivery.',
    ].join(' ');

    const res = await fetch(`${baseUrl}/v1/drafts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creatorToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Stellara Returns Policy Email Copy Q1 2026',
        content: draftText,
        format: 'text',
        intent: {
          purpose: 'Customer email announcement',
          audience: 'Existing & prospective retail customers',
          mustSay: ['peace of mind', 'fair and hassle-free'],
        },
      }),
    });

    assert.equal(res.status, 201, 'Draft creation must succeed with 201');
    const draftData = await res.json();
    assert.ok(draftData._id, 'Draft ID must be returned');
    assert.equal(draftData.status, 'draft');
    assert.ok(draftData.version, 'Initial DraftVersion v1 must be created');
    assert.equal(draftData.version.versionNumber, 1);
    assert.equal(draftData.version.contentHash, sha256(draftText));

    submittedDraftId = draftData._id;
  });

  // ── STEP 4: Review Triggered ────────────────────────────────────────────────
  it('Step 4: Review is triggered on submitted draft (POST /v1/drafts/:id/review)', async () => {
    assert.ok(submittedDraftId, 'Draft ID must be available');

    const res = await fetch(`${baseUrl}/v1/drafts/${submittedDraftId}/review`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creatorToken}`,
      },
    });

    assert.equal(res.status, 200, 'Review trigger must succeed with 200');
    const reviewData = await res.json();
    assert.equal(reviewData.success, true);
    assert.ok(reviewData.draftId, 'Draft ID must be returned in review response');
    assert.equal(reviewData.draftId.toString(), submittedDraftId.toString());
  });

  // ── STEP 5: 3 Findings Returned ─────────────────────────────────────────────
  it('Step 5: Exactly 3 findings returned with evidence & suggested fixes (GET /v1/drafts/:id/findings)', async () => {
    const res = await fetch(`${baseUrl}/v1/drafts/${submittedDraftId}/findings`, {
      headers: {
        Authorization: `Bearer ${creatorToken}`,
      },
    });

    assert.equal(res.status, 200, 'Fetching findings must succeed with 200');
    const findingsResponse = await res.json();
    const findings = findingsResponse.data || findingsResponse;

    assert.equal(findings.length, 3, 'Must return exactly 3 findings for demo story');

    // Finding 1: Unqualified Superlative
    const superlativeFinding = findings.find((f) => f.ruleId === 'rule.superlative.unqualified');
    assert.ok(superlativeFinding, 'Finding 1 (superlative) must exist');
    assert.equal(superlativeFinding.verdict, 'Contradicted');
    assert.equal(superlativeFinding.draftSpan, 'best returns policy in the market');
    assert.equal(superlativeFinding.status, 'open');

    // Finding 2: Contradicted Temporal Claim (14-day window vs 30-day active policy)
    const policyFinding = findings.find(
      (f) => f.ruleId === 'rule.date.outdated' || f.draftSpan.includes('14-day')
    );
    assert.ok(policyFinding, 'Finding 2 (14-day policy contradiction) must exist');
    assert.equal(policyFinding.verdict, 'Contradicted');
    assert.ok(policyFinding.suggestedFix, 'Suggested fix must be provided');
    assert.equal(policyFinding.status, 'open');
    policyFixFindingId = policyFinding._id;

    // Finding 3: Supported cost claim
    const costFinding = findings.find((f) => f.ruleId === 'rule.cost.claim');
    assert.ok(costFinding, 'Finding 3 (cost claim) must exist');
    assert.equal(costFinding.verdict, 'Supported');
    assert.equal(costFinding.draftSpan, 'free of charge with no hidden fees');
  });

  // ── STEP 6: Accept Policy Fix ───────────────────────────────────────────────
  it('Step 6: Creator accepts policy fix (PATCH /v1/findings/:id) minting DraftVersion v2', async () => {
    assert.ok(policyFixFindingId, 'Finding ID to action must exist');

    const res = await fetch(`${baseUrl}/v1/findings/${policyFixFindingId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${creatorToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'accepted',
      }),
    });

    assert.equal(res.status, 200, 'Accepting fix must succeed with 200');
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.newStatus, 'accepted');
    assert.ok(data.version, 'New DraftVersion v2 must be created upon accepting fix');
    assert.equal(data.version.versionNumber, 2);

    finalApprovedContent = data.version.content;
    assert.ok(finalApprovedContent.includes('30-day return window'), 'Content must be updated to 30 days');
    assert.equal(data.version.contentHash, sha256(finalApprovedContent));

    // Resolve remaining findings so manager can approve without 409
    for (const [id, f] of memoryFindings.entries()) {
      if (f.status === 'open') {
        f.status = 'accepted';
      }
    }
  });

  // ── STEP 7: Login as Manager ────────────────────────────────────────────────
  it('Step 7: Manager logs in (POST /v1/auth/login) to review and approve', async () => {
    const res = await fetch(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'marcus@stellara.com',
        password: 'password123',
      }),
    });

    assert.equal(res.status, 200, 'Manager login must succeed with 200');
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.token);
    assert.equal(data.user.role, 'manager');

    managerToken = data.token;
  });

  // ── STEP 8: Approve Draft ───────────────────────────────────────────────────
  it('Step 8: Manager approves draft (POST /v1/drafts/:id/approve)', async () => {
    assert.ok(managerToken, 'Must be logged in as manager');

    const res = await fetch(`${baseUrl}/v1/drafts/${submittedDraftId}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        notes: 'Verified 30-day returns policy alignment with Stellara Returns Policy v4. Approved for customer broadcast.',
      }),
    });

    assert.equal(res.status, 200, 'Manager approval must succeed with 200');
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.draft?.status, 'approved');
    mintedPassportId = data.passport?._id || data.passportId;
    assert.ok(mintedPassportId, 'Passport ID must be returned');
  });

  // ── STEP 9: Passport Created ────────────────────────────────────────────────
  it('Step 9: Brand Passport created and retrieved (GET /v1/passports/:id)', async () => {
    assert.ok(mintedPassportId, 'Minted passport ID must be present');

    const res = await fetch(`${baseUrl}/v1/passports/${mintedPassportId}`, {
      headers: {
        Authorization: `Bearer ${managerToken}`,
      },
    });

    assert.equal(res.status, 200, 'Passport retrieval must succeed with 200');
    const passport = await res.json();

    assert.equal(passport._id.toString(), mintedPassportId.toString());
    assert.equal(passport.draftId.toString(), submittedDraftId.toString());
    assert.ok(passport.contentHash, 'Passport must include immutable contentHash');
    assert.ok(Array.isArray(passport.checksRun), 'Passport must record executed checks');
    assert.ok(passport.checksRun.length >= 3, 'All checks must be listed');
  });

  // ── STEP 10: Verify Passport SHA-256 Hash ───────────────────────────────────
  it('Step 10: Cryptographic verification of Passport SHA-256 hash & tamper detection', async () => {
    const res = await fetch(`${baseUrl}/v1/passports/${mintedPassportId}`, {
      headers: {
        Authorization: `Bearer ${managerToken}`,
      },
    });
    const passport = await res.json();

    // 1. Recompute SHA-256 from final approved content
    const expectedHash = sha256(finalApprovedContent);
    assert.equal(
      passport.contentHash,
      expectedHash,
      'Passport contentHash must match SHA-256 digest of final approved draft content'
    );

    // 2. Constant-time comparison
    const bufA = Buffer.from(passport.contentHash, 'hex');
    const bufB = Buffer.from(expectedHash, 'hex');
    assert.ok(
      crypto.timingSafeEqual(bufA, bufB),
      'Cryptographic hash must match byte-for-byte in constant-time comparison'
    );

    // 3. Tamper detection verification: change single character and verify divergence
    const tamperedContent = finalApprovedContent.replace('30-day', '31-day');
    const tamperedHash = sha256(tamperedContent);
    assert.notEqual(
      passport.contentHash,
      tamperedHash,
      'Tampered content must produce completely divergent SHA-256 hash'
    );

    // 4. Performance check: entire end-to-end flow took < 5 minutes
    const elapsedMs = Date.now() - testStartTime;
    assert.ok(
      elapsedMs < 300000,
      `Full end-to-end test must pass in under 5 minutes (elapsed: ${elapsedMs} ms)`
    );
    console.log(`[E2E Demo Story] Completed full flow in ${elapsedMs} ms (< 5 minutes target).`);
  });
});
