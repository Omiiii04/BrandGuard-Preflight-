/**
 * rbac.test.js — Unit and integration tests for RBAC middleware.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireRole, hasRole, normalizeRole, ROLE_HIERARCHY, ROLE_ALIASES } = require('../src/middleware/rbac');

describe('RBAC Middleware & Role Evaluation', () => {
  describe('normalizeRole()', () => {
    it('normalizes role strings to lowercase and trimmed underscores', () => {
      assert.equal(normalizeRole('Brand Manager'), 'brand_manager');
      assert.equal(normalizeRole('  AUTHORISED-REVIEWER  '), 'authorised_reviewer');
      assert.equal(normalizeRole('ADMIN'), 'admin');
      assert.equal(normalizeRole(null), '');
      assert.equal(normalizeRole(undefined), '');
    });
  });

  describe('hasRole()', () => {
    it('allows admin / knowledge_owner for any role check', () => {
      assert.equal(hasRole('admin', 'creator'), true);
      assert.equal(hasRole('knowledge_owner', 'brand_manager'), true);
      assert.equal(hasRole('admin', ['reviewer', 'viewer']), true);
    });

    it('matches exact roles correctly', () => {
      assert.equal(hasRole('creator', 'creator'), true);
      assert.equal(hasRole('viewer', 'viewer'), true);
      assert.equal(hasRole('reviewer', 'creator'), true); // reviewer (rank 2) satisfies creator (rank 1)
    });

    it('matches aliases correctly (brand_manager <-> manager)', () => {
      assert.equal(hasRole('manager', 'brand_manager'), true);
      assert.equal(hasRole('brand_manager', 'manager'), true);
      assert.equal(hasRole('editor', 'creator'), true);
      assert.equal(hasRole('creator', 'editor'), true);
      assert.equal(hasRole('authorised_reviewer', 'reviewer'), true);
    });

    it('denies access when user role has lower privilege rank', () => {
      assert.equal(hasRole('viewer', 'creator'), false);
      assert.equal(hasRole('creator', 'brand_manager'), false);
      assert.equal(hasRole('reviewer', 'brand_manager'), false);
      assert.equal(hasRole('viewer', 'admin'), false);
    });
  });

  describe('requireRole() middleware factory', () => {
    it('returns 401 when req.user is missing', () => {
      const middleware = requireRole('creator');
      const req = {};
      let statusCode = null;
      let jsonBody = null;

      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          jsonBody = data;
          return this;
        },
      };

      let nextCalled = false;
      middleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false);
      assert.equal(statusCode, 401);
      assert.equal(jsonBody.code, 'UNAUTHENTICATED');
    });

    it('returns 403 when req.user has no role', () => {
      const middleware = requireRole('brand_manager');
      const req = { user: { name: 'Anonymous' } };
      let statusCode = null;
      let jsonBody = null;

      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          jsonBody = data;
          return this;
        },
      };

      middleware(req, res, () => {});

      assert.equal(statusCode, 403);
      assert.equal(jsonBody.code, 'NO_ROLE_ASSIGNED');
    });

    it('returns 403 with requiredRoles when user has insufficient privileges', () => {
      const middleware = requireRole('brand_manager');
      const req = { user: { role: 'creator', email: 'creator@acme.com' } };
      let statusCode = null;
      let jsonBody = null;

      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          jsonBody = data;
          return this;
        },
      };

      middleware(req, res, () => {});

      assert.equal(statusCode, 403);
      assert.equal(jsonBody.code, 'ROLE_INSUFFICIENT');
      assert.deepEqual(jsonBody.requiredRoles, ['brand_manager']);
      assert.equal(jsonBody.userRole, 'creator');
    });

    it('calls next() when user role satisfies requirement', () => {
      const middleware = requireRole('creator');
      const req = { user: { role: 'creator', email: 'creator@acme.com' } };
      let nextCalled = false;

      const res = {
        status() {
          return this;
        },
        json() {
          return this;
        },
      };

      middleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true);
    });

    it('calls next() when admin role accesses role-gated endpoint', () => {
      const middleware = requireRole('brand_manager');
      const req = { user: { role: 'admin', email: 'admin@acme.com' } };
      let nextCalled = false;

      middleware(req, {}, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true);
    });

    it('supports multiple allowed roles (array or varargs)', () => {
      const middleware1 = requireRole('creator', 'brand_manager');
      const middleware2 = requireRole(['reviewer', 'admin']);

      let next1 = false;
      middleware1({ user: { role: 'creator' } }, {}, () => {
        next1 = true;
      });
      assert.equal(next1, true);

      let next2 = false;
      middleware2({ user: { role: 'reviewer' } }, {}, () => {
        next2 = true;
      });
      assert.equal(next2, true);
    });
  });
});
