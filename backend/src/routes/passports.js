/**
 * passports.js — Brand Passport API routes.
 *
 * Implements FR-AP-01, FR-AP-02, SDD Section 2.10 & Section 3:
 *   - GET /v1/passports/:id — Retrieve Brand Passport by ID (append-only, tamper-evident record)
 *   - GET /v1/passports     — List Brand Passports for organisation (optional ?draftId= filter)
 *   - Strictly append-only: No PATCH, PUT, or DELETE routes (returns 405 Method Not Allowed)
 */

'use strict';

const express = require('express');
const mongoose = require('mongoose');

const Passport = require('../models/Passport');
const { authenticate } = require('../middleware/auth');
const { orgIsolation } = require('../middleware/orgIsolation');

const router = express.Router();

router.use(authenticate, orgIsolation);

/**
 * GET /v1/passports/:id
 *
 * Retrieves an immutable Brand Passport by its ObjectId.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId = req.org?._id || req.orgId;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: `Invalid passport ID "${id}".`,
        code: 'INVALID_ID',
      });
    }

    const passport = await Passport.findOne({ _id: id, orgId })
      .populate('approvers', 'name email role')
      .lean();

    if (!passport) {
      return res.status(404).json({
        success: false,
        error: `Brand Passport "${id}" was not found in your organisation.`,
        code: 'NOT_FOUND',
      });
    }

    return res.json(passport);
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/passports
 *
 * Retrieves list of Brand Passports belonging to the tenant organisation.
 * Supports optional `draftId` query filter.
 */
router.get('/', async (req, res, next) => {
  try {
    const orgId = req.org?._id || req.orgId;
    const filter = { orgId };

    if (req.query.draftId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.draftId)) {
        return res.status(400).json({
          success: false,
          error: `Invalid draft ID "${req.query.draftId}".`,
          code: 'INVALID_ID',
        });
      }
      filter.draftId = req.query.draftId;
    }

    const passports = await Passport.find(filter)
      .populate('approvers', 'name email role')
      .sort({ timestamp: -1 })
      .lean();

    return res.json({
      success: true,
      count: passports.length,
      passports,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Append-only enforcement:
 * Passports are permanent cryptographic audit records.
 * Modifications and deletions are strictly prohibited (no PATCH or DELETE routes).
 */
const methodNotAllowed = (req, res) => {
  return res.status(405).json({
    success: false,
    error: `Method ${req.method} is not allowed on /v1/passports. Brand Passports are append-only cryptographic records and cannot be modified or deleted.`,
    code: 'METHOD_NOT_ALLOWED',
  });
};

router.patch('/:id?', methodNotAllowed);
router.delete('/:id?', methodNotAllowed);
router.put('/:id?', methodNotAllowed);

module.exports = router;
