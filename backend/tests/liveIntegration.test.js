const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '..', '..');
const { resolveFindingEvidence, snapshot } = require('../src/services/findingEvidence');
const Source = require('../src/models/Source');
const AuditLog = require('../src/models/AuditLog');

test('review page defaults to the live findings API', () => {
  const source = fs.readFileSync(
    path.join(root, 'frontend', 'src', 'pages', 'ReviewPage.jsx'),
    'utf8'
  );

  assert.doesNotMatch(source, /const USE_MOCK\s*=\s*true/);
});

test('finding model has persisted explanation and evidence fields', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'models', 'Finding.js'),
    'utf8'
  );

  assert.match(source, /explanation:/);
  assert.match(source, /evidence:/);
});

test('review route has an evidence resolver', () => {
  assert.ok(fs.existsSync(path.join(root, 'backend', 'src', 'services', 'findingEvidence.js')));
});

test('unresolved ML fixture IDs are not persisted as proof references', async () => {
  const result = await resolveFindingEvidence({
    claim: {
      proofPassageId: 'fixture-passage-1',
      evidence: { passageId: 'fixture-passage-1', passage: 'synthetic text' },
    },
    orgId: '507f1f77bcf86cd799439011',
    demoMode: false,
  });

  assert.equal(result.proofPassageId, null);
  assert.equal(result.evidence, null);
});

test('evidence snapshot preserves cited passage metadata', () => {
  const result = snapshot(
    { evidence: { passageId: 'fixture-1', passage: '30 days', page: 3 } },
    { _id: '507f1f77bcf86cd799439012', fileName: 'policy.pdf', version: '4.0' }
  );

  assert.deepEqual(result, {
    passageId: 'fixture-1',
    sourceId: '507f1f77bcf86cd799439012',
    fileName: 'policy.pdf',
    page: 3,
    version: '4.0',
    expiryDate: null,
    ownerName: '',
    passage: '30 days',
  });
});

test('evidence resolver only accepts a source from the requested organisation', async () => {
  const originalFindOne = Source.findOne;
  Source.findOne = (filter) => ({
    lean: async () => filter.orgId === 'org-a'
      ? { _id: '507f1f77bcf86cd799439013', fileName: 'policy.pdf', version: '4.0' }
      : null,
  });

  try {
    const claim = {
      proofPassageId: '507f1f77bcf86cd799439013',
      evidence: { passageId: 'fixture-1', passage: '30 days' },
    };
    const allowed = await resolveFindingEvidence({ claim, orgId: 'org-a', demoMode: false });
    const denied = await resolveFindingEvidence({ claim, orgId: 'org-b', demoMode: false });

    assert.equal(String(allowed.proofPassageId), '507f1f77bcf86cd799439013');
    assert.equal(denied.proofPassageId, null);
    assert.equal(denied.evidence, null);
  } finally {
    Source.findOne = originalFindOne;
  }
});

test('ML orchestrator forwards only redacted content and validates the response', async () => {
  const { extractClaims } = require('../src/services/mlOrchestrator');
  let received;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        claims: [{
          span: { start: 0, end: 8 },
          type: 'question',
          verdict: 'Not Found',
          confidence: 0.6,
          proofPassageId: null,
        }],
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const previousUrl = process.env.ML_SERVICE_URL;
  process.env.ML_SERVICE_URL = `http://127.0.0.1:${port}`;

  try {
    const claims = await extractClaims({
      redactedContent: 'Hello [REDACTED]',
      orgId: '507f1f77bcf86cd799439011',
      intent: { purpose: 'test', audience: 'buyers', mustSay: ['hello'] },
      timeoutMs: 500,
    });

    assert.equal(claims[0].verdict, 'Not Found');
    assert.deepEqual(received, {
      content: 'Hello [REDACTED]',
      orgId: '507f1f77bcf86cd799439011',
      intent: { purpose: 'test', audience: 'buyers', mustSay: ['hello'] },
    });
  } finally {
    if (previousUrl === undefined) delete process.env.ML_SERVICE_URL;
    else process.env.ML_SERVICE_URL = previousUrl;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('frontend live path uses the backend findings envelope and action field names', () => {
  const source = fs.readFileSync(
    path.join(root, 'frontend', 'src', 'pages', 'ReviewPage.jsx'),
    'utf8'
  );

  assert.match(source, /findingsRes\.data\?\.data/);
  assert.match(source, /const payload = \{ status: apiAction \}/);
  assert.match(source, /payload\.editedText/);
  assert.match(source, /payload\.reason/);
});

test('invalid ML responses are rejected instead of persisted', async () => {
  const { extractClaims } = require('../src/services/mlOrchestrator');
  const originalAuditSave = AuditLog.prototype.save;
  AuditLog.prototype.save = async function () { return this; };
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ claims: [{}] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previousUrl = process.env.ML_SERVICE_URL;
  process.env.ML_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;

  try {
    await assert.rejects(
      extractClaims({ redactedContent: 'copy', orgId: '507f1f77bcf86cd799439011', timeoutMs: 500 }),
      (error) => error.code === 'ML_SCHEMA_INVALID'
    );
  } finally {
    AuditLog.prototype.save = originalAuditSave;
    if (previousUrl === undefined) delete process.env.ML_SERVICE_URL;
    else process.env.ML_SERVICE_URL = previousUrl;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('ML timeout is surfaced safely', async () => {
  const { extractClaims } = require('../src/services/mlOrchestrator');
  const originalAuditSave = AuditLog.prototype.save;
  AuditLog.prototype.save = async function () { return this; };
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previousUrl = process.env.ML_SERVICE_URL;
  process.env.ML_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;

  try {
    await assert.rejects(
      extractClaims({ redactedContent: 'copy', orgId: '507f1f77bcf86cd799439011', timeoutMs: 20 }),
      (error) => error.code === 'ML_TIMEOUT'
    );
  } finally {
    AuditLog.prototype.save = originalAuditSave;
    if (previousUrl === undefined) delete process.env.ML_SERVICE_URL;
    else process.env.ML_SERVICE_URL = previousUrl;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('ML claim offsets outside submitted content are rejected', async () => {
  const { extractClaims } = require('../src/services/mlOrchestrator');
  const originalAuditSave = AuditLog.prototype.save;
  AuditLog.prototype.save = async function () { return this; };
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      claims: [{
        span: { start: 0, end: 99 },
        type: 'question',
        verdict: 'Not Found',
        confidence: 0.6,
      }],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previousUrl = process.env.ML_SERVICE_URL;
  process.env.ML_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;

  try {
    await assert.rejects(
      extractClaims({ redactedContent: 'short', orgId: '507f1f77bcf86cd799439011', timeoutMs: 500 }),
      (error) => error.code === 'ML_SCHEMA_INVALID'
    );
  } finally {
    AuditLog.prototype.save = originalAuditSave;
    if (previousUrl === undefined) delete process.env.ML_SERVICE_URL;
    else process.env.ML_SERVICE_URL = previousUrl;
    await new Promise((resolve) => server.close(resolve));
  }
});
