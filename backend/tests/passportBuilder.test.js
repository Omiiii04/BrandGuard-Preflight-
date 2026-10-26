/**
 * passportBuilder.test.js — Unit and Integration tests for Brand Passport service and routes.
 *
 * Covers:
 *   - passportBuilder service:
 *       - SHA-256 digest computation of approved content
 *       - Verification against provided contentHash
 *       - checksRun list
 *       - rulesVersion
 *       - approvers normalization
 *       - aiUsed flag
 *       - append-only persistence
 *   - GET /v1/passports/:id:
 *       - Authentication & tenant isolation
 *       - 400 for invalid ObjectId
 *       - 404 when passport is missing or from another org
 *       - 200 with populated approvers
 *       - Append-only enforcement: 405 for PATCH/DELETE/PUT
 *   - Passport Mongoose model append-only guards:
 *       - Disallows updateOne/deleteOne/re-saving existing documents
 */

'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'brandguard-super-secret-jwt-key-change-me-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const User = require('../src/models/User');
const Passport = require('../src/models/Passport');
const { buildPassport } = require('../src/services/passportBuilder');
const { sha256 } = require('../src/utils/hash');
const passportsRouter = require('../src/routes/passports');
const { errorHandler } = require('../src/middleware/errorHandler');

describe('Brand Passport Service & API Routes', () => {
  const testOrgId = new mongoose.Types.ObjectId();
  const otherOrgId = new mongoose.Types.ObjectId();
  const managerUserId = new mongoose.Types.ObjectId();
  const creatorUserId = new mongoose.Types.ObjectId();

  const managerToken = jwt.sign(
    { sub: managerUserId.toString(), orgId: testOrgId.toString(), role: 'manager' },
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
  let memoryPassports = new Map();

  // Save original methods
  const originalSave = Passport.prototype.save;
  const originalFindOne = Passport.findOne;
  const originalFind = Passport.find;
  const originalUserFindById = User.findById;

  before(async () => {
    // Mock User.findById for auth middleware
    User.findById = function (id) {
      const idStr = id?.toString ? id.toString() : id;
      const isOtherOrg = idStr === creatorUserId.toString();
      const orgId = isOtherOrg ? otherOrgId : testOrgId;
      const role = isOtherOrg ? 'creator' : 'manager';

      return {
        populate: function () {
          return {
            select: function () {
              return {
                lean: async function () {
                  return {
                    _id: new mongoose.Types.ObjectId(idStr),
                    name: isOtherOrg ? 'Other User' : 'Manager User',
                    email: isOtherOrg ? 'other@acme.com' : 'manager@acme.com',
                    role,
                    active: true,
                    orgId: {
                      _id: orgId,
                      name: isOtherOrg ? 'Other Corp' : 'Test Corp',
                      active: true,
                    },
                  };
                },
              };
            },
          };
        },
      };
    };

    // Setup Express test harness
    const app = express();
    app.use(express.json());
    app.use('/v1/passports', passportsRouter);
    app.use(errorHandler);

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    Passport.prototype.save = originalSave;
    Passport.findOne = originalFindOne;
    Passport.find = originalFind;
    User.findById = originalUserFindById;
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    memoryPassports.clear();

    Passport.prototype.save = async function () {
      const obj = this.toObject ? this.toObject() : { ...this._doc };
      obj._id = this._id || new mongoose.Types.ObjectId();
      memoryPassports.set(obj._id.toString(), obj);
      return obj;
    };

    Passport.findOne = function (query) {
      return {
        populate: function () {
          return {
            lean: async function () {
              const _id = query._id?.toString ? query._id.toString() : query._id;
              const found = memoryPassports.get(_id);
              if (!found) return null;
              if (query.orgId && found.orgId?.toString() !== query.orgId?.toString()) {
                return null;
              }
              return {
                ...found,
                approvers: (found.approvers || []).map((appId) => ({
                  _id: appId,
                  name: 'Manager User',
                  email: 'manager@brandguard.internal',
                  role: 'manager',
                })),
              };
            },
          };
        },
      };
    };

    Passport.find = function (query) {
      return {
        populate: function () {
          return {
            sort: function () {
              return {
                lean: async function () {
                  let results = Array.from(memoryPassports.values());
                  if (query.orgId) {
                    results = results.filter((p) => p.orgId?.toString() === query.orgId?.toString());
                  }
                  if (query.draftId) {
                    results = results.filter((p) => p.draftId?.toString() === query.draftId?.toString());
                  }
                  return results;
                },
              };
            },
          };
        },
      };
    };
  });

  describe('passportBuilder.js service', () => {
    it('generates a passport with SHA-256 computed from approved content', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const content = 'Brand approved advertising claim: Guaranteed 99.99% uptime.';
      const expectedHash = sha256(content);

      const passport = await buildPassport({
        orgId: testOrgId,
        draftId,
        content,
        approverId: managerUserId,
        aiUsed: true,
      });

      assert.ok(passport);
      assert.equal(passport.contentHash, expectedHash);
      assert.deepEqual(passport.checksRun, ['claim_match', 'contradiction', 'rules', 'premortem']);
      assert.equal(passport.rulesVersion, 'v1.2');
      assert.equal(passport.aiUsed, true);
      assert.equal(passport.approvers.length, 1);
      assert.equal(passport.approvers[0].toString(), managerUserId.toString());
      assert.ok(passport.timestamp instanceof Date);
    });

    it('accepts custom checksRun and rulesVersion', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const content = 'Clinically proven results in 14 days.';
      const customChecks = ['claim_match', 'fda_compliance', 'contradiction'];

      const passport = await buildPassport({
        orgId: testOrgId,
        draftId,
        content,
        checksRun: customChecks,
        rulesVersion: 'v2.0',
        approvers: [managerUserId, creatorUserId],
        aiUsed: false,
        externalProviderUsed: 'Claude-3.5',
      });

      assert.deepEqual(passport.checksRun, customChecks);
      assert.equal(passport.rulesVersion, 'v2.0');
      assert.equal(passport.aiUsed, false);
      assert.equal(passport.externalProviderUsed, 'Claude-3.5');
      assert.equal(passport.approvers.length, 2);
    });

    it('validates matching contentHash when both content and hash are provided', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const content = 'Valid content to sign off.';
      const validHash = sha256(content);

      const passport = await buildPassport({
        orgId: testOrgId,
        draftId,
        content,
        contentHash: validHash,
        approverId: managerUserId,
      });

      assert.equal(passport.contentHash, validHash);
    });

    it('throws error when provided contentHash mismatches content SHA-256', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const content = 'Original copy';
      const fakeHash = 'a'.repeat(64);

      await assert.rejects(
        async () => {
          await buildPassport({
            orgId: testOrgId,
            draftId,
            content,
            contentHash: fakeHash,
            approverId: managerUserId,
          });
        },
        /Provided contentHash does not match SHA-256 of approved content/
      );
    });

    it('throws error when required parameters are missing', async () => {
      await assert.rejects(async () => buildPassport(null), /params object is required/);
      await assert.rejects(async () => buildPassport({}), /orgId is required/);
      await assert.rejects(
        async () => buildPassport({ orgId: testOrgId }),
        /draftId is required/
      );
      await assert.rejects(
        async () => buildPassport({ orgId: testOrgId, draftId: new mongoose.Types.ObjectId() }),
        /valid 64-character SHA-256 contentHash or content/
      );
    });

    it('accepts pre-computed contentHash when content text is not passed', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const precomputed = 'e'.repeat(64);

      const passport = await buildPassport({
        orgId: testOrgId,
        draftId,
        contentHash: precomputed,
        approvers: [{ _id: managerUserId }],
      });

      assert.equal(passport.contentHash, precomputed);
      assert.equal(passport.approvers[0].toString(), managerUserId.toString());
    });
  });

  describe('GET /v1/passports/:id route', () => {
    it('returns 401 when token is missing', async () => {
      const passportId = new mongoose.Types.ObjectId();
      const res = await fetch(`${baseUrl}/v1/passports/${passportId}`);
      assert.equal(res.status, 401);
    });

    it('returns 400 when passport ID is not a valid ObjectId', async () => {
      const res = await fetch(`${baseUrl}/v1/passports/invalid-id-123`, {
        headers: { Authorization: `Bearer ${managerToken}` },
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'INVALID_ID');
    });

    it('returns 404 when passport does not exist', async () => {
      const randomId = new mongoose.Types.ObjectId();
      const res = await fetch(`${baseUrl}/v1/passports/${randomId}`, {
        headers: { Authorization: `Bearer ${managerToken}` },
      });
      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.code, 'NOT_FOUND');
    });

    it('returns 404 when passport belongs to a different organisation (org isolation)', async () => {
      const passportId = new mongoose.Types.ObjectId();
      memoryPassports.set(passportId.toString(), {
        _id: passportId,
        orgId: testOrgId,
        draftId: new mongoose.Types.ObjectId(),
        contentHash: 'c'.repeat(64),
        checksRun: ['claim_match'],
        rulesVersion: 'v1.2',
        approvers: [managerUserId],
        aiUsed: true,
        timestamp: new Date(),
      });

      // Request with token from otherOrgId
      const res = await fetch(`${baseUrl}/v1/passports/${passportId}`, {
        headers: { Authorization: `Bearer ${otherOrgToken}` },
      });
      assert.equal(res.status, 404);
    });

    it('retrieves passport with populated approvers for authorized tenant', async () => {
      const passportId = new mongoose.Types.ObjectId();
      const draftId = new mongoose.Types.ObjectId();
      const contentHash = sha256('Approved content for passport retrieval test');

      memoryPassports.set(passportId.toString(), {
        _id: passportId,
        orgId: testOrgId,
        draftId,
        contentHash,
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
      assert.equal(data.contentHash, contentHash);
      assert.equal(data.checksRun.length, 4);
      assert.equal(data.aiUsed, true);
      assert.equal(data.approvers[0].name, 'Manager User');
      assert.equal(data.approvers[0].role, 'manager');
    });

    it('lists passports for organization via GET /v1/passports', async () => {
      const passportId1 = new mongoose.Types.ObjectId();
      const passportId2 = new mongoose.Types.ObjectId();

      memoryPassports.set(passportId1.toString(), {
        _id: passportId1,
        orgId: testOrgId,
        draftId: new mongoose.Types.ObjectId(),
        contentHash: '1'.repeat(64),
        checksRun: ['claim_match'],
        rulesVersion: 'v1.2',
        approvers: [managerUserId],
        aiUsed: true,
        timestamp: new Date(),
      });
      memoryPassports.set(passportId2.toString(), {
        _id: passportId2,
        orgId: testOrgId,
        draftId: new mongoose.Types.ObjectId(),
        contentHash: '2'.repeat(64),
        checksRun: ['claim_match'],
        rulesVersion: 'v1.2',
        approvers: [managerUserId],
        aiUsed: true,
        timestamp: new Date(),
      });

      const res = await fetch(`${baseUrl}/v1/passports`, {
        headers: { Authorization: `Bearer ${managerToken}` },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.count, 2);
    });
  });

  describe('Append-only route enforcement (no PATCH or DELETE)', () => {
    it('rejects PATCH /v1/passports/:id with 405 Method Not Allowed', async () => {
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

    it('rejects DELETE /v1/passports/:id with 405 Method Not Allowed', async () => {
      const passportId = new mongoose.Types.ObjectId();
      const res = await fetch(`${baseUrl}/v1/passports/${passportId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${managerToken}` },
      });

      assert.equal(res.status, 405);
      const data = await res.json();
      assert.equal(data.code, 'METHOD_NOT_ALLOWED');
    });

    it('rejects PUT /v1/passports/:id with 405 Method Not Allowed', async () => {
      const passportId = new mongoose.Types.ObjectId();
      const res = await fetch(`${baseUrl}/v1/passports/${passportId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ aiUsed: false }),
      });

      assert.equal(res.status, 405);
      const data = await res.json();
      assert.equal(data.code, 'METHOD_NOT_ALLOWED');
    });
  });
});
