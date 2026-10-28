#!/usr/bin/env node
'use strict';

/**
 * Verifies that an uploaded source remains searchable after the ML container
 * has restarted. Run integration_test.js first so it uploads the Markdown
 * policy fixture, then restart the ML service, then run this script.
 */

const assert = require('node:assert/strict');
const mongoose = require('../backend/node_modules/mongoose');
const Source = require('../backend/src/models/Source');
const fs = require('node:fs');
const path = require('node:path');

const ML_URL = (process.env.ML_URL || 'http://localhost:8000').replace(/\/$/, '');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/brandguard';

function readMlInternalToken() {
  if (process.env.ML_INTERNAL_TOKEN) return process.env.ML_INTERNAL_TOKEN;
  try {
    const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const match = envText.match(/^\s*ML_INTERNAL_TOKEN\s*=\s*(.*?)\s*$/m);
    return match ? match[1].split('#')[0].trim().replace(/^(['"])(.*)\1$/, '$2').trim() : '';
  } catch (_error) {
    return '';
  }
}

const ML_INTERNAL_TOKEN = readMlInternalToken();

async function main() {
  if (!ML_INTERNAL_TOKEN || ML_INTERNAL_TOKEN.length < 32) {
    throw new Error('Set a strong ML_INTERNAL_TOKEN before running this verification.');
  }

  await mongoose.connect(MONGODB_URI);
  try {
    const source = await Source.findOne({
      fileName: 'Stellara_Returns_Policy_v4.md',
      status: { $in: ['ready', 'active'] },
    }).sort({ createdAt: -1 }).lean();

    assert.ok(source, 'integration_test.js must upload the test policy before persistence verification');

    const content = 'Customers may return eligible items within 30 days of the delivery date.';
    const response = await fetch(`${ML_URL}/extract-claims`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ML-Internal-Token': ML_INTERNAL_TOKEN,
      },
      body: JSON.stringify({ content, orgId: String(source.orgId) }),
    });

    const body = await response.json().catch(() => ({}));
    assert.equal(response.status, 200, `ML request failed: HTTP ${response.status} ${JSON.stringify(body)}`);

    const claim = (body.claims || []).find((item) => /30 days/i.test(item.text || ''));
    assert.ok(claim, 'restarted ML service should extract the test duration claim');
    assert.equal(claim.verdict, 'Supported', 'the uploaded source should still support the claim');
    assert.ok(claim.evidence, 'the restored index should return evidence');
    assert.equal(String(claim.evidence.sourceId), String(source._id), 'evidence must come from the uploaded source');
    assert.match(claim.evidence.passage || '', /within 30 days of the delivery date/i);

    console.log('PASS: source remains indexed and retrievable after ML container restart.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('[verify-ml-persistence] FAILED:', error.message);
  process.exitCode = 1;
});
