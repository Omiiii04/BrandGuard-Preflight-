/**
 * insights.js — Governance & Insights API routes.
 *
 * Implements Block 5 & OpenAPI Insights Specification:
 *   GET /v1/insights/rules     — Rules ranked by override rate (Guideline Debugger)
 *   GET /v1/insights/mistakes  — Most repeated mistake categories and time-to-approval
 *
 * Roles: manager, brand_manager, admin, owner
 */

'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { orgIsolation } = require('../middleware/orgIsolation');
const { requireRole } = require('../middleware/rbac');
const {
  getRuleInsights,
  getMistakeInsights,
  getTimeToApproval,
} = require('../services/insightsAggregator');

const router = express.Router();

// Enforce authentication, organisation tenancy, and manager RBAC boundary on all insight endpoints
router.use(authenticate, orgIsolation, requireRole('manager'));

/**
 * GET /v1/insights/rules
 *
 * Returns compliance rules ranked by override rate (Guideline Debugger).
 * Response shape conforms to OpenAPI RulesInsightResponse.
 */
router.get('/rules', async (req, res, next) => {
  try {
    const orgId = req.org?._id || req.orgId;
    const ruleInsights = await getRuleInsights(orgId);

    return res.status(200).json({
      success: true,
      data: ruleInsights,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/insights/mistakes
 *
 * Returns repeated mistake categories and time-to-approval metrics.
 * Response shape conforms to OpenAPI MistakesInsightResponse.
 */
router.get('/mistakes', async (req, res, next) => {
  try {
    const orgId = req.org?._id || req.orgId;
    const [mistakeInsights, timeToApproval] = await Promise.all([
      getMistakeInsights(orgId),
      getTimeToApproval(orgId),
    ]);

    return res.status(200).json({
      success: true,
      data: mistakeInsights,
      timeToApproval,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /v1/insights/time-to-approval
 *
 * Detailed time-to-approval duration metrics across approved drafts.
 */
router.get('/time-to-approval', async (req, res, next) => {
  try {
    const orgId = req.org?._id || req.orgId;
    const timeToApproval = await getTimeToApproval(orgId);

    return res.status(200).json({
      success: true,
      data: timeToApproval,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
