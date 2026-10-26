/**
 * orgIsolation.js — Organisation isolation middleware.
 *
 * MUST be mounted AFTER `authenticate` so that `req.org` is populated.
 *
 * Purpose
 * ───────
 * Prevent cross-tenant data access by validating that any org-scoped
 * resource referenced in the request (via URL params, query strings, or
 * request body) belongs to the authenticated user's organisation.
 *
 * This middleware provides two exported helpers:
 *
 *   1. `enforceOrgScope`      — general-purpose guard that rejects requests
 *                               where an explicit `orgId` param/query/body
 *                               does not match `req.org._id`.
 *
 *   2. `injectOrgFilter`      — silently attaches `req.orgFilter` (a plain
 *                               `{ orgId }` object) for use in Mongoose
 *                               queries, ensuring routes never forget to
 *                               scope their DB calls.
 *
 * Usage examples
 * ──────────────
 * // Protect all routes in a router:
 * router.use(authenticate, enforceOrgScope);
 * router.use(authenticate, injectOrgFilter);
 *
 * // Single-route usage:
 * router.get('/drafts', authenticate, injectOrgFilter, async (req, res) => {
 *   const drafts = await Draft.find(req.orgFilter);
 *   res.json(drafts);
 * });
 *
 * // Combine both (recommended pattern):
 * router.use(authenticate, enforceOrgScope, injectOrgFilter);
 */

const mongoose = require('mongoose');

/**
 * Extracts an `orgId` value from the request (params → query → body),
 * returning `null` if none is present.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractRequestOrgId(req) {
  return (
    req.params?.orgId  ||
    req.query?.orgId   ||
    req.body?.orgId    ||
    null
  );
}

/**
 * enforceOrgScope
 * ───────────────
 * If the incoming request carries an explicit `orgId` (in params, query, or
 * body), it must match the authenticated user's org.  This prevents:
 *   • Privilege escalation via URL tampering
 *   • IDOR (Insecure Direct Object Reference) across organisations
 *
 * Requests without any `orgId` field pass through unchecked — the companion
 * `injectOrgFilter` middleware then ensures DB queries are always scoped.
 */
function enforceOrgScope(req, res, next) {
  if (!req.org) {
    // Guard: authenticate must run first.
    return res.status(401).json({
      success: false,
      error: 'Not authenticated. Mount authenticate before enforceOrgScope.',
    });
  }

  const requestedOrgId = extractRequestOrgId(req);

  if (!requestedOrgId) {
    // No explicit orgId in request — nothing to enforce here.
    return next();
  }

  // Normalise both sides to strings for comparison (handles ObjectId vs string).
  const userOrgId      = req.org._id.toString();
  const requestedIdStr = requestedOrgId.toString();

  // Validate that the provided value is even a valid ObjectId before comparing.
  if (!mongoose.Types.ObjectId.isValid(requestedIdStr)) {
    return res.status(400).json({
      success: false,
      error: `Invalid orgId format: "${requestedIdStr}".`,
    });
  }

  if (requestedIdStr !== userOrgId) {
    // Log the potential IDOR attempt (without leaking the real orgId).
    console.warn(
      `[orgIsolation] IDOR attempt: user ${req.user._id} (org ${userOrgId}) ` +
      `requested orgId ${requestedIdStr}. Request rejected.`
    );
    return res.status(403).json({
      success: false,
      error: 'Access denied. You may only access resources within your own organisation.',
    });
  }

  return next();
}

/**
 * injectOrgFilter
 * ───────────────
 * Attaches `req.orgFilter` and `req.orgId` for use in route handlers.
 *
 *   req.orgId     — MongoDB ObjectId of the authenticated user's org
 *   req.orgFilter — `{ orgId }` object, spread into Mongoose queries
 *
 * Example in a route handler:
 *   const findings = await Finding.find({ ...req.orgFilter, status: 'open' });
 */
function injectOrgFilter(req, res, next) {
  if (!req.org) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated. Mount authenticate before injectOrgFilter.',
    });
  }

  req.orgId     = req.org._id;
  req.orgFilter = { orgId: req.org._id };

  return next();
}

/**
 * orgIsolation — convenience composite middleware that runs both
 * `enforceOrgScope` and `injectOrgFilter` in sequence.
 *
 * Mount after `authenticate`:
 *   router.use(authenticate, orgIsolation);
 *
 * @type {import('express').RequestHandler[]}
 */
const orgIsolation = [enforceOrgScope, injectOrgFilter];

module.exports = { enforceOrgScope, injectOrgFilter, orgIsolation };
