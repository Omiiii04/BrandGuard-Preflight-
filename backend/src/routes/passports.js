/**
 * passports.js — Brand Passport retrieval routes.
 *
 * Implements:
 *   GET /v1/passports/:id — Retrieve Brand Passport by ID (append-only, tamper-evident record)
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

module.exports = router;
