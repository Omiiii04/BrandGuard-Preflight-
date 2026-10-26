/**
 * auth.js — JWT authentication middleware.
 *
 * Verifies the Bearer token from the Authorization header,
 * loads the matching User (with Org populated), and injects
 * `req.user` and `req.org` for downstream middleware / route handlers.
 *
 * Usage (single route):
 *   router.get('/protected', authenticate, handler);
 *
 * Usage (router-wide):
 *   router.use(authenticate);
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  // Crash loudly at startup rather than silently issuing unsigned tokens.
  throw new Error('[auth] JWT_SECRET environment variable is not set. Aborting.');
}

/**
 * Extracts the raw token string from the Authorization header.
 * Accepts both "Bearer <token>" and a bare token.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return header.trim() || null;
}

/**
 * authenticate — Express middleware.
 *
 * On success:
 *   req.user  = User document (Mongoose, with orgId populated as Org)
 *   req.org   = Org document (shortcut alias of req.user.orgId)
 *   req.token = decoded JWT payload
 *
 * On failure: responds with 401 JSON and calls next(err) to skip further handlers.
 */
async function authenticate(req, res, next) {
  const raw = extractToken(req);

  if (!raw) {
    return res.status(401).json({
      success: false,
      error:   'Authentication required. Provide a Bearer token.',
    });
  }

  let payload;
  try {
    payload = jwt.verify(raw, JWT_SECRET);
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError'
        ? 'Token has expired. Please sign in again.'
        : 'Invalid or malformed token.';
    return res.status(401).json({ success: false, error: message });
  }

  // payload.sub is the User's MongoDB _id (string), set when the token is issued.
  if (!payload.sub) {
    return res.status(401).json({ success: false, error: 'Token missing subject (sub).' });
  }

  let user;
  try {
    user = await User.findById(payload.sub)
      .populate('orgId')   // expands orgId → full Org document
      .select('-__v')
      .lean();             // plain JS object — faster, avoids accidental save()
  } catch (_dbErr) {
    return res.status(500).json({ success: false, error: 'Database error during authentication.' });
  }

  if (!user) {
    return res.status(401).json({ success: false, error: 'User not found.' });
  }

  if (!user.active) {
    return res.status(403).json({ success: false, error: 'Account is deactivated.' });
  }

  if (!user.orgId || !user.orgId.active) {
    return res.status(403).json({ success: false, error: 'Organisation is inactive.' });
  }

  // Attach principal data to the request.
  req.token = payload;
  req.user  = user;
  req.org   = user.orgId; // Org document (populated above)

  return next();
}

/**
 * requireRole — factory that returns an `authenticate`-dependent middleware
 * which enforces a minimum RBAC role.
 *
 * Role order (ascending privilege):
 *   viewer → reviewer → editor → admin
 *
 * Usage:
 *   router.delete('/asset/:id', authenticate, requireRole('admin'), handler);
 *
 * @param {...string} allowedRoles - One or more roles that may pass.
 * @returns {import('express').RequestHandler}
 */
const ROLE_RANK = { viewer: 0, reviewer: 1, editor: 2, admin: 3 };

function requireRole(...allowedRoles) {
  return function roleGuard(req, res, next) {
    if (!req.user) {
      // authenticate must run first.
      return res.status(401).json({ success: false, error: 'Not authenticated.' });
    }

    const userRank    = ROLE_RANK[req.user.role] ?? -1;
    const minRequired = Math.min(...allowedRoles.map((r) => ROLE_RANK[r] ?? Infinity));

    if (userRank < minRequired) {
      return res.status(403).json({
        success: false,
        error: `Insufficient privileges. Required: ${allowedRoles.join(' or ')}.`,
      });
    }

    return next();
  };
}

module.exports = { authenticate, requireRole, ROLE_RANK };
