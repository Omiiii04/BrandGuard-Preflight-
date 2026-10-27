/**
 * orgs.js — Organisation and settings management API routes.
 *
 * Exposes:
 *   GET   /v1/orgs/settings  — Retrieve organisation settings (e.g., rules_only, allowExternalModel)
 *   PATCH /v1/orgs/settings  — Update organisation settings (e.g., toggle rules_only mode)
 */

'use strict';

const express = require('express');
const Org = require('../models/Org');
const { authenticate } = require('../middleware/auth');
const { orgIsolation } = require('../middleware/orgIsolation');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

router.use(authenticate, orgIsolation);

/**
 * GET /v1/orgs/settings
 *
 * Retrieves current settings for the authenticated organisation.
 */
router.get('/settings', async (req, res, next) => {
  try {
    const orgId = req.org?._id || req.orgId;
    const org = await Org.findById(orgId).select('name slug settings watchlist active').lean();

    if (!org) {
      return res.status(404).json({
        success: false,
        error: 'Organisation not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        orgId: org._id,
        name: org.name,
        slug: org.slug,
        settings: {
          rules_only: Boolean(org.settings?.rules_only),
          allowExternalModel: Boolean(org.settings?.allowExternalModel),
          shelfLifeWarnDays: org.settings?.shelfLifeWarnDays ?? 30,
          maxUploadBytes: org.settings?.maxUploadBytes ?? 10485760,
        },
        watchlist: org.watchlist || [],
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * PATCH /v1/orgs/settings
 *
 * Updates organisation settings (e.g. toggling rules_only).
 * Requires manager or admin role.
 */
router.patch('/settings', requireRole('manager'), async (req, res, next) => {
  try {
    const orgId = req.org?._id || req.orgId;
    const { rules_only, allowExternalModel, shelfLifeWarnDays, maxUploadBytes, watchlist } = req.body;

    const updateFields = {};
    if (rules_only !== undefined) {
      updateFields['settings.rules_only'] = Boolean(rules_only);
    }
    if (allowExternalModel !== undefined) {
      updateFields['settings.allowExternalModel'] = Boolean(allowExternalModel);
    }
    if (shelfLifeWarnDays !== undefined) {
      updateFields['settings.shelfLifeWarnDays'] = Number(shelfLifeWarnDays);
    }
    if (maxUploadBytes !== undefined) {
      updateFields['settings.maxUploadBytes'] = Number(maxUploadBytes);
    }
    if (Array.isArray(watchlist)) {
      updateFields.watchlist = watchlist.map((t) => String(t).trim()).filter(Boolean);
    }

    const updatedOrg = await Org.findByIdAndUpdate(
      orgId,
      { $set: updateFields },
      { new: true, runValidators: true }
    )
      .select('name slug settings watchlist active')
      .lean();

    if (!updatedOrg) {
      return res.status(404).json({
        success: false,
        error: 'Organisation not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        orgId: updatedOrg._id,
        name: updatedOrg.name,
        slug: updatedOrg.slug,
        settings: {
          rules_only: Boolean(updatedOrg.settings?.rules_only),
          allowExternalModel: Boolean(updatedOrg.settings?.allowExternalModel),
          shelfLifeWarnDays: updatedOrg.settings?.shelfLifeWarnDays ?? 30,
          maxUploadBytes: updatedOrg.settings?.maxUploadBytes ?? 10485760,
        },
        watchlist: updatedOrg.watchlist || [],
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
