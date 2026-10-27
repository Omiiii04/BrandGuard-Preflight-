/**
 * apiContract.test.js — OpenAPI 3.1 Contract Compliance Test Suite
 *
 * Verifies every endpoint defined in openapi.yaml for strict compliance with:
 *   - 401 Unauthorized (missing token, invalid token, or missing API key)
 *   - 403 Forbidden (role insufficiency, unauthorized action, or invalid/revoked API key)
 *   - 400 / 422 Bad Request & Validation Errors (malformed payload, invalid ObjectId, missing fields)
 */

'use strict';

// Set test environment variables before requiring route modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-contract-jwt-secret-very-secure-32chars';
process.env.GATE_API_KEY = 'gate_test_valid_key_12345';
process.env.ORGANISATION_ID = '60d5ec49f1b2c8b1f8e4e1a1';
process.env.MINIO_ENDPOINT = '127.0.0.1';
process.env.MINIO_PORT = '9000';
process.env.MINIO_BUCKET = 'test-bucket';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// Mock external services before loading routes
const minio = require('../src/utils/minio');
minio.uploadObject = async () => ({ etag: 'etag-123', versionId: null });
minio.getPresignedUrl = async () => 'http://localhost:9000/test-bucket/presigned-url';
if (minio.minioClient) {
  minio.minioClient.putObject = async () => ({ etag: 'etag-123' });
}

// Stubs for models and routes
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

const User = require('../src/models/User');
const Organisation = require('../src/models/Org');
const Source = require('../src/models/Source');
const Draft = require('../src/models/Draft');
const Finding = require('../src/models/Finding');
const BrandPassport = require('../src/models/Passport');
const Fact = require('../src/models/Fact');

function makeChainable(resolvedValue) {
  const promise = Promise.resolve(resolvedValue);
  promise.sort = () => promise;
  promise.populate = () => promise;
  promise.select = () => promise;
  promise.lean = () => promise;
  return promise;
}

