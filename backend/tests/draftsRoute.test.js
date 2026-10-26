/**
 * draftsRoute.test.js — Integration tests for /v1/drafts HTTP routes.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const JWT_SECRET = process.env.JWT_SECRET || 'brandguard-super-secret-jwt-key-change-me-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const Draft = require('../src/models/Draft');
const DraftVersion = require('../src/models/DraftVersion');
const AuditLog = require('../src/models/AuditLog');
const User = require('../src/models/User');
const minio = require('../src/utils/minio');

describe('/v1/drafts API Endpoints', () => {
  let server;
  let baseUrl;
  let testOrgId;
  let testUserId;
  let authToken;

  const originalUploadObject = minio.uploadObject;
  const originalGetPresignedUrl = minio.getPresignedUrl;
  const originalUserFindById = User.findById;

  let uploadedMinioFiles = [];
  let savedDrafts = [];
  let savedDraftVersions = [];
  let loggedAuditEvents = [];

  before(async () => {
    testOrgId = new mongoose.Types.ObjectId();
    testUserId = new mongoose.Types.ObjectId();

    authToken = jwt.sign(
      { sub: testUserId.toString(), email: 'creator@acme.com', role: 'creator' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Mock User.findById
    User.findById = function (id) {
      return {
        populate: function () {
          return {
            select: function () {
              return {
                lean: async function () {
                  return {
                    _id: testUserId,
                    email: 'creator@acme.com',
                    name: 'Creator User',
                    role: 'creator',
                    active: true,
                    orgId: {
                      _id: testOrgId,
                      name: 'Acme Corp',
                      active: true,
                      watchlist: ['Project Nova', 'Acme Ultra'],
                    },
                  };
                },
              };
            },
          };
        },
      };
    };

    // Mock MinIO functions
    minio.uploadObject = async function (objectName, data, size, mimeType) {
      uploadedMinioFiles.push({ objectName, size, mimeType });
      return { etag: 'mock-draft-etag-999', versionId: null };
    };

    minio.getPresignedUrl = async function (objectName) {
      return `http://minio.local:9000/brandguard/${objectName}?token=mock-presigned-url`;
    };

    // Create an Express app mounting draftsRouter
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const draftsRouter = require('../src/routes/drafts');
    app.use('/v1/drafts', draftsRouter);

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
    minio.uploadObject = originalUploadObject;
    minio.getPresignedUrl = originalGetPresignedUrl;
    User.findById = originalUserFindById;

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('Authentication enforcement', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await fetch(`${baseUrl}/v1/drafts`);
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.match(data.error, /Authentication required/i);
    });

    it('returns 401 when token is invalid', async () => {
      const res = await fetch(`${baseUrl}/v1/drafts`, {
        headers: { Authorization: 'Bearer bad.token.here' },
      });
      assert.equal(res.status, 401);
    });
  });

  describe('POST /v1/drafts (Multipart submission with file + intent JSON)', () => {
    it('successfully accepts multipart file + intent JSON, creates Draft and DraftVersion with SHA-256 contentHash, writes AuditLog', async () => {
      const originalDraftSave = Draft.prototype.save;
      const originalVersionSave = DraftVersion.prototype.save;
      const originalAuditSave = AuditLog.prototype.save;

      Draft.prototype.save = async function () {
        this._id = new mongoose.Types.ObjectId();
        savedDrafts.push(this);
        return this;
      };

      DraftVersion.prototype.save = async function () {
        this._id = new mongoose.Types.ObjectId();
        savedDraftVersions.push(this);
        return this;
      };

      AuditLog.prototype.save = async function () {
        this._id = new mongoose.Types.ObjectId();
        loggedAuditEvents.push(this);
        return this;
      };

      try {
        const form = new FormData();
        const fakeDocx = new Blob(['Mock docx binary payload content for BrandGuard draft'], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        form.append('file', fakeDocx, 'winter_campaign.docx');

        const intentJson = JSON.stringify({
          purpose: 'Promote upcoming winter promotional bundle',
          audience: 'Existing UK customers aged 25-45',
          mustSay: ['free returns', '14-day warranty'],
        });
        form.append('intent', intentJson);
        form.append('title', 'Winter Campaign 2026');

        const res = await fetch(`${baseUrl}/v1/drafts`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
          body: form,
        });

        assert.equal(res.status, 201);
        const data = await res.json();

        // 1. Verify Draft fields
        assert.ok(data._id);
        assert.equal(data.format, 'docx');
        assert.equal(data.status, 'draft');
        assert.equal(data.title, 'Winter Campaign 2026');
        assert.equal(data.fileName, 'winter_campaign.docx');
        assert.equal(data.currentVersion, 1);
        assert.equal(data.intent.purpose, 'Promote upcoming winter promotional bundle');
        assert.deepEqual(data.intent.mustSay, ['free returns', '14-day warranty']);

        // 2. Verify SHA-256 contentHash
        assert.ok(data.contentHash);
        assert.equal(data.contentHash.length, 64);
        assert.match(data.contentHash, /^[a-f0-9]{64}$/);

        // 3. Verify DraftVersion creation
        assert.ok(data.version);
        assert.equal(data.version.versionNumber, 1);
        assert.equal(data.version.contentHash, data.contentHash);

        // 4. Verify MinIO upload
        const uploaded = uploadedMinioFiles.find((f) => f.objectName.includes('winter_campaign.docx'));
        assert.ok(uploaded);

        // 5. Verify AuditLog event: 'draft_submitted'
        const auditEvent = loggedAuditEvents.find(
          (e) => e.eventType === 'draft_submitted' && e.entityType === 'draft'
        );
        assert.ok(auditEvent);
        assert.equal(auditEvent.metadata.versionNumber, 1);
        assert.equal(auditEvent.metadata.contentHash, data.contentHash);
        assert.equal(auditEvent.metadata.hasFile, true);
        assert.equal(auditEvent.metadata.fileName, 'winter_campaign.docx');
      } finally {
        Draft.prototype.save = originalDraftSave;
        DraftVersion.prototype.save = originalVersionSave;
        AuditLog.prototype.save = originalAuditSave;
      }
    });

    it('accepts text draft and applies redactionGateway against org watchlist terms', async () => {
      const originalDraftSave = Draft.prototype.save;
      const originalVersionSave = DraftVersion.prototype.save;
      const originalAuditSave = AuditLog.prototype.save;

      Draft.prototype.save = async function () {
        this._id = new mongoose.Types.ObjectId();
        return this;
      };
      DraftVersion.prototype.save = async function () {
        this._id = new mongoose.Types.ObjectId();
        return this;
      };
      AuditLog.prototype.save = async function () {
        this._id = new mongoose.Types.ObjectId();
        loggedAuditEvents.push(this);
        return this;
      };

      try {
        const rawContent = 'Get ready for Project Nova and our revolutionary Acme Ultra experience!';
        const payload = {
          content: rawContent,
          intent: {
            purpose: 'Product launch teasers',
            audience: 'Global retail partners',
            mustSay: ['confidential preview', 'embargoed until December'],
          },
        };

        const res = await fetch(`${baseUrl}/v1/drafts`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        assert.equal(res.status, 201);
        const data = await res.json();

        // Check that Draft was created
        assert.ok(data._id);
        assert.equal(data.format, 'text');
        assert.equal(data.status, 'draft');

        // Check SHA-256 contentHash
        assert.ok(data.contentHash);
        assert.equal(data.contentHash.length, 64);

        // Check Redaction Gateway output in response
        assert.equal(
          data.redactedContent,
          'Get ready for [REDACTED] and our revolutionary [REDACTED] experience!'
        );
        assert.ok(data.redactions.length >= 2);
        const terms = data.redactions.map((r) => r.term);
        assert.ok(terms.includes('Project Nova'));
        assert.ok(terms.includes('Acme Ultra'));

        // Check AuditLog write
        const lastAudit = loggedAuditEvents[loggedAuditEvents.length - 1];
        assert.equal(lastAudit.eventType, 'draft_submitted');
        assert.equal(lastAudit.metadata.redactionsCount, 2);
      } finally {
        Draft.prototype.save = originalDraftSave;
        DraftVersion.prototype.save = originalVersionSave;
        AuditLog.prototype.save = originalAuditSave;
      }
    });

    it('rejects submission with missing intent fields (400 INVALID_INTENT)', async () => {
      const res = await fetch(`${baseUrl}/v1/drafts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'Some draft copy',
          intent: {
            purpose: '', // Empty purpose
            audience: 'UK shoppers',
          },
        }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'INVALID_INTENT');
    });

    it('rejects submission when neither file nor content is provided (400 MISSING_CONTENT)', async () => {
      const res = await fetch(`${baseUrl}/v1/drafts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: {
            purpose: 'General broadcast',
            audience: 'Subscribers',
            mustSay: ['Terms apply'],
          },
        }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'MISSING_CONTENT');
    });

    it('rejects disallowed file extensions (.exe)', async () => {
      const form = new FormData();
      const fakeFile = new Blob(['binary'], { type: 'application/octet-stream' });
      form.append('file', fakeFile, 'malware.exe');
      form.append('intent', JSON.stringify({
        purpose: 'Test',
        audience: 'Test',
        mustSay: ['Test'],
      }));

      const res = await fetch(`${baseUrl}/v1/drafts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: form,
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'INVALID_FILE_TYPE');
    });

    it('rejects file containing the EICAR test signature via AV scan stub', async () => {
      const form = new FormData();
      const eicarBlob = new Blob(
        ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'],
        { type: 'application/pdf' }
      );
      form.append('file', eicarBlob, 'infected_draft.pdf');
      form.append('intent', JSON.stringify({
        purpose: 'Security check',
        audience: 'QA team',
        mustSay: ['Pass'],
      }));

      const res = await fetch(`${baseUrl}/v1/drafts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: form,
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'AV_SCAN_FAILED');
    });
  });

  describe('GET /v1/drafts and GET /v1/drafts/:id', () => {
    it('GET /v1/drafts returns paginated drafts list', async () => {
      const originalFind = Draft.find;
      const originalCount = Draft.countDocuments;

      const mockDraft = {
        _id: new mongoose.Types.ObjectId(),
        orgId: testOrgId,
        title: 'Mock Draft Item',
        status: 'draft',
        format: 'text',
      };

      Draft.find = function () {
        return {
          sort: function () {
            return {
              skip: function () {
                return {
                  limit: function () {
                    return {
                      lean: async function () {
                        return [mockDraft];
                      },
                    };
                  },
                };
              },
            };
          },
        };
      };

      Draft.countDocuments = async function () {
        return 1;
      };

      try {
        const res = await fetch(`${baseUrl}/v1/drafts`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data.data));
        assert.equal(data.data.length, 1);
        assert.equal(data.data[0].title, 'Mock Draft Item');
        assert.equal(data.pagination.total, 1);
      } finally {
        Draft.find = originalFind;
        Draft.countDocuments = originalCount;
      }
    });

    it('GET /v1/drafts/:id returns 400 for invalid ObjectId format', async () => {
      const res = await fetch(`${baseUrl}/v1/drafts/invalid-id`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'INVALID_ID');
    });

    it('GET /v1/drafts/:id returns 404 when draft does not exist', async () => {
      const originalFindOne = Draft.findOne;
      Draft.findOne = function () {
        return {
          lean: async function () {
            return null;
          },
        };
      };

      try {
        const nonExistentId = new mongoose.Types.ObjectId();
        const res = await fetch(`${baseUrl}/v1/drafts/${nonExistentId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        assert.equal(res.status, 404);
        const data = await res.json();
        assert.equal(data.code, 'NOT_FOUND');
      } finally {
        Draft.findOne = originalFindOne;
      }
    });

    it('GET /v1/drafts/:id returns draft metadata and latest version', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const mockDraft = {
        _id: draftId,
        orgId: testOrgId,
        title: 'Spring Lookbook',
        status: 'draft',
        format: 'pdf',
      };

      const mockVersion = {
        _id: new mongoose.Types.ObjectId(),
        draftId,
        orgId: testOrgId,
        versionNumber: 1,
        contentHash: 'a'.repeat(64),
      };

      const originalDraftFindOne = Draft.findOne;
      const originalVersionFindOne = DraftVersion.findOne;

      Draft.findOne = function () {
        return {
          lean: async function () {
            return { ...mockDraft };
          },
        };
      };

      DraftVersion.findOne = function () {
        return {
          sort: function () {
            return {
              lean: async function () {
                return mockVersion;
              },
            };
          },
        };
      };

      try {
        const res = await fetch(`${baseUrl}/v1/drafts/${draftId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.title, 'Spring Lookbook');
        assert.equal(data.latestVersion.contentHash, 'a'.repeat(64));
      } finally {
        Draft.findOne = originalDraftFindOne;
        DraftVersion.findOne = originalVersionFindOne;
      }
    });

    it('GET /v1/drafts/:id/versions returns version history', async () => {
      const draftId = new mongoose.Types.ObjectId();
      const mockDraft = {
        _id: draftId,
        orgId: testOrgId,
      };

      const mockVersions = [
        {
          _id: new mongoose.Types.ObjectId(),
          draftId,
          versionNumber: 1,
          contentHash: '1'.repeat(64),
        },
        {
          _id: new mongoose.Types.ObjectId(),
          draftId,
          versionNumber: 2,
          contentHash: '2'.repeat(64),
        },
      ];

      const originalDraftFindOne = Draft.findOne;
      const originalVersionFind = DraftVersion.find;

      Draft.findOne = function () {
        return {
          lean: async function () {
            return mockDraft;
          },
        };
      };

      DraftVersion.find = function () {
        return {
          sort: function () {
            return {
              lean: async function () {
                return mockVersions;
              },
            };
          },
        };
      };

      try {
        const res = await fetch(`${baseUrl}/v1/drafts/${draftId}/versions`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data.data));
        assert.equal(data.data.length, 2);
        assert.equal(data.data[0].versionNumber, 1);
        assert.equal(data.data[1].versionNumber, 2);
      } finally {
        Draft.findOne = originalDraftFindOne;
        DraftVersion.find = originalVersionFind;
      }
    });
  });
});
