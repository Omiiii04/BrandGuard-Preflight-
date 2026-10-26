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

    it('creates notFound error (404)', () => {
      const err = AppError.notFound('Draft not found', 'DRAFT_NOT_FOUND');
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'DRAFT_NOT_FOUND');
    });

    it('creates validationError (422) with details', () => {
      const details = { confidence: 'Must be float between 0 and 1' };
      const err = AppError.validationError('Schema validation failure', details);
      assert.equal(err.statusCode, 422);
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.deepEqual(err.details, details);
    });

    it('creates timeout error (503)', () => {
      const err = AppError.timeout('ML service timed out');
      assert.equal(err.statusCode, 503);
      assert.equal(err.code, 'ML_TIMEOUT');
    });
  });

  describe('errorHandler() response formatting', () => {
    it('formats AppError without stack trace in JSON response', () => {
      const res = createMockRes();
      const err = AppError.forbidden('Forbidden role', 'ROLE_INSUFFICIENT');

      errorHandler(err, {}, res, () => {});

      assert.equal(res.statusCode, 403);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error, 'Forbidden role');
      assert.equal(res.body.code, 'ROLE_INSUFFICIENT');
      assert.equal(res.body.stack, undefined);
    });

    it('formats Mongoose ValidationError as 422 with details', () => {
      const res = createMockRes();
      const err = {
        name: 'ValidationError',
        errors: {
          type: { message: 'Type is required' },
          version: { message: 'Version format invalid' },
        },
      };

      errorHandler(err, {}, res, () => {});

      assert.equal(res.statusCode, 422);
      assert.equal(res.body.code, 'VALIDATION_ERROR');
      assert.equal(res.body.details.type, 'Type is required');
      assert.equal(res.body.details.version, 'Version format invalid');
      assert.equal(res.body.stack, undefined);
    });

    it('formats Mongoose CastError (ObjectId) as 400 INVALID_ID', () => {
      const res = createMockRes();
      const err = {
        name: 'CastError',
        kind: 'ObjectId',
        path: 'draftId',
        value: '123invalid',
      };

      errorHandler(err, {}, res, () => {});

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.code, 'INVALID_ID');
      assert.match(res.body.error, /draftId/);
      assert.equal(res.body.stack, undefined);
    });

    it('formats JWT errors (JsonWebTokenError & TokenExpiredError) as 401', () => {
      const res1 = createMockRes();
      errorHandler({ name: 'JsonWebTokenError' }, {}, res1, () => {});
      assert.equal(res1.statusCode, 401);
      assert.equal(res1.body.code, 'INVALID_TOKEN');

      const res2 = createMockRes();
      errorHandler({ name: 'TokenExpiredError' }, {}, res2, () => {});
      assert.equal(res2.statusCode, 401);
      assert.equal(res2.body.code, 'TOKEN_EXPIRED');
    });

    it('formats Multer LIMIT_FILE_SIZE error as 400 FILE_TOO_LARGE', () => {
      const res = createMockRes();
      const err = { name: 'MulterError', code: 'LIMIT_FILE_SIZE' };

      errorHandler(err, {}, res, () => {});

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.code, 'FILE_TOO_LARGE');
    });

    it('formats ML service connection failure / timeout as 503 ML_TIMEOUT', () => {
      const res = createMockRes();
      const err = { code: 'ML_TIMEOUT', message: 'ML service timeout after 10000ms' };

      errorHandler(err, {}, res, () => {});

      assert.equal(res.statusCode, 503);
      assert.equal(res.body.code, 'ML_TIMEOUT');
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
