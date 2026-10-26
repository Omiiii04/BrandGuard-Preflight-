/**
 * rbac.js — Role-Based Access Control (RBAC) middleware.
 *
 * Implements the requireRole factory middleware to enforce role permissions
 * across BrandGuard Preflight API endpoints.
 *
 * Supported Roles (per SRS FR-WF-01 & Architectural Blueprint):
 *   - admin / knowledge_owner : Full system and organisation privileges
 *   - brand_manager / manager : Review and approval authority, change requests
 *   - reviewer / authorised_reviewer : Expert review of risky topics & rulings
 *   - creator / editor : Content draft authoring, source management
 *   - viewer : Read-only observer access
 */

/**
 * Role hierarchy levels (higher number = greater privilege).
 */
const ROLE_HIERARCHY = {
  viewer: 0,
  creator: 1,
  editor: 1,
  reviewer: 2,
  authorised_reviewer: 2,
  authorized_reviewer: 2,
  brand_manager: 3,
  manager: 3,
  knowledge_owner: 4,
  admin: 4,
  owner: 4,
  superadmin: 4,
};

/**
 * Role aliases mapping canonical keys to equivalent synonyms.
 */
const ROLE_ALIASES = {
  admin: ['admin', 'knowledge_owner', 'owner', 'superadmin'],
  knowledge_owner: ['admin', 'knowledge_owner', 'owner', 'superadmin'],
  brand_manager: ['brand_manager', 'manager'],
  manager: ['brand_manager', 'manager'],
  reviewer: ['reviewer', 'authorised_reviewer', 'authorized_reviewer'],
  authorised_reviewer: ['reviewer', 'authorised_reviewer', 'authorized_reviewer'],
  creator: ['creator', 'editor', 'author'],
  editor: ['creator', 'editor', 'author'],
  viewer: ['viewer', 'guest', 'read_only'],
};

/**
 * Normalize role string to lowercase, trimmed, underscored identifier.
 *
 * @param {string} role
 * @returns {string}
 */
function normalizeRole(role) {
  if (!role || typeof role !== 'string') return '';
  return role.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Checks whether a given user role satisfies the required role or roles.
 * Supports exact matching, alias matching, and hierarchical escalation (admins satisfy all).
 *
 * @param {string} userRole - Current role of the user
 * @param {string|string[]} requiredRoles - Allowed role(s)
 * @returns {boolean}
 */
function hasRole(userRole, requiredRoles) {
  const normUserRole = normalizeRole(userRole);
  if (!normUserRole) return false;

  // Admins and Knowledge Owners have global access to all endpoints
  if (normUserRole === 'admin' || normUserRole === 'knowledge_owner' || normUserRole === 'owner') {
    return true;
  }

  const allowedList = Array.isArray(requiredRoles)
    ? requiredRoles.map(normalizeRole)
    : [normalizeRole(requiredRoles)];

  if (allowedList.length === 0) return true;

  // Direct match
  if (allowedList.includes(normUserRole)) {
    return true;
  }

  // Alias expansion match
  for (const allowed of allowedList) {
    const aliases = ROLE_ALIASES[allowed] || [allowed];
    if (aliases.includes(normUserRole)) {
      return true;
    }
  }

  // Hierarchical fallback: if user's hierarchy rank >= minimum required role rank
  const userRank = ROLE_HIERARCHY[normUserRole];
  if (userRank !== undefined) {
    const minRequiredRank = Math.min(
      ...allowedList.map((r) => ROLE_HIERARCHY[r] ?? Infinity)
    );
    if (minRequiredRank !== Infinity && userRank >= minRequiredRank) {
      return true;
    }
  }

  return false;
}

/**
 * requireRole — Express middleware factory.
 *
 * Enforces that `req.user` has one of the allowed roles (or sufficient rank).
 * If `req.user` is not set, returns 401 Unauthorized.
 * If the role is insufficient, returns 403 Forbidden with structured JSON error.
 *
 * Usage:
 *   router.post('/approve', authenticate, requireRole('brand_manager'), handler);
 *   router.post('/sources', authenticate, requireRole('admin', 'editor'), handler);
 *   router.get('/audit', authenticate, requireRole(['admin']), handler);
 *
 * @param {...(string|string[])} roles - One or more allowed roles or arrays of roles.
 * @returns {import('express').RequestHandler}
 */
function requireRole(...roles) {
  // Flatten arguments to support both ('admin', 'manager') and (['admin', 'manager'])
  const allowedRoles = roles.flat().filter(Boolean);

  return function rbacMiddleware(req, res, next) {
    const user = req.user;

    // Authentication must run before role evaluation
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. No user context found.',
        code: 'UNAUTHENTICATED',
      });
    }

    const userRole = user.role || req.token?.role;

    if (!userRole) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: User has no assigned role.',
        code: 'NO_ROLE_ASSIGNED',
      });
    }

    if (allowedRoles.length > 0 && !hasRole(userRole, allowedRoles)) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: Insufficient privileges. Required role: ${allowedRoles.join(' or ')}.`,
        code: 'ROLE_INSUFFICIENT',
        requiredRoles: allowedRoles,
        userRole,
      });
    }

    return next();
  };
}

module.exports = {
  requireRole,
  hasRole,
  normalizeRole,
  ROLE_HIERARCHY,
  ROLE_ALIASES,
};
