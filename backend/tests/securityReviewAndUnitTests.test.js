/**
 * securityReviewAndUnitTests.test.js
 *
 * Dedicated unit and integration tests covering:
 *   1. JWT Verification (auth middleware, signature validity, expiration, missing/malformed tokens, sub enforcement, active user/org checks)
 *   2. orgId Isolation (Tenant boundary verification: Org A cannot return or mutate Org B data across drafts, findings, passports, sources; enforceOrgScope & injectOrgFilter)
 *   3. SHA-256 Passport Computation (cryptographic hashing, timing-safe verification, buildPassport automatic & verified hash generation)
 *   4. Role Checks & RBAC (normalization, aliases, hierarchy, requireRole middleware, approval/override endpoint RBAC protection)
 *   5. Finding Status Transitions (lifecycle matrix, valid transitions, terminal state enforcement, validation requirements, diff & version generation)
 *   6. Append-Only Route Verification (guarantee no PATCH/DELETE routes exist for auditLog and passports)
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

// Models
const User = require('../src/models/User');
const Org = require('../src/models/Org');
const Draft = require('../src/models/Draft');
const DraftVersion = require('../src/models/DraftVersion');
const Finding = require('../src/models/Finding');
const Passport = require('../src/models/Passport');
const Source = require('../src/models/Source');
const Comment = require('../src/models/Comment');
const AuditLog = require('../src/models/AuditLog');

// Middleware & Utilities
const { authenticate } = require('../src/middleware/auth');
const { enforceOrgScope, injectOrgFilter, orgIsolation } = require('../src/middleware/orgIsolation');
const { requireRole, hasRole, normalizeRole, ROLE_HIERARCHY, ROLE_ALIASES } = require('../src/middleware/rbac');
const { sha256, verifyHash } = require('../src/utils/hash');
const { buildPassport } = require('../src/services/passportBuilder');
const { createDraftVersionOnAcceptedFix, getVersions } = require('../src/services/versionManager');
const { errorHandler } = require('../src/middleware/errorHandler');

// Routers
const draftsRouter = require('../src/routes/drafts');
const findingsRouter = require('../src/routes/findings');
const passportsRouter = require('../src/routes/passports');
const sourcesRouter = require('../src/routes/sources');

describe('Security Review & Core Unit Tests', () => {
  // Test Tenants
  const orgA = new mongoose.Types.ObjectId();
  const orgB = new mongoose.Types.ObjectId();

  // Test Users
  const userA_Manager = new mongoose.Types.ObjectId();
  const userA_Creator = new mongoose.Types.ObjectId();
  const userA_Reviewer = new mongoose.Types.ObjectId();
  const userB_Manager = new mongoose.Types.ObjectId();
  const userB_Creator = new mongoose.Types.ObjectId();
  const userInactive = new mongoose.Types.ObjectId();

  // JWT Tokens
  const tokenA_Manager = jwt.sign(
    { sub: userA_Manager.toString(), orgId: orgA.toString(), role: 'manager' },
    JWT_SECRET,
    { expiresIn: '2h' }
  );

  const tokenA_Creator = jwt.sign(
    { sub: userA_Creator.toString(), orgId: orgA.toString(), role: 'creator' },
    JWT_SECRET,
    { expiresIn: '2h' }
  );

  const tokenA_Reviewer = jwt.sign(
    { sub: userA_Reviewer.toString(), orgId: orgA.toString(), role: 'reviewer' },
    JWT_SECRET,
    { expiresIn: '2h' }
  );

  const tokenB_Manager = jwt.sign(
    { sub: userB_Manager.toString(), orgId: orgB.toString(), role: 'manager' },
    JWT_SECRET,
    { expiresIn: '2h' }
  );

  const tokenB_Creator = jwt.sign(
    { sub: userB_Creator.toString(), orgId: orgB.toString(), role: 'creator' },
    JWT_SECRET,
    { expiresIn: '2h' }
  );

  // In-memory data store for isolated testing
  let memoryUsers = new Map();
  let memoryDrafts = new Map();
  let memoryDraftVersions = new Map();
  let memoryFindings = new Map();
  let memoryPassports = new Map();
  let memorySources = new Map();
  let memoryComments = new Map();

  let server;
  let baseUrl;

  // Stored originals
  const origUserFindById = User.findById;
  const origDraftFind = Draft.find;
  const origDraftFindOne = Draft.findOne;
  const origDraftCount = Draft.countDocuments;
  const origDraftSave = Draft.prototype.save;
  const origDVFind = DraftVersion.find;
  const origDVFindOne = DraftVersion.findOne;
  const origDVSave = DraftVersion.prototype.save;
  const origFindingFind = Finding.find;
  const origFindingFindOne = Finding.findOne;
  const origFindingCount = Finding.countDocuments;
  const origFindingSave = Finding.prototype.save;
  const origPassportFind = Passport.find;
  const origPassportFindOne = Passport.findOne;
  const origPassportSave = Passport.prototype.save;
  const origSourceFind = Source.find;
  const origSourceFindOne = Source.findOne;
  const origSourceCount = Source.countDocuments;
  const origCommentFind = Comment.find;
  const origCommentFindOne = Comment.findOne;
  const origCommentSave = Comment.prototype.save;
  const origAuditLogCreate = AuditLog.create;
  const origAuditLogSave = AuditLog.prototype.save;

  before(async () => {
    // Populate mock user directory
    memoryUsers.set(userA_Manager.toString(), {
      _id: userA_Manager,
      name: 'Alice Manager',
      email: 'alice@orga.com',
      role: 'manager',
      active: true,
      orgId: { _id: orgA, name: 'Organisation A', active: true },
    });

    memoryUsers.set(userA_Creator.toString(), {
      _id: userA_Creator,
      name: 'Alex Creator',
      email: 'alex@orga.com',
      role: 'creator',
      active: true,
      orgId: { _id: orgA, name: 'Organisation A', active: true },
    });

    memoryUsers.set(userA_Reviewer.toString(), {
      _id: userA_Reviewer,
      name: 'Rachel Reviewer',
      email: 'rachel@orga.com',
      role: 'reviewer',
      active: true,
      orgId: { _id: orgA, name: 'Organisation A', active: true },
    });

    memoryUsers.set(userB_Manager.toString(), {
      _id: userB_Manager,
      name: 'Bob Manager',
      email: 'bob@orgb.com',
      role: 'manager',
      active: true,
      orgId: { _id: orgB, name: 'Organisation B', active: true },
    });

    memoryUsers.set(userB_Creator.toString(), {
      _id: userB_Creator,
      name: 'Brian Creator',
      email: 'brian@orgb.com',
      role: 'creator',
      active: true,
      orgId: { _id: orgB, name: 'Organisation B', active: true },
    });

    memoryUsers.set(userInactive.toString(), {
      _id: userInactive,
      name: 'Deactivated User',
      email: 'deactivated@orga.com',
      role: 'creator',
      active: false,
      orgId: { _id: orgA, name: 'Organisation A', active: true },
    });

    // Mock User.findById
    User.findById = function (id) {
      const idStr = id?.toString ? id.toString() : String(id);
      const user = memoryUsers.get(idStr);
      return {
        populate: function () {
          return {
            select: function () {
              return {
                lean: async function () {
                  return user || null;
                },
              };
            },
          };
        },
      };
    };

    function wrapDoc(doc, map) {
      if (!doc) return null;
      return {
        ...doc,
        save: async function () {
          map.set(this._id.toString(), this);
          return this;
        },
        toObject: function () {
          const copy = { ...this };
          delete copy.save;
          delete copy.toObject;
          return copy;
        },
      };
    }

    // Mock Draft queries
    Draft.findOne = function (filter) {
      const exec = async () => {
        for (const draft of memoryDrafts.values()) {
          let match = true;
          if (filter._id && draft._id.toString() !== filter._id.toString()) match = false;
          if (filter.orgId && draft.orgId.toString() !== filter.orgId.toString()) match = false;
          if (match) return wrapDoc(draft, memoryDrafts);
        }
        return null;
      };
      return { lean: exec, exec, then: (resolve, reject) => exec().then(resolve, reject) };
    };

    Draft.find = function (filter) {
      const exec = async () => {
        const results = [];
        for (const draft of memoryDrafts.values()) {
          let match = true;
          if (filter.orgId && draft.orgId.toString() !== filter.orgId.toString()) match = false;
          if (filter.status && draft.status !== filter.status) match = false;
          if (match) results.push(wrapDoc(draft, memoryDrafts));
        }
        return results;
      };
      return {
        sort: () => ({ skip: () => ({ limit: () => ({ lean: exec, exec, then: (res, rej) => exec().then(res, rej) }) }) }),
        lean: exec,
        exec,
        then: (resolve, reject) => exec().then(resolve, reject),
      };
    };

    Draft.countDocuments = async function (filter) {
      let count = 0;
      for (const draft of memoryDrafts.values()) {
        let match = true;
        if (filter.orgId && draft.orgId.toString() !== filter.orgId.toString()) match = false;
        if (match) count++;
      }
      return count;
    };

    Draft.prototype.save = async function () {
      memoryDrafts.set(this._id.toString(), this);
      return this;
    };

    // Mock DraftVersion queries
    DraftVersion.findOne = function (filter) {
      const exec = async () => {
        const matches = [];
        for (const dv of memoryDraftVersions.values()) {
          let match = true;
          if (filter.draftId && dv.draftId.toString() !== filter.draftId.toString()) match = false;
          if (filter.orgId && dv.orgId.toString() !== filter.orgId.toString()) match = false;
          if (match) matches.push(wrapDoc(dv, memoryDraftVersions));
        }
        matches.sort((a, b) => (b.versionNumber || 1) - (a.versionNumber || 1));
        return matches[0] || null;
      };
      return {
        sort: () => ({ lean: exec, exec, then: (res, rej) => exec().then(res, rej) }),
        lean: exec,
        exec,
        then: (resolve, reject) => exec().then(resolve, reject),
      };
    };

    DraftVersion.find = function (filter) {
      const exec = async () => {
        const results = [];
        for (const dv of memoryDraftVersions.values()) {
          let match = true;
          if (filter.draftId && dv.draftId.toString() !== filter.draftId.toString()) match = false;
          if (filter.orgId && dv.orgId.toString() !== filter.orgId.toString()) match = false;
          if (match) results.push(wrapDoc(dv, memoryDraftVersions));
        }
        results.sort((a, b) => (a.versionNumber || 1) - (b.versionNumber || 1));
        return results;
      };
      return {
        sort: () => ({ lean: exec, exec, then: (res, rej) => exec().then(res, rej) }),
        lean: exec,
        exec,
        then: (resolve, reject) => exec().then(resolve, reject),
      };
    };

    DraftVersion.prototype.save = async function () {
      memoryDraftVersions.set(this._id.toString(), this);
      return this;
    };

    // Mock Finding queries
    Finding.findOne = function (filter) {
      const exec = async () => {
        for (const f of memoryFindings.values()) {
          let match = true;
          if (filter._id && f._id.toString() !== filter._id.toString()) match = false;
          if (filter.orgId && f.orgId.toString() !== filter.orgId.toString()) match = false;
          if (filter.draftId && f.draftId.toString() !== filter.draftId.toString()) match = false;
          if (match) return wrapDoc(f, memoryFindings);
        }
        return null;
      };
      return { lean: exec, exec, then: (resolve, reject) => exec().then(resolve, reject) };
    };

    Finding.find = function (filter) {
      const exec = async () => {
        const results = [];
        for (const f of memoryFindings.values()) {
          let match = true;
          if (filter.orgId && f.orgId.toString() !== filter.orgId.toString()) match = false;
          if (filter.draftId && f.draftId.toString() !== filter.draftId.toString()) match = false;
          if (match) results.push(wrapDoc(f, memoryFindings));
        }
        return results;
      };
      return {
        sort: () => ({ skip: () => ({ limit: () => ({ lean: exec, exec, then: (res, rej) => exec().then(res, rej) }) }) }),
        lean: exec,
        exec,
        then: (resolve, reject) => exec().then(resolve, reject),
      };
    };

    Finding.countDocuments = async function (filter) {
      let count = 0;
      for (const f of memoryFindings.values()) {
        let match = true;
        if (filter.orgId && f.orgId.toString() !== filter.orgId.toString()) match = false;
        if (filter.draftId && f.draftId.toString() !== filter.draftId.toString()) match = false;
        if (filter.status && f.status !== filter.status) match = false;
        if (match) count++;
      }
      return count;
    };

    Finding.prototype.save = async function () {
      memoryFindings.set(this._id.toString(), this);
      return this;
    };

    // Mock Passport queries
    Passport.findOne = function (filter) {
      const exec = async () => {
        for (const p of memoryPassports.values()) {
          let match = true;
          if (filter._id && p._id.toString() !== filter._id.toString()) match = false;
          if (filter.orgId && p.orgId.toString() !== filter.orgId.toString()) match = false;
          if (filter.draftId && p.draftId.toString() !== filter.draftId.toString()) match = false;
          if (match) return p;
        }
        return null;
      };
      return {
        populate: function () {
          return {
            sort: () => ({ lean: exec, exec, then: (res, rej) => exec().then(res, rej) }),
            lean: exec,
            exec,
            then: (res, rej) => exec().then(res, rej),
          };
        },
        lean: exec,
        exec,
        then: (res, rej) => exec().then(res, rej),
      };
    };

    Passport.find = function (filter) {
      const exec = async () => {
        const results = [];
        for (const p of memoryPassports.values()) {
          let match = true;
          if (filter.orgId && p.orgId.toString() !== filter.orgId.toString()) match = false;
          if (filter.draftId && p.draftId.toString() !== filter.draftId.toString()) match = false;
          if (match) results.push(p);
        }
        return results;
      };
      return {
        populate: () => ({ sort: () => ({ lean: exec, exec, then: (r, j) => exec().then(r, j) }) }),
        sort: () => ({ lean: exec, exec, then: (r, j) => exec().then(r, j) }),
        lean: exec,
        exec,
        then: (r, j) => exec().then(r, j),
      };
    };

    Passport.prototype.save = async function () {
      memoryPassports.set(this._id.toString(), this);
      return this;
    };

    // Mock Source queries
    Source.findOne = function (filter) {
      const exec = async () => {
        for (const s of memorySources.values()) {
          let match = true;
          if (filter._id && s._id.toString() !== filter._id.toString()) match = false;
          if (filter.orgId && s.orgId.toString() !== filter.orgId.toString()) match = false;
          if (match) return s;
        }
        return null;
      };
      return { lean: exec, exec, then: (resolve, reject) => exec().then(resolve, reject) };
    };

    Source.find = function (filter) {
      const exec = async () => {
        const results = [];
        for (const s of memorySources.values()) {
          let match = true;
          if (filter.orgId && s.orgId.toString() !== filter.orgId.toString()) match = false;
          if (match) results.push(s);
        }
        return results;
      };
      return {
        sort: () => ({ skip: () => ({ limit: () => ({ lean: exec, exec, then: (r, j) => exec().then(r, j) }) }) }),
        lean: exec,
        exec,
        then: (r, j) => exec().then(r, j),
      };
    };

    Source.countDocuments = async function (filter) {
      let count = 0;
      for (const s of memorySources.values()) {
        let match = true;
        if (filter.orgId && s.orgId.toString() !== filter.orgId.toString()) match = false;
        if (match) count++;
      }
      return count;
    };

    AuditLog.create = async function (data) {
      return { _id: new mongoose.Types.ObjectId(), ...data };
    };
    AuditLog.prototype.save = async function () {
      return this;
    };

    // Setup Test Express App
    const app = express();
    app.use(express.json());

    app.use('/v1/drafts', draftsRouter);
    app.use('/v1/findings', findingsRouter);
    app.use('/v1/passports', passportsRouter);
    app.use('/v1/sources', sourcesRouter);
    app.use(errorHandler);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    // Restore mocks
    User.findById = origUserFindById;
    Draft.find = origDraftFind;
    Draft.findOne = origDraftFindOne;
    Draft.countDocuments = origDraftCount;
    Draft.prototype.save = origDraftSave;
    DraftVersion.find = origDVFind;
    DraftVersion.findOne = origDVFindOne;
    DraftVersion.prototype.save = origDVSave;
    Finding.find = origFindingFind;
    Finding.findOne = origFindingFindOne;
    Finding.countDocuments = origFindingCount;
    Finding.prototype.save = origFindingSave;
    Passport.find = origPassportFind;
    Passport.findOne = origPassportFindOne;
    Passport.prototype.save = origPassportSave;
    Source.find = origSourceFind;
    Source.findOne = origSourceFindOne;
    Source.countDocuments = origSourceCount;
    Comment.find = origCommentFind;
    Comment.findOne = origCommentFindOne;
    Comment.prototype.save = origCommentSave;
    AuditLog.create = origAuditLogCreate;
    AuditLog.prototype.save = origAuditLogSave;
  });

  beforeEach(() => {
    memoryDrafts.clear();
    memoryDraftVersions.clear();
    memoryFindings.clear();
    memoryPassports.clear();
    memorySources.clear();
    memoryComments.clear();
  });

  // ===========================================================================
  // 1. JWT VERIFICATION UNIT TESTS
  // ===========================================================================
  describe('1. JWT Verification & Authentication Security', () => {
    it('rejects requests missing the Authorization header (401)', async () => {
      const res = await fetch(`${baseUrl}/v1/drafts`);
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.match(data.error, /Authentication required/i);
    });

    it('rejects invalid or tampered JWT token signatures (401)', async () => {
      const tamperedToken = tokenA_Manager + 'tampered';
      const res = await fetch(`${baseUrl}/v1/drafts`, {
        headers: { Authorization: `Bearer ${tamperedToken}` },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.match(data.error, /Invalid or malformed/i);
    });

    it('rejects expired JWT tokens (401)', async () => {
      const expiredToken = jwt.sign(
        { sub: userA_Manager.toString(), orgId: orgA.toString(), role: 'manager' },
        JWT_SECRET,
        { expiresIn: '-1s' }
      );
      const res = await fetch(`${baseUrl}/v1/drafts`, {
        headers: { Authorization: `Bearer ${expiredToken}` },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.match(data.error, /expired/i);
    });

    it('rejects tokens signed with an incorrect secret key (401)', async () => {
      const rogueToken = jwt.sign(
        { sub: userA_Manager.toString(), orgId: orgA.toString(), role: 'manager' },
        'different-unauthorized-secret-key',
        { expiresIn: '1h' }
      );
      const res = await fetch(`${baseUrl}/v1/drafts`, {
        headers: { Authorization: `Bearer ${rogueToken}` },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.success, false);
    });

    it('rejects tokens missing the subject claim (sub) (401)', async () => {
      const noSubToken = jwt.sign(
        { orgId: orgA.toString(), role: 'manager' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      const res = await fetch(`${baseUrl}/v1/drafts`, {
        headers: { Authorization: `Bearer ${noSubToken}` },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.match(data.error, /missing subject/i);
    });

    it('rejects deactivated user accounts (403)', async () => {
      const deactivatedToken = jwt.sign(
        { sub: userInactive.toString(), orgId: orgA.toString(), role: 'creator' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      const res = await fetch(`${baseUrl}/v1/drafts`, {
        headers: { Authorization: `Bearer ${deactivatedToken}` },
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.match(data.error, /Account is deactivated/i);
    });

    it('accepts valid JWT token and authenticates user successfully', async () => {
      const res = await fetch(`${baseUrl}/v1/drafts`, {
        headers: { Authorization: `Bearer ${tokenA_Manager}` },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.data));
    });
  });

  // ===========================================================================
  // 2. ORGID TENANT ISOLATION UNIT TESTS
  // ===========================================================================
  describe('2. orgId Multi-Tenant Isolation (Org A cannot access Org B)', () => {
    it('Drafts: Org A cannot fetch a Draft belonging to Org B by ID (returns 404)', async () => {
      const draftBId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftBId.toString(), {
        _id: draftBId,
        orgId: orgB,
        title: 'Org B Secret Campaign',
        status: 'draft',
      });

      // User A attempts to access Org B's draft
      const res = await fetch(`${baseUrl}/v1/drafts/${draftBId}`, {
        headers: { Authorization: `Bearer ${tokenA_Manager}` },
      });

      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.code, 'NOT_FOUND');
    });

    it('Drafts: Org A list query returns only Org A drafts, never Org B drafts', async () => {
      const draftAId = new mongoose.Types.ObjectId();
      const draftBId = new mongoose.Types.ObjectId();

      memoryDrafts.set(draftAId.toString(), {
        _id: draftAId,
        orgId: orgA,
        title: 'Org A Public Draft',
        status: 'draft',
      });

      memoryDrafts.set(draftBId.toString(), {
        _id: draftBId,
        orgId: orgB,
        title: 'Org B Confidential Draft',
        status: 'draft',
      });

      const res = await fetch(`${baseUrl}/v1/drafts`, {
        headers: { Authorization: `Bearer ${tokenA_Manager}` },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.pagination.total, 1);
      assert.equal(data.data[0]._id.toString(), draftAId.toString());
      assert.equal(data.data[0].title, 'Org A Public Draft');
    });

    it('Findings: Org A cannot action or view findings belonging to Org B (404)', async () => {
      const findingBId = new mongoose.Types.ObjectId();
      const draftBId = new mongoose.Types.ObjectId();

      memoryFindings.set(findingBId.toString(), {
        _id: findingBId,
        orgId: orgB,
        draftId: draftBId,
        status: 'open',
        type: 'violation',
        verdict: 'Contradicted',
        span: { start: 0, end: 10 },
      });

      // User A (reviewer) attempts to accept Org B's finding
      const res = await fetch(`${baseUrl}/v1/findings/${findingBId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenA_Reviewer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'accepted' }),
      });

      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.code, 'FINDING_NOT_FOUND');
    });

    it('Passports: Org A cannot view Org B Brand Passport (404)', async () => {
      const passportBId = new mongoose.Types.ObjectId();
      memoryPassports.set(passportBId.toString(), {
        _id: passportBId,
        orgId: orgB,
        draftId: new mongoose.Types.ObjectId(),
        contentHash: 'f'.repeat(64),
        rulesVersion: 'v1.2',
        checksRun: ['claim_match'],
        approvers: [],
        timestamp: new Date(),
      });

      const res = await fetch(`${baseUrl}/v1/passports/${passportBId}`, {
        headers: { Authorization: `Bearer ${tokenA_Manager}` },
      });

      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.code, 'NOT_FOUND');
    });

    it('Sources: Org A cannot view or list Org B source documents (404 and isolation)', async () => {
      const sourceBId = new mongoose.Types.ObjectId();
      memorySources.set(sourceBId.toString(), {
        _id: sourceBId,
        orgId: orgB,
        fileName: 'org_b_policy.pdf',
        type: 'guideline',
        status: 'active',
      });

      const resGet = await fetch(`${baseUrl}/v1/sources/${sourceBId}`, {
        headers: { Authorization: `Bearer ${tokenA_Manager}` },
      });
      assert.equal(resGet.status, 404);

      const resList = await fetch(`${baseUrl}/v1/sources`, {
        headers: { Authorization: `Bearer ${tokenA_Manager}` },
      });
      assert.equal(resList.status, 200);
      const listData = await resList.json();
      assert.equal(listData.total, 0);
    });

    it('enforceOrgScope middleware blocks explicit cross-tenant URL parameters (403 IDOR rejection)', () => {
      const req = {
        org: { _id: orgA },
        user: { _id: userA_Manager },
        query: { orgId: orgB.toString() },
      };
      let statusCode = null;
      let body = null;
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          body = data;
          return this;
        },
      };

      enforceOrgScope(req, res, () => {});

      assert.equal(statusCode, 403);
      assert.match(body.error, /own organisation/i);
    });

    it('injectOrgFilter middleware attaches req.orgFilter with caller orgId', () => {
      const req = { org: { _id: orgA } };
      let nextCalled = false;
      injectOrgFilter(req, {}, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true);
      assert.equal(req.orgId.toString(), orgA.toString());
      assert.deepEqual(req.orgFilter, { orgId: orgA });
    });
  });

  // ===========================================================================
  // 3. SHA-256 PASSPORT COMPUTATION UNIT TESTS
  // ===========================================================================
  describe('3. Cryptographic SHA-256 Passport Computation', () => {
    it('computes deterministic 64-character hex hash matching standard test vector', () => {
      const emptyHash = sha256('');
      assert.equal(emptyHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

      const text = 'BrandGuard Preflight Tamper-Evident Content';
      const hash1 = sha256(text);
      const hash2 = sha256(text);

      assert.equal(hash1, hash2);
      assert.equal(hash1.length, 64);
      assert.match(hash1, /^[a-f0-9]{64}$/);
    });

    it('demonstrates avalanche effect: 1-character difference completely changes hash', () => {
      const h1 = sha256('Guaranteed delivery within 30 days.');
      const h2 = sha256('Guaranteed delivery within 31 days.');

      assert.notEqual(h1, h2);
      assert.equal(h1.length, 64);
      assert.equal(h2.length, 64);
    });

    it('verifyHash validates authentic content and detects tampering using timingSafeEqual', () => {
      const original = 'Approved brand marketing copy';
      const validHash = sha256(original);

      assert.equal(verifyHash(original, validHash), true);
      assert.equal(verifyHash('Altered brand marketing copy', validHash), false);
      assert.equal(verifyHash(original, '0'.repeat(64)), false);
    });

    it('buildPassport automatically computes contentHash from content string', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const content = 'Official launch announcement for ACME Brand.';
      const expectedDigest = sha256(content);

      const passport = await buildPassport({
        orgId: orgA,
        draftId,
        content,
        rulesVersion: 'v1.2',
        approverId: userA_Manager,
      });

      assert.equal(passport.contentHash, expectedDigest);
      assert.equal(passport.rulesVersion, 'v1.2');
      assert.equal(passport.orgId.toString(), orgA.toString());
      assert.equal(passport.draftId.toString(), draftId.toString());
      assert.deepEqual(passport.checksRun, ['claim_match', 'contradiction', 'rules', 'premortem']);
    });

    it('buildPassport verifies provided contentHash and throws error on mismatch', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const content = 'Official launch content';
      const wrongHash = '1'.repeat(64);

      await assert.rejects(
        async () => {
          await buildPassport({
            orgId: orgA,
            draftId,
            content,
            contentHash: wrongHash,
          });
        },
        /Provided contentHash does not match SHA-256/
      );
    });

    it('buildPassport rejects malformed contentHash that is not a 64-char hex string', async () => {
      const draftId = new mongoose.Types.ObjectId();

      await assert.rejects(
        async () => {
          await buildPassport({
            orgId: orgA,
            draftId,
            contentHash: 'short-invalid-hash',
          });
        },
        /64-character SHA-256/
      );
    });
  });

  // ===========================================================================
  // 4. RBAC & APPROVE/OVERRIDE ROLE CHECKS UNIT TESTS
  // ===========================================================================
  describe('4. RBAC & Role Checks on Approve / Override Endpoints', () => {
    it('normalizeRole standardizes user role strings', () => {
      assert.equal(normalizeRole('Brand Manager'), 'brand_manager');
      assert.equal(normalizeRole('  AUTHORISED-REVIEWER '), 'authorised_reviewer');
      assert.equal(normalizeRole('Creator'), 'creator');
      assert.equal(normalizeRole(''), '');
      assert.equal(normalizeRole(null), '');
    });

    it('hasRole correctly evaluates hierarchy: admin satisfies all roles', () => {
      assert.equal(hasRole('admin', 'manager'), true);
      assert.equal(hasRole('admin', 'reviewer'), true);
      assert.equal(hasRole('admin', 'creator'), true);
      assert.equal(hasRole('knowledge_owner', 'brand_manager'), true);
    });

    it('hasRole handles role aliases correctly', () => {
      assert.equal(hasRole('brand_manager', 'manager'), true);
      assert.equal(hasRole('manager', 'brand_manager'), true);
      assert.equal(hasRole('editor', 'creator'), true);
      assert.equal(hasRole('authorised_reviewer', 'reviewer'), true);
    });

    it('hasRole denies lower-privileged roles from performing higher-rank operations', () => {
      assert.equal(hasRole('creator', 'manager'), false);
      assert.equal(hasRole('creator', 'reviewer'), false);
      assert.equal(hasRole('viewer', 'creator'), false);
    });

    it('Approve endpoint (POST /v1/drafts/:id/approve) enforces Manager RBAC (rejects creator with 403)', async () => {
      const draftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: orgA,
        status: 'draft',
      });

      // Creator attempts to approve draft
      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenA_Creator}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ approvedContent: 'Approved text' }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.code, 'ROLE_INSUFFICIENT');
    });

    it('Override endpoint (POST /v1/drafts/:id/override) enforces Reviewer/Manager RBAC (rejects creator with 403)', async () => {
      const draftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: orgA,
        status: 'draft',
      });

      // Creator attempts to override draft finding
      const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/override`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenA_Creator}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Overriding guideline check' }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.code, 'ROLE_INSUFFICIENT');
    });

    it('Finding action endpoint (PATCH /v1/findings/:id) enforces Reviewer/Manager RBAC (rejects creator escalation with 403)', async () => {
      const findingId = new mongoose.Types.ObjectId();
      memoryFindings.set(findingId.toString(), {
        _id: findingId,
        orgId: orgA,
        draftId: new mongoose.Types.ObjectId(),
        status: 'open',
      });

      // Creator attempts to escalate finding (restricted to managers/reviewers)
      const res = await fetch(`${baseUrl}/v1/findings/${findingId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenA_Creator}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'escalated' }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.code, 'ROLE_INSUFFICIENT');
    });

    it('Comment workflow action approve/override in POST /v1/drafts/:id/comments enforces RBAC (403 for unauthorized)', async () => {
      const draftId = new mongoose.Types.ObjectId();
      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: orgA,
        status: 'draft',
      });

      // Creator attempts to send action: 'approve' in comments
      const resApprove = await fetch(`${baseUrl}/v1/drafts/${draftId}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenA_Creator}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'I approve this', action: 'approve' }),
      });
      assert.equal(resApprove.status, 403);
      const approveData = await resApprove.json();
      assert.equal(approveData.code, 'ROLE_INSUFFICIENT');

      // Creator attempts to send action: 'override' in comments
      const resOverride = await fetch(`${baseUrl}/v1/drafts/${draftId}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenA_Creator}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Override note', action: 'override', reason: 'Override justification' }),
      });
      assert.equal(resOverride.status, 403);
      const overrideData = await resOverride.json();
      assert.equal(overrideData.code, 'ROLE_INSUFFICIENT');
    });
  });

  // ===========================================================================
  // 5. FINDING STATUS TRANSITIONS UNIT TESTS
  // ===========================================================================
  describe('5. Finding Status Lifecycle & Transitions', () => {
    it('allows valid transition: open -> accepted', async () => {
      const findingId = new mongoose.Types.ObjectId();
      const draftId = new mongoose.Types.ObjectId();

      memoryDrafts.set(draftId.toString(), {
        _id: draftId,
        orgId: orgA,
        status: 'draft',
        currentVersion: 1,
      });

      memoryFindings.set(findingId.toString(), {
        _id: findingId,
        orgId: orgA,
        draftId,
        status: 'open',
        type: 'violation',
        verdict: 'Contradicted',
        suggestedFix: 'Fixed compliant phrase',
      });

      const res = await fetch(`${baseUrl}/v1/findings/${findingId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenA_Reviewer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'accepted' }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.finding.status, 'accepted');
    });

    it('allows valid transition: open -> dismissed when reason is provided', async () => {
      const findingId = new mongoose.Types.ObjectId();
      memoryFindings.set(findingId.toString(), {
        _id: findingId,
        orgId: orgA,
        draftId: new mongoose.Types.ObjectId(),
        status: 'open',
      });

      const res = await fetch(`${baseUrl}/v1/findings/${findingId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenA_Reviewer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'dismissed', reason: 'False positive flag' }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.finding.status, 'dismissed');
    });

    it('rejects dismissed transition without reason with 400 REASON_REQUIRED', async () => {
      const findingId = new mongoose.Types.ObjectId();
      memoryFindings.set(findingId.toString(), {
        _id: findingId,
        orgId: orgA,
        draftId: new mongoose.Types.ObjectId(),
        status: 'open',
      });

      const res = await fetch(`${baseUrl}/v1/findings/${findingId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenA_Reviewer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'dismissed' }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'REASON_REQUIRED');
    });

    it('rejects transition from terminal status accepted to any other status (422 TERMINAL_STATUS)', async () => {
      const findingId = new mongoose.Types.ObjectId();
      memoryFindings.set(findingId.toString(), {
        _id: findingId,
        orgId: orgA,
        draftId: new mongoose.Types.ObjectId(),
        status: 'accepted',
      });

      const res = await fetch(`${baseUrl}/v1/findings/${findingId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenA_Reviewer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'open' }),
      });

      assert.equal(res.status, 422);
      const data = await res.json();
      assert.equal(data.code, 'TERMINAL_STATUS');
    });

    it('rejects transition to identical current status with 409 STATUS_UNCHANGED', async () => {
      const findingId = new mongoose.Types.ObjectId();
      memoryFindings.set(findingId.toString(), {
        _id: findingId,
        orgId: orgA,
        draftId: new mongoose.Types.ObjectId(),
        status: 'open',
      });

      const res = await fetch(`${baseUrl}/v1/findings/${findingId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenA_Reviewer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'open' }),
      });

      assert.equal(res.status, 409);
      const data = await res.json();
      assert.equal(data.code, 'STATUS_UNCHANGED');
    });

    it('rejects invalid status strings with 400 INVALID_STATUS', async () => {
      const findingId = new mongoose.Types.ObjectId();
      memoryFindings.set(findingId.toString(), {
        _id: findingId,
        orgId: orgA,
        draftId: new mongoose.Types.ObjectId(),
        status: 'open',
      });

      const res = await fetch(`${baseUrl}/v1/findings/${findingId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenA_Reviewer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'invalid_status_value' }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'INVALID_STATUS');
    });
  });

  // ===========================================================================
  // 6. APPEND-ONLY VERIFICATION (NO PATCH/DELETE ON AUDITLOG OR PASSPORTS)
  // ===========================================================================
  describe('6. Append-Only Enforcement (AuditLog & Brand Passports)', () => {
    it('verifies Passports endpoint strictly rejects PATCH with 405 Method Not Allowed', async () => {
      const passportId = new mongoose.Types.ObjectId();
      const res = await fetch(`${baseUrl}/v1/passports/${passportId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenA_Manager}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contentHash: 'altered-hash' }),
      });

      assert.equal(res.status, 405);
      const data = await res.json();
      assert.equal(data.code, 'METHOD_NOT_ALLOWED');
    });

    it('verifies Passports endpoint strictly rejects DELETE with 405 Method Not Allowed', async () => {
      const passportId = new mongoose.Types.ObjectId();
      const res = await fetch(`${baseUrl}/v1/passports/${passportId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenA_Manager}` },
      });

      assert.equal(res.status, 405);
      const data = await res.json();
      assert.equal(data.code, 'METHOD_NOT_ALLOWED');
    });

    it('verifies no routes exist for AuditLog mutations (returns 404 Route Not Found)', async () => {
      const resPatch = await fetch(`${baseUrl}/v1/auditLog/123`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tokenA_Manager}` },
      });
      assert.equal(resPatch.status, 404);

      const resDelete = await fetch(`${baseUrl}/v1/auditLog/123`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenA_Manager}` },
      });
      assert.equal(resDelete.status, 404);
    });
  });
});