test.describe('OpenAPI 3.1 Contract Compliance Suite', () => {
  let server;
  let baseUrl;
  let creatorToken;
  let viewerToken;
  let managerToken;
  let ownerToken;

  const validOrgId = new mongoose.Types.ObjectId().toString();
  const validCreatorId = new mongoose.Types.ObjectId().toString();
  const validManagerId = new mongoose.Types.ObjectId().toString();
  const validViewerId = new mongoose.Types.ObjectId().toString();
  const validOwnerId = new mongoose.Types.ObjectId().toString();

  const validGateApiKey = 'gate_test_valid_key_12345';
  const invalidObjectId = 'invalid-mongo-id-xyz';

  // Helper HTTP request function
  async function apiRequest(method, path, options = {}) {
    const { token, apiKey, body, headers = {} } = options;
    const reqHeaders = { ...headers };

    if (token) {
      reqHeaders['Authorization'] = `Bearer ${token}`;
    }
    if (apiKey) {
      reqHeaders['X-Gate-Api-Key'] = apiKey;
    }

    let payload = null;
    if (body !== undefined && !reqHeaders['Content-Type']?.includes('multipart/form-data')) {
      reqHeaders['Content-Type'] = 'application/json';
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const url = new URL(path, baseUrl);

    return new Promise((resolve, reject) => {
      const req = http.request(
        url,
        {
          method,
          headers: reqHeaders,
        },
        (res) => {
          let rawData = '';
          res.on('data', (chunk) => {
            rawData += chunk;
          });
          res.on('end', () => {
            let data = null;
            try {
              data = JSON.parse(rawData);
            } catch {
              data = rawData;
            }
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data,
            });
          });
        }
      );

      req.on('error', reject);
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  test.before(async () => {
    // Generate test JWT tokens
    const secret = process.env.JWT_SECRET;
    creatorToken = jwt.sign({ sub: validCreatorId, _id: validCreatorId, orgId: validOrgId, role: 'creator', email: 'creator@test.com' }, secret);
    viewerToken = jwt.sign({ sub: validViewerId, _id: validViewerId, orgId: validOrgId, role: 'viewer', email: 'viewer@test.com' }, secret);
    managerToken = jwt.sign({ sub: validManagerId, _id: validManagerId, orgId: validOrgId, role: 'manager', email: 'manager@test.com' }, secret);
    ownerToken = jwt.sign({ sub: validOwnerId, _id: validOwnerId, orgId: validOrgId, role: 'owner', email: 'owner@test.com' }, secret);

    const mockOrg = { _id: validOrgId, name: 'Stellara Brands', active: true, status: 'active' };

    // Mock User queries
    User.findById = (id) => {
      const strId = id?.toString();
      if (strId === validCreatorId) return makeChainable({ _id: validCreatorId, orgId: mockOrg, role: 'creator', email: 'creator@test.com', active: true });
      if (strId === validViewerId) return makeChainable({ _id: validViewerId, orgId: mockOrg, role: 'viewer', email: 'viewer@test.com', active: true });
      if (strId === validManagerId) return makeChainable({ _id: validManagerId, orgId: mockOrg, role: 'manager', email: 'manager@test.com', active: true });
      if (strId === validOwnerId) return makeChainable({ _id: validOwnerId, orgId: mockOrg, role: 'owner', email: 'owner@test.com', active: true });
      return makeChainable(null);
    };

    User.findOne = (query) => {
      return makeChainable(null);
    };

    Source.findOne = (query) => {
      return makeChainable({
        _id: query?._id || new mongoose.Types.ObjectId(),
        orgId: validOrgId,
        title: 'Sample Guideline',
        status: 'pending',
        save: async () => {},
      });
    };

    Draft.findOne = (query) => {
      return makeChainable({
        _id: query?._id || new mongoose.Types.ObjectId(),
        orgId: validOrgId,
        title: 'Sample Draft',
        status: 'draft',
        save: async () => {},
      });
    };

    Finding.findOne = (query) => {
      return makeChainable({
        _id: query?._id || new mongoose.Types.ObjectId(),
        orgId: validOrgId,
        status: 'open',
        save: async () => {},
      });
    };

    // Mock Organisation findOne for Gate API Key
    Organisation.findOne = (query) => {
      if (query?.gateApiKey === validGateApiKey || query?.apiKey === validGateApiKey) {
        return makeChainable({ _id: validOrgId, name: 'Stellara Brands', status: 'active', active: true });
      }
      return makeChainable(null);
    };

    // Build Express app with all routers
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.get('/health', (_req, res) => {
      res.status(200).json({ status: 'healthy', service: 'brandguard-api', timestamp: new Date().toISOString() });
    });
    app.get('/', (_req, res) => {
      res.json({ name: 'BrandGuard Preflight API', version: '1.0.0', status: 'running' });
    });

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

  test.after(() => {
    if (server) server.close();
  });

  // ============================================================================
  // 1. SYSTEM ENDPOINTS
  // ============================================================================
  test.describe('System Endpoints (/health, /)', () => {
    test('GET /health returns 200 without authentication', async () => {
      const res = await apiRequest('GET', '/health');
      assert.equal(res.status, 200);
      assert.equal(res.data.status, 'healthy');
    });

    test('GET / returns 200 without authentication', async () => {
      const res = await apiRequest('GET', '/');
      assert.equal(res.status, 200);
      assert.equal(res.data.status, 'running');
    });
  });

  // ============================================================================
  // 2. AUTH ENDPOINTS (/v1/auth/login, /v1/auth/me)
  // ============================================================================
  test.describe('Auth Endpoints (/v1/auth)', () => {
    test('POST /v1/auth/login: 422 or 400 on missing or invalid body schema', async () => {
      const res = await apiRequest('POST', '/v1/auth/login', { body: {} });
      assert.ok([400, 422].includes(res.status), `Expected 400 or 422, got ${res.status}`);
    });

    test('POST /v1/auth/login: 401 on invalid credentials', async () => {
      const res = await apiRequest('POST', '/v1/auth/login', {
        body: { email: 'nonexistent@stellara.com', password: 'wrongpassword123' },
      });
      assert.equal(res.status, 401);
    });

    test('GET /v1/auth/me: 401 when token is missing or invalid', async () => {
      const resMissing = await apiRequest('GET', '/v1/auth/me');
      assert.equal(resMissing.status, 401);

      const resInvalid = await apiRequest('GET', '/v1/auth/me', { token: 'invalid.bearer.token' });
      assert.equal(resInvalid.status, 401);
    });
  });

  // ============================================================================
  // 3. SOURCES ENDPOINTS (/v1/sources, /v1/sources/:id)
  // ============================================================================
  test.describe('Sources Endpoints (/v1/sources)', () => {
    test('GET /v1/sources: 401 without token', async () => {
      const res = await apiRequest('GET', '/v1/sources');
      assert.equal(res.status, 401);
    });

    test('POST /v1/sources: 401 without token', async () => {
      const res = await apiRequest('POST', '/v1/sources');
      assert.equal(res.status, 401);
    });

    test('POST /v1/sources: 403 when role is insufficient (viewer)', async () => {
      const res = await apiRequest('POST', '/v1/sources', {
        token: viewerToken,
        body: { title: 'Test Source', type: 'guideline' },
      });
      assert.equal(res.status, 403);
    });

    test('POST /v1/sources: 400 on missing required file / data', async () => {
      const res = await apiRequest('POST', '/v1/sources', {
        token: creatorToken,
        body: { title: 'No File Source' },
      });
      assert.equal(res.status, 400);
    });

    test('GET /v1/sources/:id: 401 without token', async () => {
      const res = await apiRequest('GET', `/v1/sources/${new mongoose.Types.ObjectId()}`);
      assert.equal(res.status, 401);
    });

    test('GET /v1/sources/:id: 400 on invalid ObjectId', async () => {
      const res = await apiRequest('GET', `/v1/sources/${invalidObjectId}`, { token: creatorToken });
      assert.equal(res.status, 400);
    });

    test('PATCH /v1/sources/:id: 401 without token', async () => {
      const res = await apiRequest('PATCH', `/v1/sources/${new mongoose.Types.ObjectId()}`, {
        body: { status: 'approved' },
      });
      assert.equal(res.status, 401);
    });

    test('PATCH /v1/sources/:id: 403 when role is insufficient (creator or viewer)', async () => {
      const resCreator = await apiRequest('PATCH', `/v1/sources/${new mongoose.Types.ObjectId()}`, {
        token: creatorToken,
        body: { status: 'approved' },
      });
      assert.equal(resCreator.status, 403);

      const resViewer = await apiRequest('PATCH', `/v1/sources/${new mongoose.Types.ObjectId()}`, {
        token: viewerToken,
        body: { status: 'approved' },
      });
      assert.equal(resViewer.status, 403);
    });

    test('PATCH /v1/sources/:id: 400 on invalid ObjectId or invalid body', async () => {
      const resBadId = await apiRequest('PATCH', `/v1/sources/${invalidObjectId}`, {
        token: managerToken,
        body: { status: 'approved' },
      });
      assert.equal(resBadId.status, 400);

      const resBadStatus = await apiRequest('PATCH', `/v1/sources/${new mongoose.Types.ObjectId()}`, {
        token: managerToken,
        body: { status: 'nonexistent-status' },
      });
      assert.equal(resBadStatus.status, 400);
    });
  });

  // ============================================================================
  // 4. DRAFTS ENDPOINTS (/v1/drafts, /v1/drafts/:id, sub-routes)
  // ============================================================================
  test.describe('Drafts Endpoints (/v1/drafts)', () => {
    test('POST /v1/drafts: 401 without token', async () => {
      const res = await apiRequest('POST', '/v1/drafts', { body: { title: 'T', content: 'C' } });
      assert.equal(res.status, 401);
    });

    test('POST /v1/drafts: 403 when role is insufficient (viewer)', async () => {
      const res = await apiRequest('POST', '/v1/drafts', {
        token: viewerToken,
        body: { title: 'Test Draft', content: 'Some sample draft content.' },
      });
      assert.equal(res.status, 403);
    });

    test('POST /v1/drafts: 400 on missing required fields', async () => {
      const res = await apiRequest('POST', '/v1/drafts', {
        token: creatorToken,
        body: { title: '' },
      });
      assert.equal(res.status, 400);
    });

    test('POST /v1/drafts/redaction-preview: 401 without token', async () => {
      const res = await apiRequest('POST', '/v1/drafts/redaction-preview', { body: { content: 'test' } });
      assert.equal(res.status, 401);
    });

    test('POST /v1/drafts/redaction-preview: 400 on missing content', async () => {
      const res = await apiRequest('POST', '/v1/drafts/redaction-preview', {
        token: creatorToken,
        body: {},
      });
      assert.equal(res.status, 400);
    });

    test('GET /v1/drafts/:id: 401 without token', async () => {
      const res = await apiRequest('GET', `/v1/drafts/${new mongoose.Types.ObjectId()}`);
      assert.equal(res.status, 401);
    });

    test('GET /v1/drafts/:id: 400 on invalid ObjectId', async () => {
      const res = await apiRequest('GET', `/v1/drafts/${invalidObjectId}`, { token: creatorToken });
      assert.equal(res.status, 400);
    });

    test('GET /v1/drafts/:id/redaction-preview: 401 without token', async () => {
      const res = await apiRequest('GET', `/v1/drafts/${new mongoose.Types.ObjectId()}/redaction-preview`);
      assert.equal(res.status, 401);
    });

    test('GET /v1/drafts/:id/redaction-preview: 400 on invalid ObjectId', async () => {
      const res = await apiRequest('GET', `/v1/drafts/${invalidObjectId}/redaction-preview`, { token: creatorToken });
      assert.equal(res.status, 400);
    });

    test('POST /v1/drafts/:id/redaction-preview: 401 without token', async () => {
      const res = await apiRequest('POST', `/v1/drafts/${new mongoose.Types.ObjectId()}/redaction-preview`);
      assert.equal(res.status, 401);
    });

    test('POST /v1/drafts/:id/redaction-preview: 400 on invalid ObjectId', async () => {
      const res = await apiRequest('POST', `/v1/drafts/${invalidObjectId}/redaction-preview`, { token: creatorToken });
      assert.equal(res.status, 400);
    });

    test('POST /v1/drafts/:id/review: 401 without token', async () => {
      const res = await apiRequest('POST', `/v1/drafts/${new mongoose.Types.ObjectId()}/review`);
      assert.equal(res.status, 401);
    });

    test('POST /v1/drafts/:id/review: 403 when role is insufficient (viewer)', async () => {
      const res = await apiRequest('POST', `/v1/drafts/${new mongoose.Types.ObjectId()}/review`, {
        token: viewerToken,
      });
      assert.equal(res.status, 403);
    });

    test('POST /v1/drafts/:id/review: 400 on invalid ObjectId', async () => {
      const res = await apiRequest('POST', `/v1/drafts/${invalidObjectId}/review`, { token: creatorToken });
      assert.equal(res.status, 400);
    });

    test('GET /v1/drafts/:id/versions: 401 without token', async () => {
      const res = await apiRequest('GET', `/v1/drafts/${new mongoose.Types.ObjectId()}/versions`);
      assert.equal(res.status, 401);
    });

    test('GET /v1/drafts/:id/versions: 400 on invalid ObjectId', async () => {
      const res = await apiRequest('GET', `/v1/drafts/${invalidObjectId}/versions`, { token: creatorToken });
      assert.equal(res.status, 400);
    });

    test('GET /v1/drafts/:id/findings: 401 without token', async () => {
      const res = await apiRequest('GET', `/v1/drafts/${new mongoose.Types.ObjectId()}/findings`);
      assert.equal(res.status, 401);
    });

    test('GET /v1/drafts/:id/findings: 400 on invalid ObjectId', async () => {
      const res = await apiRequest('GET', `/v1/drafts/${invalidObjectId}/findings`, { token: creatorToken });
      assert.equal(res.status, 400);
    });

    test('POST /v1/drafts/:id/comments: 401 without token', async () => {
      const res = await apiRequest('POST', `/v1/drafts/${new mongoose.Types.ObjectId()}/comments`, {
        body: { body: 'Test comment' },
      });
      assert.equal(res.status, 401);
    });

    test('POST /v1/drafts/:id/comments: 400 on invalid ObjectId or missing body', async () => {
      const resBadId = await apiRequest('POST', `/v1/drafts/${invalidObjectId}/comments`, {
        token: creatorToken,
        body: { body: 'Test comment' },
      });
      assert.equal(resBadId.status, 400);

      const resEmptyBody = await apiRequest('POST', `/v1/drafts/${new mongoose.Types.ObjectId()}/comments`, {
        token: creatorToken,
        body: { body: '' },
      });
      assert.equal(resEmptyBody.status, 400);
    });

    test('GET /v1/drafts/:id/comments: 401 without token', async () => {
      const res = await apiRequest('GET', `/v1/drafts/${new mongoose.Types.ObjectId()}/comments`);
      assert.equal(res.status, 401);
    });

    test('GET /v1/drafts/:id/comments: 400 on invalid ObjectId', async () => {
      const res = await apiRequest('GET', `/v1/drafts/${invalidObjectId}/comments`, { token: creatorToken });
      assert.equal(res.status, 400);
    });

    test('POST /v1/drafts/:id/approve: 401 without token', async () => {
      const res = await apiRequest('POST', `/v1/drafts/${new mongoose.Types.ObjectId()}/approve`);
      assert.equal(res.status, 401);
    });

    test('POST /v1/drafts/:id/approve: 403 when role is insufficient (creator or viewer)', async () => {
      const resCreator = await apiRequest('POST', `/v1/drafts/${new mongoose.Types.ObjectId()}/approve`, {
        token: creatorToken,
      });
      assert.equal(resCreator.status, 403);

      const resViewer = await apiRequest('POST', `/v1/drafts/${new mongoose.Types.ObjectId()}/approve`, {
        token: viewerToken,
      });
      assert.equal(resViewer.status, 403);
    });

    test('POST /v1/drafts/:id/approve: 400 on invalid ObjectId', async () => {
      const res = await apiRequest('POST', `/v1/drafts/${invalidObjectId}/approve`, { token: managerToken });
      assert.equal(res.status, 400);
    });

    test('POST /v1/drafts/:id/request-changes: 401 without token', async () => {
      const res = await apiRequest('POST', `/v1/drafts/${new mongoose.Types.ObjectId()}/request-changes`);
      assert.equal(res.status, 401);
    });

    test('POST /v1/drafts/:id/request-changes: 403 when role is insufficient (creator or viewer)', async () => {
      const resCreator = await apiRequest('POST', `/v1/drafts/${new mongoose.Types.ObjectId()}/request-changes`, {
        token: creatorToken,
        body: { note: 'Needs more detail' },
      });
      assert.equal(resCreator.status, 403);

      const resViewer = await apiRequest('POST', `/v1/drafts/${new mongoose.Types.ObjectId()}/request-changes`, {
        token: viewerToken,
        body: { note: 'Needs more detail' },
      });
      assert.equal(resViewer.status, 403);
    });

    test('POST /v1/drafts/:id/request-changes: 400 on invalid ObjectId', async () => {
      const res = await apiRequest('POST', `/v1/drafts/${invalidObjectId}/request-changes`, {
        token: managerToken,
        body: { note: 'Needs fix' },
      });
      assert.equal(res.status, 400);
    });
  });

  // ============================================================================
  // 5. FINDINGS ENDPOINT (/v1/findings/:id)
  // ============================================================================
  test.describe('Findings Endpoints (/v1/findings)', () => {
    test('PATCH /v1/findings/:id: 401 without token', async () => {
      const res = await apiRequest('PATCH', `/v1/findings/${new mongoose.Types.ObjectId()}`, {
        body: { status: 'accepted' },
      });
      assert.equal(res.status, 401);
    });

    test('PATCH /v1/findings/:id: 403 when creator attempts unauthorized action (escalated)', async () => {
      const res = await apiRequest('PATCH', `/v1/findings/${new mongoose.Types.ObjectId()}`, {
        token: creatorToken,
        body: { status: 'escalated' },
      });
      assert.equal(res.status, 403);
    });

    test('PATCH /v1/findings/:id: 403 when viewer attempts modification', async () => {
      const res = await apiRequest('PATCH', `/v1/findings/${new mongoose.Types.ObjectId()}`, {
        token: viewerToken,
        body: { status: 'accepted' },
      });
      assert.equal(res.status, 403);
    });

    test('PATCH /v1/findings/:id: 400 on invalid ObjectId or invalid status', async () => {
      const resBadId = await apiRequest('PATCH', `/v1/findings/${invalidObjectId}`, {
        token: creatorToken,
        body: { status: 'accepted' },
      });
      assert.equal(resBadId.status, 400);

      const resBadStatus = await apiRequest('PATCH', `/v1/findings/${new mongoose.Types.ObjectId()}`, {
        token: creatorToken,
        body: { status: 'bogus_status' },
      });
      assert.equal(resBadStatus.status, 400);
    });
  });

  // ============================================================================
  // 6. FACTS ENDPOINTS (/v1/facts)
  // ============================================================================
  test.describe('Facts Endpoints (/v1/facts)', () => {
    test('GET /v1/facts: 401 without token', async () => {
      const res = await apiRequest('GET', '/v1/facts');
      assert.equal(res.status, 401);
    });

    test('POST /v1/facts: 401 without token', async () => {
      const res = await apiRequest('POST', '/v1/facts', {
        body: { label: 'Return Policy', statement: 'Returns within 30 days.' },
      });
      assert.equal(res.status, 401);
    });

    test('POST /v1/facts: 403 when creator or viewer attempts to create fact (owner required)', async () => {
      const resCreator = await apiRequest('POST', '/v1/facts', {
        token: creatorToken,
        body: { label: 'Return Policy', statement: 'Returns within 30 days.' },
      });
      assert.equal(resCreator.status, 403);

      const resViewer = await apiRequest('POST', '/v1/facts', {
        token: viewerToken,
        body: { label: 'Return Policy', statement: 'Returns within 30 days.' },
      });
      assert.equal(resViewer.status, 403);
    });

    test('POST /v1/facts: 400 on validation failure (missing statement)', async () => {
      const res = await apiRequest('POST', '/v1/facts', {
        token: ownerToken,
        body: { label: 'Incomplete Fact' },
      });
      assert.equal(res.status, 400);
    });
  });

  // ============================================================================
  // 7. PASSPORT ENDPOINTS (/v1/passports/:id)
  // ============================================================================
  test.describe('Passport Endpoints (/v1/passports)', () => {
    test('GET /v1/passports/:id: 401 without token', async () => {
      const res = await apiRequest('GET', `/v1/passports/${new mongoose.Types.ObjectId()}`);
      assert.equal(res.status, 401);
    });

    test('GET /v1/passports/:id: 400 on invalid ObjectId', async () => {
      const res = await apiRequest('GET', `/v1/passports/${invalidObjectId}`, { token: creatorToken });
      assert.equal(res.status, 400);
    });
  });

  // ============================================================================
  // 8. INSIGHTS ENDPOINTS (/v1/insights/rules, /v1/insights/mistakes)
  // ============================================================================
  test.describe('Insights Endpoints (/v1/insights)', () => {
    test('GET /v1/insights/rules: 401 without token', async () => {
      const res = await apiRequest('GET', '/v1/insights/rules');
      assert.equal(res.status, 401);
    });

    test('GET /v1/insights/mistakes: 401 without token', async () => {
      const res = await apiRequest('GET', '/v1/insights/mistakes');
      assert.equal(res.status, 401);
    });
  });

  // ============================================================================
  // 9. GATE ENDPOINT (/v1/gate/check)
  // ============================================================================
  test.describe('Gate Endpoint (/v1/gate/check)', () => {
    test('POST /v1/gate/check: 401 when X-Gate-Api-Key header is missing', async () => {
      const res = await apiRequest('POST', '/v1/gate/check', {
        body: { content: 'Check content', orgId: validOrgId },
      });
      assert.equal(res.status, 401);
    });

    test('POST /v1/gate/check: 403 when X-Gate-Api-Key is invalid or unrecognized', async () => {
      const res = await apiRequest('POST', '/v1/gate/check', {
        apiKey: 'unrecognized_revoked_key_99999',
        body: { content: 'Check content', orgId: validOrgId },
      });
      assert.equal(res.status, 403);
    });

    test('POST /v1/gate/check: 422 or 400 on missing or invalid payload', async () => {
      const res = await apiRequest('POST', '/v1/gate/check', {
        apiKey: validGateApiKey,
        body: { content: '' },
      });
      assert.ok([400, 422].includes(res.status), `Expected 400 or 422, got ${res.status}`);
    });
  });
});
