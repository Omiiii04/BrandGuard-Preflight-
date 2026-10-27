/**
 * sourcesRoute.test.js — Integration tests for /v1/sources HTTP routes.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const JWT_SECRET = process.env.JWT_SECRET || 'brandguard-super-secret-jwt-key-change-me-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const Source = require('../src/models/Source');
const User = require('../src/models/User');
const minio = require('../src/utils/minio');
const mlOrchestrator = require('../src/services/mlOrchestrator');

describe('/v1/sources API Endpoints', () => {
  let server;
  let baseUrl;
  let testOrgId;
  let testUserId;
  let authToken;
  let indexCalls;
  let metadataCalls;

  // Stubs for MinIO & Mongo
  const originalUploadObject = minio.uploadObject;
  const originalGetPresignedUrl = minio.getPresignedUrl;
  const originalFindById = User.findById;
  const originalIndexSource = mlOrchestrator.indexSource;
  const originalUpdateSourceMetadata = mlOrchestrator.updateSourceMetadata;

  before(async () => {
    testOrgId = new mongoose.Types.ObjectId();
    testUserId = new mongoose.Types.ObjectId();
    indexCalls = [];
    metadataCalls = [];
    mlOrchestrator.indexSource = async (payload) => {
      indexCalls.push(payload);
      return { indexed: true, status: 'indexed', sourceId: String(payload.sourceId), orgId: String(payload.orgId), passageCount: 1 };
    };

    mlOrchestrator.updateSourceMetadata = async (payload) => {
      metadataCalls.push(payload);
      return { updated: true, sourceId: String(payload.sourceId), orgId: String(payload.orgId), passageCount: 1 };
    };

    // Generate valid JWT token
    authToken = jwt.sign(
      { sub: testUserId.toString(), email: 'admin@acme.com', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Stub User.findById to return our mock user and org
    User.findById = function (id) {
      return {
        populate: function () {
          return {
            select: function () {
              return {
                lean: async function () {
                  return {
                    _id: testUserId,
                    email: 'admin@acme.com',
                    name: 'Admin User',
                    role: 'admin',
                    active: true,
                    orgId: {
                      _id: testOrgId,
                      name: 'Acme Corp',
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

    // Stub minio upload and presigned URL
    minio.uploadObject = async function (objectName, data, size, mimeType) {
      return { etag: 'mock-etag-12345', versionId: null };
    };

    minio.getPresignedUrl = async function (objectName) {
      return `http://minio.local:9000/brandguard/${objectName}?token=mock-presigned`;
    };

    // Create an express app mounting the sources router
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const sourcesRouter = require('../src/routes/sources');
    app.use('/v1/sources', sourcesRouter);

    // Global error handler
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
    // Restore stubs
    minio.uploadObject = originalUploadObject;
    minio.getPresignedUrl = originalGetPresignedUrl;
    User.findById = originalFindById;
    mlOrchestrator.indexSource = originalIndexSource;
    mlOrchestrator.updateSourceMetadata = originalUpdateSourceMetadata;

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('Authentication enforcement', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await fetch(`${baseUrl}/v1/sources`);
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.match(data.error, /Authentication required/i);
    });

    it('returns 401 when invalid token is provided', async () => {
      const res = await fetch(`${baseUrl}/v1/sources`, {
        headers: { Authorization: 'Bearer invalid.token.string' },
      });
      assert.equal(res.status, 401);
    });
  });

  describe('POST /v1/sources (with uploadScan)', () => {
    it('rejects uploads without a file', async () => {
      const form = new FormData();
      form.append('type', 'guideline');

      const res = await fetch(`${baseUrl}/v1/sources`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: form,
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'MISSING_FILE');
    });

    it('rejects disallowed file types (.exe)', async () => {
      const form = new FormData();
      const fakeFile = new Blob(['malicious executable'], { type: 'application/x-msdownload' });
      form.append('file', fakeFile, 'virus.exe');
      form.append('type', 'guideline');

      const res = await fetch(`${baseUrl}/v1/sources`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: form,
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'INVALID_FILE_TYPE');
    });

    it('rejects files containing the EICAR test signature via AV scan stub', async () => {
      const form = new FormData();
      const eicarBlob = new Blob(
        ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'],
        { type: 'application/pdf' }
      );
      form.append('file', eicarBlob, 'infected.pdf');

      const res = await fetch(`${baseUrl}/v1/sources`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: form,
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'AV_SCAN_FAILED');
    });

    it('successfully uploads valid PDF, sends to MinIO, and persists Source', async () => {
      // Mock Source.prototype.save
      const originalSave = Source.prototype.save;
      Source.prototype.save = async function () {
        this._id = new mongoose.Types.ObjectId();
        return this;
      };

      try {
        const form = new FormData();
        const pdfBlob = new Blob(['%PDF-1.4 mock content of brand guide'], {
          type: 'application/pdf',
        });
        form.append('file', pdfBlob, 'brand_guidelines.pdf');
        form.append('type', 'guideline');
        form.append('ownerName', 'Jane Knowledge Owner');
        form.append('version', '2.5');
        form.append('effectiveDate', '2026-01-01');
        form.append('expiryDate', '2027-01-01');

        const res = await fetch(`${baseUrl}/v1/sources`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
          body: form,
        });

        assert.equal(res.status, 201);
        const data = await res.json();

        assert.ok(data._id);
        assert.equal(data.fileName, 'brand_guidelines.pdf');
        assert.equal(data.version, '2.5');
        assert.equal(data.ownerName, 'Jane Knowledge Owner');
        assert.equal(data.type, 'guideline');
        assert.equal(indexCalls.length, 1);
        assert.equal(indexCalls[0].fileName, 'brand_guidelines.pdf');
        assert.equal(indexCalls[0].content.toString(), '%PDF-1.4 mock content of brand guide');
        assert.ok(data.storageRef.startsWith(`sources/${testOrgId}`));
        assert.ok(data.downloadUrl);
      } finally {
        Source.prototype.save = originalSave;
      }
    });

    it('marks a source error when ML indexing fails after storage', async () => {
      const originalSave = Source.prototype.save;
      const originalIndexSource = mlOrchestrator.indexSource;
      const statuses = [];
      Source.prototype.save = async function () {
        this._id = this._id || new mongoose.Types.ObjectId();
        statuses.push(this.status);
        return this;
      };
      mlOrchestrator.indexSource = async () => {
        throw new Error('parser unavailable');
      };

      try {
        const form = new FormData();
        form.append('file', new Blob(['plain text'], { type: 'text/markdown' }), 'policy.md');
        const res = await fetch(`${baseUrl}/v1/sources`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
          body: form,
        });

        assert.equal(res.status, 502);
        const data = await res.json();
        assert.equal(data.code, 'INDEXING_FAILED');
        assert.deepEqual(statuses.slice(-2), ['processing', 'error']);
      } finally {
        Source.prototype.save = originalSave;
        mlOrchestrator.indexSource = originalIndexSource;
      }
    });
  });

  describe('GET /v1/sources and GET /v1/sources/:id', () => {
    it('GET /v1/sources returns paginated source list', async () => {
      const mockDoc = {
        _id: new mongoose.Types.ObjectId(),
        orgId: testOrgId,
        fileName: 'existing_source.docx',
        version: '1.0',
        ownerName: 'Admin User',
        type: 'guideline',
        status: 'ready',
        expiryDate: new Date('2027-06-30'),
      };

      const originalFind = Source.find;
      const originalCount = Source.countDocuments;

      Source.find = function () {
        return {
          sort: function () {
            return {
              skip: function () {
                return {
                  limit: function () {
                    return {
                      lean: async function () {
                        return [mockDoc];
                      },
                    };
                  },
                };
              },
            };
          },
        };
      };

      Source.countDocuments = async function () {
        return 1;
      };

      try {
        const res = await fetch(`${baseUrl}/v1/sources?page=1&limit=10`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.total, 1);
        assert.equal(json.data.length, 1);
        assert.equal(json.data[0].fileName, 'existing_source.docx');
      } finally {
        Source.find = originalFind;
        Source.countDocuments = originalCount;
      }
    });

    it('GET /v1/sources/:id returns 400 for invalid ObjectId format', async () => {
      const res = await fetch(`${baseUrl}/v1/sources/invalid-id`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'INVALID_ID');
    });

    it('GET /v1/sources/:id returns 404 when document is not found', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const originalFindOne = Source.findOne;

      Source.findOne = function () {
        return {
          lean: async function () {
            return null;
          },
        };
      };

      try {
        const res = await fetch(`${baseUrl}/v1/sources/${nonExistentId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        assert.equal(res.status, 404);
        const data = await res.json();
        assert.equal(data.code, 'NOT_FOUND');
      } finally {
        Source.findOne = originalFindOne;
      }
    });

    it('GET /v1/sources/:id returns source metadata and presigned downloadUrl', async () => {
      const testId = new mongoose.Types.ObjectId();
      const mockDoc = {
        _id: testId,
        orgId: testOrgId,
        fileName: 'found_guide.pdf',
        storageRef: `sources/${testOrgId}/found_guide.pdf`,
        version: '3.0',
        ownerName: 'Alice',
        type: 'guideline',
        status: 'active',
        expiryDate: new Date('2028-01-01'),
      };

      const originalFindOne = Source.findOne;
      Source.findOne = function () {
        return {
          lean: async function () {
            return { ...mockDoc };
          },
        };
      };

      try {
        const res = await fetch(`${baseUrl}/v1/sources/${testId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data._id, testId.toString());
        assert.equal(data.fileName, 'found_guide.pdf');
        assert.equal(data.version, '3.0');
        assert.ok(data.downloadUrl);
      } finally {
        Source.findOne = originalFindOne;
      }
    });
  });
});
