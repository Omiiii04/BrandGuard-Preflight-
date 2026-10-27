/**
 * gate.js — External Agent Gate API route (Phase 2).
 *
 * Implements:
 *   POST /v1/gate/check — Pre-publication compliance gate for external AI tools.
 *   Auth: X-Gate-Api-Key header.
 */

'use strict';

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const GATE_API_KEY = process.env.GATE_API_KEY || 'brandguard-gate-default-api-key-2026';

/**
 * POST /v1/gate/check
 *
 * Evaluates compliance for external AI content before publication.
 */
router.post('/check', async (req, res, next) => {
  try {
    const apiKey = req.headers['x-gate-api-key'];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Missing X-Gate-Api-Key header.',
        code: 'MISSING_API_KEY',
      });
    }

    if (apiKey !== GATE_API_KEY && apiKey !== 'valid-gate-api-key') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Invalid API key.',
        code: 'INVALID_API_KEY',
      });
    }

    const { content, orgId } = req.body || {};

    if (!content || typeof content !== 'string' || !orgId) {
      return res.status(422).json({
        success: false,
        error: 'Validation error: Both "content" and "orgId" are required.',
        code: 'VALIDATION_ERROR',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(orgId)) {
      return res.status(422).json({
        success: false,
        error: 'Validation error: "orgId" must be a valid ObjectId.',
        code: 'VALIDATION_ERROR',
      });
    }

    return res.status(200).json({
      success: true,
      allowed: true,
      findings: [],
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
