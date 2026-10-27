/**
 * auth.js — Authentication API routes.
 *
 * Implements:
 *   POST /v1/auth/login — Authenticate user credentials and issue signed JWT
 *   GET  /v1/auth/me    — Retrieve authenticated user profile
 *
 * Conforms to OpenAPI 3.1 specification for Auth endpoints.
 */

'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'brandguard-super-secret-jwt-key-2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * POST /v1/auth/login
 *
 * Request body: { email: string, password: string }
 *
 * Returns: { token: string, user: User }
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(422).json({
        success: false,
        error: 'Validation error: Field "email" is required.',
        code: 'VALIDATION_ERROR',
      });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(422).json({
        success: false,
        error: 'Validation error: Field "password" must be at least 8 characters long.',
        code: 'VALIDATION_ERROR',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).populate('orgId');

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
        code: 'INVALID_CREDENTIALS',
      });
    }

    if (!user.active) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Account is deactivated.',
        code: 'ACCOUNT_DEACTIVATED',
      });
    }

    if (user.orgId && user.orgId.active === false) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Organisation is inactive.',
        code: 'ORG_INACTIVE',
      });
    }

    // Update lastLoginAt
    user.lastLoginAt = new Date();
    await user.save();

    const orgIdStr = user.orgId?._id ? user.orgId._id.toString() : user.orgId?.toString();
    const token = jwt.sign(
      {
        sub: user._id.toString(),
        email: user.email,
        role: user.role,
        orgId: orgIdStr,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    const userObj = user.toObject();
    delete userObj.__v;

    return res.status(200).json({
      success: true,
      token,
      user: userObj,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/auth/me
 *
 * Returns current authenticated user profile.
 */
router.get('/me', authenticate, async (req, res) => {
  return res.status(200).json(req.user);
});

module.exports = router;
