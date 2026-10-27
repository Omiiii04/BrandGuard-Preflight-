/**
 * errorHandler.test.js — Unit and integration tests for errorHandler middleware.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler, notFoundHandler, AppError } = require('../src/middleware/errorHandler');

describe('errorHandler Middleware & AppError', () => {
  function createMockRes() {
    return {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
  }

  describe('AppError helper factories', () => {
    it('creates badRequest error (400)', () => {
      const err = AppError.badRequest('Upload scan failed', 'UPLOAD_SCAN_FAILED');
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'UPLOAD_SCAN_FAILED');
      assert.equal(err.message, 'Upload scan failed');
    });

    it('creates invalidJwt error (401)', () => {
      const err = AppError.invalidJwt();
      assert.equal(err.statusCode, 401);
      assert.equal(err.code, 'INVALID_TOKEN');
      assert.match(err.message, /Invalid or expired/);
    });

    it('creates forbiddenRole error (403)', () => {
      const err = AppError.forbiddenRole('Creator cannot approve drafts');
      assert.equal(err.statusCode, 403);
      assert.equal(err.code, 'ROLE_INSUFFICIENT');
      assert.equal(err.message, 'Creator cannot approve drafts');
    });

    it('creates notFound error (404)', () => {
      const err = AppError.notFound('Resource not found', 'NOT_FOUND');
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'NOT_FOUND');
    });

    it('creates draftNotFound error (404)', () => {
      const err = AppError.draftNotFound('draft-123');
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'DRAFT_NOT_FOUND');
      assert.match(err.message, /draft-123/);
      assert.equal(err.details.draftId, 'draft-123');
    });

    it('creates validationError (422) and schemaValidationFailure with details', () => {
      const details = { confidence: 'Must be float between 0 and 1' };
      const err1 = AppError.validationError('Schema validation failure', details);
      assert.equal(err1.statusCode, 422);
      assert.equal(err1.code, 'VALIDATION_ERROR');
      assert.deepEqual(err1.details, details);

      const err2 = AppError.schemaValidationFailure('Schema validation failed.', details);
      assert.equal(err2.statusCode, 422);
      assert.equal(err2.code, 'VALIDATION_ERROR');
      assert.deepEqual(err2.details, details);
    });

    it('creates timeout error (503) and mlTimeout', () => {
      const err1 = AppError.timeout('ML service timed out');
      assert.equal(err1.statusCode, 503);
      assert.equal(err1.code, 'ML_TIMEOUT');

      const err2 = AppError.mlTimeout('ML pipeline timeout');
      assert.equal(err2.statusCode, 503);
      assert.equal(err2.code, 'ML_TIMEOUT');
      assert.equal(err2.message, 'ML pipeline timeout');
    });

    it('creates uploadScanFailure error (400)', () => {
      const err = AppError.uploadScanFailure('AV scan rejected file', 'AV_SCAN_FAILED');
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'AV_SCAN_FAILED');
      assert.equal(err.message, 'AV scan rejected file');
    });
  });

  describe('errorHandler() response formatting for required error cases', () => {
    it('Case 1: formats invalid JWT as 401 with structured JSON and NO stack trace', () => {
      const res = createMockRes();
      const jwtErr = new Error('jwt malformed');
      jwtErr.name = 'JsonWebTokenError';
      jwtErr.stack = 'Error: jwt malformed\n    at ...';

      errorHandler(jwtErr, {}, res, () => {});

      assert.equal(res.statusCode, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'INVALID_TOKEN');
      assert.match(res.body.error, /malformed/i);
      assert.equal(res.body.stack, undefined);
      assert.equal(res.body.stackTrace, undefined);
    });

    it('Case 1b: formats expired JWT token as 401 TOKEN_EXPIRED with NO stack trace', () => {
      const res = createMockRes();
      const expiredErr = new Error('jwt expired');
      expiredErr.name = 'TokenExpiredError';
      expiredErr.stack = 'Error: jwt expired\n    at ...';

      errorHandler(expiredErr, {}, res, () => {});

      assert.equal(res.statusCode, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'TOKEN_EXPIRED');
      assert.match(res.body.error, /expired/i);
      assert.equal(res.body.stack, undefined);
    });

    it('Case 2: formats forbidden role as 403 with structured JSON and NO stack trace', () => {
      const res = createMockRes();
      const err = AppError.forbiddenRole('User role "creator" is insufficient for approval.');
      err.stack = 'Error: forbidden role\n    at ...';

      errorHandler(err, {}, res, () => {});

      assert.equal(res.statusCode, 403);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'ROLE_INSUFFICIENT');
      assert.equal(res.body.error, 'User role "creator" is insufficient for approval.');
      assert.equal(res.body.stack, undefined);
      assert.equal(res.body.stackTrace, undefined);
    });

    it('Case 3: formats draft not found as 404 with structured JSON and NO stack trace', () => {
      const res = createMockRes();
      const err = AppError.draftNotFound('507f1f77bcf86cd799439011');
      err.stack = 'Error: draft not found\n    at ...';

      errorHandler(err, {}, res, () => {});

      assert.equal(res.statusCode, 404);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'DRAFT_NOT_FOUND');
      assert.match(res.body.error, /507f1f77bcf86cd799439011/);
      assert.equal(res.body.stack, undefined);
    });

    it('Case 4: formats ML timeout as 503 ML_TIMEOUT with structured JSON and NO stack trace', () => {
      const res = createMockRes();
      const err = AppError.mlTimeout('ML service timed out after 30000ms.');
      err.stack = 'Error: timeout\n    at ...';

      errorHandler(err, {}, res, () => {});

      assert.equal(res.statusCode, 503);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'ML_TIMEOUT');
      assert.match(res.body.error, /timed out/i);
      assert.equal(res.body.stack, undefined);
    });

    it('Case 5: formats schema validation failure as 422 with structured JSON, field details, and NO stack trace', () => {
      const res = createMockRes();
      const err = {
        name: 'ValidationError',
        stack: 'ValidationError: Draft validation failed\n    at ...',
        errors: {
          title: { message: 'Title is required' },
          targetAudience: { message: 'targetAudience must be specified' },
        },
      };

      errorHandler(err, {}, res, () => {});

      assert.equal(res.statusCode, 422);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'VALIDATION_ERROR');
      assert.equal(res.body.error, 'Schema validation failed.');
      assert.equal(res.body.details.title, 'Title is required');
      assert.equal(res.body.details.targetAudience, 'targetAudience must be specified');
      assert.equal(res.body.stack, undefined);
      assert.equal(res.body.details.stack, undefined);
    });

    it('Case 6: formats upload scan failure (AV scan, file type, file size) as 400 with NO stack trace', () => {
      const res1 = createMockRes();
      const avErr = AppError.uploadScanFailure('EICAR test malware signature detected.', 'AV_SCAN_FAILED');
      avErr.stack = 'Error: AV scan failed\n    at ...';
      errorHandler(avErr, {}, res1, () => {});

      assert.equal(res1.statusCode, 400);
      assert.equal(res1.body.success, false);
      assert.equal(res1.body.code, 'AV_SCAN_FAILED');
      assert.match(res1.body.error, /EICAR/);
      assert.equal(res1.body.stack, undefined);

      const res2 = createMockRes();
      const typeErr = AppError.uploadScanFailure('File type ".exe" is not permitted.', 'INVALID_FILE_TYPE');
      errorHandler(typeErr, {}, res2, () => {});

      assert.equal(res2.statusCode, 400);
      assert.equal(res2.body.code, 'INVALID_FILE_TYPE');
      assert.equal(res2.body.stack, undefined);

      const res3 = createMockRes();
      const multerErr = { name: 'MulterError', code: 'LIMIT_FILE_SIZE', stack: 'MulterError: ...' };
      errorHandler(multerErr, {}, res3, () => {});

      assert.equal(res3.statusCode, 400);
      assert.equal(res3.body.code, 'FILE_TOO_LARGE');
      assert.equal(res3.body.stack, undefined);
    });

    it('Strictly guarantees NO stack traces are exposed even when details contains stack', () => {
      const res = createMockRes();
      const err = new Error('General operational error');
      err.statusCode = 400;
      err.code = 'BAD_REQUEST';
      err.stack = 'Secret Internal Stack Trace: at Line 42';
      err.details = {
        field: 'invalid',
        stack: 'Sensitive internal stack leak in details',
        stackTrace: 'More internal details',
      };

      errorHandler(err, {}, res, () => {});

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.stack, undefined);
      assert.equal(res.body.stackTrace, undefined);
      assert.equal(res.body.details.field, 'invalid');
      assert.equal(res.body.details.stack, undefined);
      assert.equal(res.body.details.stackTrace, undefined);
    });
  });

  describe('notFoundHandler()', () => {
    it('returns 404 with structured JSON error', () => {
      const res = createMockRes();
      notFoundHandler({ method: 'GET', originalUrl: '/v1/nonexistent' }, res, () => {});

      assert.equal(res.statusCode, 404);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'NOT_FOUND');
      assert.match(res.body.error, /\/v1\/nonexistent/);
    });
  });
});
