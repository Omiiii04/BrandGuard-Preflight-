/**
 * mlOrchestrator.js — Internal ML Service communication layer.
 *
 * Implements the Architectural Blueprint (Section 8 – AI Central Memory):
 *   - Calls FastAPI ML service POST /extract-claims with redacted content only
 *     (confidential terms stripped by redactionGateway before this ever runs).
 *   - Adds orgId for multi-tenant context propagation.
 *   - Enforces configurable HTTP timeout (default 30 s).
 *   - Validates the response shape and rejects non-conforming payloads by
 *     writing a 'ml_response_discarded' AuditLog event before throwing.
 *
 * ML response types with server-side schema validation:
 *   - extract-claims   : { claims: Claim[] }
 *   - fact-check       : { verdict, confidence, evidence?, explanation? }
 *   - summarise        : { summary, tokenCount? }
 *   - classify         : { labels: ClassLabel[], topLabel, topScore }
 *   - index-passage    : { passageId, status, indexed? }
 *   - similarity       : { score, matches?: SimilarityMatch[] }
 *
 * Any response that fails schema validation is discarded and an immutable
 * 'ml_response_discarded' AuditLog event is written before the error is thrown.
 *
 * Security rules enforced here:
 *   - Only redactedContent (never raw content) is forwarded.
 *   - ML_SERVICE_URL is an internal Docker / process env variable and is never
 *     exposed to the browser.
 *   - Every backend-to-ML request carries X-ML-Internal-Token.
 */

'use strict';

const http  = require('http');
const https = require('https');
const { URL } = require('url');

const { logEventSafe, AUDIT_EVENTS } = require('./auditLogger');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default timeout in milliseconds for ML service HTTP calls.
 * Override via environment variable ML_TIMEOUT_MS.
 */
const DEFAULT_TIMEOUT_MS = parseInt(process.env.ML_TIMEOUT_MS, 10) || 30_000;

/**
 * Allowed verdict strings (mirrors OpenAPI Verdict enum).
 * Used by extract-claims and fact-check response validators.
 */
const VALID_VERDICTS = new Set(['Supported', 'Contradicted', 'Outdated', 'Not Found', 'Unclear']);

/**
 * Allowed finding type strings (mirrors OpenAPI FindingType enum).
 */
const VALID_FINDING_TYPES = new Set(['violation', 'question']);

/**
 * Allowed index-passage status values returned by the ML service.
 */
const VALID_INDEX_STATUSES = new Set(['queued', 'processing', 'indexed', 'failed']);

/**
 * Registry of known ML endpoint response type identifiers.
 * Keys are used by validateMlResponse() to dispatch to the correct validator.
 */
const ML_RESPONSE_TYPES = {
  EXTRACT_CLAIMS  : 'extract-claims',
  FACT_CHECK      : 'fact-check',
  SUMMARISE       : 'summarise',
  CLASSIFY        : 'classify',
  INDEX_PASSAGE   : 'index-passage',
  SIMILARITY      : 'similarity',
  REWRITE         : 'rewrite',
};

// ---------------------------------------------------------------------------
// Internal HTTP helper
// ---------------------------------------------------------------------------

/**
 * Performs a JSON POST to an internal service URL with a strict timeout.
 *
 * @param {string}  targetUrl  - Full URL including path
 * @param {object}  payload    - JSON-serialisable request body
 * @param {number}  timeoutMs  - Request timeout in milliseconds
 * @returns {Promise<object>}  - Parsed JSON response body
 */
function postJson(targetUrl, payload, timeoutMs, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const bodyStr   = JSON.stringify(payload);

    const options = {
      hostname : parsedUrl.hostname,
      port     : parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path     : parsedUrl.pathname + (parsedUrl.search || ''),
      method   : 'POST',
      headers  : {
        'Content-Type'   : 'application/json',
        'Content-Length' : Buffer.byteLength(bodyStr),
        'X-Internal'     : 'brandguard-backend',
        ...extraHeaders,
      },
    };

    const transport = parsedUrl.protocol === 'https:' ? https : http;

    const req = transport.request(options, (res) => {
      const chunks = [];

      res.on('data', (chunk) => chunks.push(chunk));

      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');

        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(
            Object.assign(
              new Error(`ML service responded with HTTP ${res.statusCode}: ${raw}`),
              { code: 'ML_HTTP_ERROR', statusCode: res.statusCode }
            )
          );
        }

        try {
          resolve(JSON.parse(raw));
        } catch (_e) {
          reject(
            Object.assign(
              new Error(`ML service returned non-JSON body: ${raw.slice(0, 200)}`),
              { code: 'ML_INVALID_JSON' }
            )
          );
        }
      });
    });

    // Hard timeout: destroy the socket after `timeoutMs` ms
    req.setTimeout(timeoutMs, () => {
      req.destroy(
        Object.assign(
          new Error(`ML service request timed out after ${timeoutMs} ms`),
          { code: 'ML_TIMEOUT' }
        )
      );
    });

    req.on('error', (err) => {
      if (!err.code) err.code = 'ML_NETWORK_ERROR';
      reject(err);
    });

    req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

/**
 * Validates a single claim object returned by the ML service.
 *
 * Required fields:
 *   span        : { start: number, end: number }
 *   type        : 'violation' | 'question'
 *   verdict     : Verdict enum string
 *   confidence  : number (0–1)
 *
 * Optional fields:
 *   suggestedFix : string
 *   ruleId       : string
 *   meaningCheck : { kept?, changed?, dropped? }
 *
 * @param {unknown} claim
 * @param {number}  index - Position in the claims array (for error messages)
 * @returns {{ valid: boolean, error?: string }}
 */
function validateClaim(claim, index, contentLength = null) {
  const prefix = `claims[${index}]`;

  if (!claim || typeof claim !== 'object') {
    return { valid: false, error: `${prefix}: must be an object` };
  }

  // ── span ───────────────────────────────────────────────────────────────────
  if (!claim.span || typeof claim.span !== 'object') {
    return { valid: false, error: `${prefix}.span: required object with start/end` };
  }
  if (typeof claim.span.start !== 'number' || typeof claim.span.end !== 'number') {
    return { valid: false, error: `${prefix}.span.start and .end must be numbers` };
  }
  if (claim.span.start < 0 || claim.span.end < claim.span.start) {
    return { valid: false, error: `${prefix}.span: start must be >= 0 and end >= start` };
  }
  if (contentLength !== null && claim.span.end > contentLength) {
    return {
      valid: false,
      error: `${prefix}.span: end must not exceed submitted content length ${contentLength}`,
    };
  }

  // ── type ───────────────────────────────────────────────────────────────────
  if (!VALID_FINDING_TYPES.has(claim.type)) {
    return {
      valid: false,
      error: `${prefix}.type: must be one of [${[...VALID_FINDING_TYPES].join(', ')}], got "${claim.type}"`,
    };
  }

  // ── verdict ────────────────────────────────────────────────────────────────
  if (!VALID_VERDICTS.has(claim.verdict)) {
    return {
      valid: false,
      error: `${prefix}.verdict: must be one of [${[...VALID_VERDICTS].join(', ')}], got "${claim.verdict}"`,
    };
  }

  // ── confidence ─────────────────────────────────────────────────────────────
  if (typeof claim.confidence !== 'number') {
    return { valid: false, error: `${prefix}.confidence: must be a number` };
  }
  if (claim.confidence < 0 || claim.confidence > 1) {
    return { valid: false, error: `${prefix}.confidence: must be between 0 and 1, got ${claim.confidence}` };
  }

  // ── optional: suggestedFix ─────────────────────────────────────────────────
  if (claim.suggestedFix !== undefined && typeof claim.suggestedFix !== 'string') {
    return { valid: false, error: `${prefix}.suggestedFix: must be a string if provided` };
  }

  // ── optional: ruleId ───────────────────────────────────────────────────────
  if (claim.ruleId !== undefined && typeof claim.ruleId !== 'string') {
    return { valid: false, error: `${prefix}.ruleId: must be a string if provided` };
  }

  // ── optional: meaningCheck ─────────────────────────────────────────────────
  if (claim.meaningCheck !== undefined) {
    const mc = claim.meaningCheck;
    if (typeof mc !== 'object' || mc === null) {
      return { valid: false, error: `${prefix}.meaningCheck: must be an object if provided` };
    }
    for (const field of ['kept', 'changed', 'dropped']) {
      if (mc[field] !== undefined && !Array.isArray(mc[field])) {
        return { valid: false, error: `${prefix}.meaningCheck.${field}: must be an array if provided` };
      }
    }
  }

  return { valid: true };
}

/**
 * Validates the full /extract-claims ML response envelope.
 *
 * Expected shape: { claims: Claim[] }
 *
 * @param {unknown} body
 * @returns {{ valid: boolean, error?: string }}
 */
function validateExtractClaimsResponse(body, contentLength = null) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Response body must be a JSON object' };
  }

  if (!Array.isArray(body.claims)) {
    return { valid: false, error: 'Response must contain a "claims" array' };
  }

  for (let i = 0; i < body.claims.length; i++) {
    const result = validateClaim(body.claims[i], i, contentLength);
    if (!result.valid) return result;
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Additional ML response type validators
// ---------------------------------------------------------------------------

/**
 * Validates the /fact-check ML response envelope.
 *
 * Expected shape:
 *   {
 *     verdict    : Verdict enum string (required)
 *     confidence : number [0,1]        (required)
 *     evidence?  : string              (optional)
 *     explanation? : string            (optional)
 *   }
 *
 * @param {unknown} body
 * @returns {{ valid: boolean, error?: string }}
 */
function validateFactCheckResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'fact-check response body must be a JSON object' };
  }

  if (!VALID_VERDICTS.has(body.verdict)) {
    return {
      valid : false,
      error : `fact-check response: verdict must be one of [${[...VALID_VERDICTS].join(', ')}], got "${body.verdict}"`,
    };
  }

  if (typeof body.confidence !== 'number') {
    return { valid: false, error: 'fact-check response: confidence must be a number' };
  }
  if (body.confidence < 0 || body.confidence > 1) {
    return {
      valid : false,
      error : `fact-check response: confidence must be between 0 and 1, got ${body.confidence}`,
    };
  }

  if (body.evidence !== undefined && typeof body.evidence !== 'string') {
    return { valid: false, error: 'fact-check response: evidence must be a string if provided' };
  }

  if (body.explanation !== undefined && typeof body.explanation !== 'string') {
    return { valid: false, error: 'fact-check response: explanation must be a string if provided' };
  }

  return { valid: true };
}

/**
 * Validates the /summarise ML response envelope.
 *
 * Expected shape:
 *   {
 *     summary    : string   (required, non-empty)
 *     tokenCount?: number   (optional, positive integer)
 *   }
 *
 * @param {unknown} body
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSummariseResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'summarise response body must be a JSON object' };
  }

  if (typeof body.summary !== 'string' || !body.summary.trim()) {
    return { valid: false, error: 'summarise response: summary must be a non-empty string' };
  }

  if (body.tokenCount !== undefined) {
    if (typeof body.tokenCount !== 'number' || !Number.isInteger(body.tokenCount) || body.tokenCount < 0) {
      return {
        valid : false,
        error : 'summarise response: tokenCount must be a non-negative integer if provided',
      };
    }
  }

  return { valid: true };
}

/**
 * Validates a single label entry inside a /classify response.
 *
 * @param {{ label: string, score: number }} item
 * @param {number} index
 * @returns {{ valid: boolean, error?: string }}
 */
function validateClassLabel(item, index) {
  const prefix = `labels[${index}]`;

  if (!item || typeof item !== 'object') {
    return { valid: false, error: `${prefix}: must be an object` };
  }
  if (typeof item.label !== 'string' || !item.label.trim()) {
    return { valid: false, error: `${prefix}.label: must be a non-empty string` };
  }
  if (typeof item.score !== 'number') {
    return { valid: false, error: `${prefix}.score: must be a number` };
  }
  if (item.score < 0 || item.score > 1) {
    return { valid: false, error: `${prefix}.score: must be between 0 and 1, got ${item.score}` };
  }

  return { valid: true };
}

/**
 * Validates the /classify ML response envelope.
 *
 * Expected shape:
 *   {
 *     labels   : ClassLabel[]  (required, at least one element)
 *     topLabel : string        (required, must exist in labels)
 *     topScore : number [0,1]  (required)
 *   }
 *
 * @param {unknown} body
 * @returns {{ valid: boolean, error?: string }}
 */
function validateClassifyResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'classify response body must be a JSON object' };
  }

  if (!Array.isArray(body.labels) || body.labels.length === 0) {
    return { valid: false, error: 'classify response: labels must be a non-empty array' };
  }

  for (let i = 0; i < body.labels.length; i++) {
    const result = validateClassLabel(body.labels[i], i);
    if (!result.valid) return result;
  }

  if (typeof body.topLabel !== 'string' || !body.topLabel.trim()) {
    return { valid: false, error: 'classify response: topLabel must be a non-empty string' };
  }

  const labelStrings = body.labels.map((l) => l.label);
  if (!labelStrings.includes(body.topLabel)) {
    return {
      valid : false,
      error : `classify response: topLabel "${body.topLabel}" does not appear in labels array`,
    };
  }

  if (typeof body.topScore !== 'number') {
    return { valid: false, error: 'classify response: topScore must be a number' };
  }
  if (body.topScore < 0 || body.topScore > 1) {
    return { valid: false, error: `classify response: topScore must be between 0 and 1, got ${body.topScore}` };
  }

  return { valid: true };
}

/**
 * Validates the /index-passage ML response envelope.
 *
 * Expected shape:
 *   {
 *     passageId : string                        (required)
 *     status    : 'queued'|'processing'|'indexed'|'failed'  (required)
 *     indexed?  : boolean                       (optional)
 *   }
 *
 * @param {unknown} body
 * @returns {{ valid: boolean, error?: string }}
 */
function validateIndexResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'index-passage response body must be a JSON object' };
  }

  if (typeof body.passageId !== 'string' || !body.passageId.trim()) {
    return { valid: false, error: 'index-passage response: passageId must be a non-empty string' };
  }

  if (!VALID_INDEX_STATUSES.has(body.status)) {
    return {
      valid : false,
      error : `index-passage response: status must be one of [${[...VALID_INDEX_STATUSES].join(', ')}], got "${body.status}"`,
    };
  }

  if (body.indexed !== undefined && typeof body.indexed !== 'boolean') {
    return { valid: false, error: 'index-passage response: indexed must be a boolean if provided' };
  }

  return { valid: true };
}

function validateSourceIndexResponse(body, expectedSourceId, expectedOrgId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'index-source response body must be a JSON object' };
  }
  if (body.indexed !== true || body.status !== 'indexed') {
    return { valid: false, error: 'index-source response must confirm indexed status' };
  }
  if (String(body.sourceId) !== String(expectedSourceId)) {
    return { valid: false, error: 'index-source response sourceId does not match request' };
  }
  if (String(body.orgId) !== String(expectedOrgId)) {
    return { valid: false, error: 'index-source response orgId does not match request' };
  }
  if (!Number.isInteger(body.passageCount) || body.passageCount < 0) {
    return { valid: false, error: 'index-source response passageCount must be a non-negative integer' };
  }
  return { valid: true };
}

/**
 * Validates a single match entry inside a /similarity response.
 *
 * @param {{ passageId: string, score: number, snippet?: string }} item
 * @param {number} index
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSimilarityMatch(item, index) {
  const prefix = `matches[${index}]`;

  if (!item || typeof item !== 'object') {
    return { valid: false, error: `${prefix}: must be an object` };
  }
  if (typeof item.passageId !== 'string' || !item.passageId.trim()) {
    return { valid: false, error: `${prefix}.passageId: must be a non-empty string` };
  }
  if (typeof item.score !== 'number') {
    return { valid: false, error: `${prefix}.score: must be a number` };
  }
  if (item.score < 0 || item.score > 1) {
    return { valid: false, error: `${prefix}.score: must be between 0 and 1, got ${item.score}` };
  }
  if (item.snippet !== undefined && typeof item.snippet !== 'string') {
    return { valid: false, error: `${prefix}.snippet: must be a string if provided` };
  }

  return { valid: true };
}

/**
 * Validates the /similarity ML response envelope.
 *
 * Expected shape:
 *   {
 *     score    : number [0,1]          (required — overall similarity score)
 *     matches? : SimilarityMatch[]     (optional — top-k nearest passages)
 *   }
 *
 * @param {unknown} body
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSimilarityResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'similarity response body must be a JSON object' };
  }

  if (typeof body.score !== 'number') {
    return { valid: false, error: 'similarity response: score must be a number' };
  }
  if (body.score < 0 || body.score > 1) {
    return { valid: false, error: `similarity response: score must be between 0 and 1, got ${body.score}` };
  }

  if (body.matches !== undefined) {
    if (!Array.isArray(body.matches)) {
      return { valid: false, error: 'similarity response: matches must be an array if provided' };
    }
    for (let i = 0; i < body.matches.length; i++) {
      const result = validateSimilarityMatch(body.matches[i], i);
      if (!result.valid) return result;
    }
  }

  return { valid: true };
}

/**
 * Validates the /rewrite ML response envelope.
 *
 * Expected shape:
 *   {
 *     suggestedFix?       : string
 *     suggestedRewording? : string
 *     meaningCheck?       : { kept?, changed?, dropped? }
 *   }
 *
 * @param {unknown} body
 * @returns {{ valid: boolean, error?: string }}
 */
function validateRewriteResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'rewrite response body must be a JSON object' };
  }
  if (body.suggestedFix !== undefined && typeof body.suggestedFix !== 'string') {
    return { valid: false, error: 'suggestedFix must be a string' };
  }
  if (body.suggestedRewording !== undefined && typeof body.suggestedRewording !== 'string') {
    return { valid: false, error: 'suggestedRewording must be a string' };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Validator registry and dispatcher
// ---------------------------------------------------------------------------

/**
 * Maps ML response type identifiers to their validator functions.
 * Add new response types here as the ML service grows.
 */
const ML_VALIDATORS = {
  [ML_RESPONSE_TYPES.EXTRACT_CLAIMS] : validateExtractClaimsResponse,
  [ML_RESPONSE_TYPES.FACT_CHECK]     : validateFactCheckResponse,
  [ML_RESPONSE_TYPES.SUMMARISE]      : validateSummariseResponse,
  [ML_RESPONSE_TYPES.CLASSIFY]       : validateClassifyResponse,
  [ML_RESPONSE_TYPES.INDEX_PASSAGE]  : validateIndexResponse,
  [ML_RESPONSE_TYPES.SIMILARITY]     : validateSimilarityResponse,
  [ML_RESPONSE_TYPES.REWRITE]        : validateRewriteResponse,
};

/**
 * Dispatches to the correct validator for a given ML response type.
 *
 * @param {string}  responseType - One of the ML_RESPONSE_TYPES values
 * @param {unknown} body         - Parsed response body from the ML service
 * @returns {{ valid: boolean, error?: string }}
 */
function validateMlResponse(responseType, body) {
  const validator = ML_VALIDATORS[responseType];

  if (!validator) {
    return {
      valid : false,
      error : `Unknown ML response type "${responseType}". Register a validator in ML_VALIDATORS.`,
    };
  }

  return validator(body);
}

/**
 * Validates an ML response body and — on failure — writes an immutable
 * 'ml_response_discarded' AuditLog event, then throws with code 'ML_SCHEMA_INVALID'.
 *
 * Use this helper inside any orchestrator function that calls the ML service
 * to guarantee consistent audit coverage across all endpoints.
 *
 * @param {object} params
 * @param {string}  params.responseType  - ML_RESPONSE_TYPES value
 * @param {unknown} params.rawResponse   - Parsed JSON body from the ML service
 * @param {string}  params.targetUrl     - The URL that returned this response (for audit)
 * @param {string|import('mongoose').Types.ObjectId} params.orgId   - Org for audit event
 * @param {string|import('mongoose').Types.ObjectId} [params.actor] - User ID for audit event
 * @param {string|import('mongoose').Types.ObjectId} [params.entityId] - Draft/source ID
 * @param {string} [params.entityType='draft']  - Entity category for audit event
 * @returns {Promise<void>} Resolves if valid; rejects (throws) with ML_SCHEMA_INVALID if not
 */
async function discardIfInvalid({
  responseType,
  rawResponse,
  targetUrl,
  orgId,
  actor     = null,
  entityId  = null,
  entityType = 'draft',
}) {
  const validation = validateMlResponse(responseType, rawResponse);

  if (validation.valid) return; // Nothing to do — response is conforming

  const schemaErr = Object.assign(
    new Error(`ML response [${responseType}] failed schema validation: ${validation.error}`),
    { code: 'ML_SCHEMA_INVALID' }
  );

  console.error(`[mlOrchestrator] Schema validation failed [${responseType}]: ${validation.error}`);
  console.error(
    '[mlOrchestrator] Raw response snippet:',
    JSON.stringify(rawResponse).slice(0, 500)
  );

  await logEventSafe({
    orgId,
    actor,
    eventType  : AUDIT_EVENTS.ML_RESPONSE_DISCARDED,
    entityType,
    entityId,
    metadata   : {
      responseType,
      reason             : validation.error,
      errorCode          : 'ML_SCHEMA_INVALID',
      rawResponseSnippet : JSON.stringify(rawResponse).slice(0, 500),
      targetUrl,
    },
  });

  throw schemaErr;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function indexSource({
  sourceId,
  orgId,
  fileName,
  mimeType,
  version = '1.0',
  expiryDate = null,
  ownerName = '',
  status = 'ready',
  content,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const mlBaseUrl = (process.env.ML_SERVICE_URL || '').replace(/\/$/, '');
  if (!mlBaseUrl) {
    throw Object.assign(new Error('ML_SERVICE_URL environment variable is not configured.'), {
      code: 'ML_URL_NOT_CONFIGURED',
    });
  }

  const payload = {
    sourceId: String(sourceId),
    orgId: String(orgId),
    fileName: String(fileName),
    mimeType: mimeType || 'application/octet-stream',
    version: String(version || '1.0'),
    expiryDate: expiryDate || null,
    ownerName: String(ownerName || ''),
    status: String(status || 'ready'),
    contentBase64: Buffer.from(content || '').toString('base64'),
  };
  const rawResponse = await postJson(
    `${mlBaseUrl}/index-source`,
    payload,
    timeoutMs,
    { 'X-ML-Internal-Token': process.env.ML_INTERNAL_TOKEN || '' }
  );
  const validation = validateSourceIndexResponse(rawResponse, sourceId, orgId);
  if (!validation.valid) {
    throw Object.assign(new Error(`ML source index response failed schema validation: ${validation.error}`), {
      code: 'ML_SCHEMA_INVALID',
    });
  }
  return rawResponse;
}

/** Sync mutable lifecycle metadata with the ML passage index. */
async function updateSourceMetadata({
  sourceId,
  orgId,
  status,
  expiryDate,
  ownerName,
  version,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const mlBaseUrl = (process.env.ML_SERVICE_URL || '').replace(/\/$/, '');
  if (!mlBaseUrl) {
    throw Object.assign(new Error('ML_SERVICE_URL environment variable is not configured.'), {
      code: 'ML_URL_NOT_CONFIGURED',
    });
  }
  const payload = { sourceId: String(sourceId), orgId: String(orgId) };
  if (status !== undefined) payload.status = status;
  if (expiryDate !== undefined) payload.expiryDate = expiryDate ? new Date(expiryDate).toISOString() : null;
  if (ownerName !== undefined) payload.ownerName = String(ownerName || '');
  if (version !== undefined) payload.version = String(version || '1.0');
  return postJson(
    `${mlBaseUrl}/source-metadata`,
    payload,
    timeoutMs,
    { 'X-ML-Internal-Token': process.env.ML_INTERNAL_TOKEN || '' }
  );
}

// ---------------------------------------------------------------------------
// Exact-rule extraction (deterministic, zero external calls)
// ---------------------------------------------------------------------------

const EXACT_SUPERLATIVE_RE = /\b(?:best|only|fastest|leading|number one|#1)\b[^.!?,;:\n]*?(?=\s+(?:for|with|and|to|of)\b|[.!?,;:\n]|$)/gi;
const EXACT_OUTDATED_RETURN_RE = /\b(?:within\s+)?14[-\s]days?(?:\s+of\s+(?:the\s+)?delivery(?:\s+date)?)?\b/gi;
const EXACT_COST_CLAIM_RE = /\b(?:free\s+returns?|zero\s+restocking|free\s+delivery|zero[\s-]cost|free\s+of\s+charge)\b/gi;

function escapeRegexStr(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts exact-rule findings deterministically without making any external LM calls.
 * Used when organisation setting `rules_only = true` is enabled or LM is bypassed.
 *
 * @param {string} content - Redacted draft content
 * @param {object} [options={}]
 * @param {Array<string>} [options.bannedTerms]
 * @returns {Array<object>} Formatted claim findings
 */
function extractExactRuleFindings(content, options = {}) {
  const text = String(content || '');
  const findings = [];
  const bannedTerms = Array.isArray(options.bannedTerms) ? options.bannedTerms : [];

  // 1. Unqualified superlatives
  let match;
  const supRegex = new RegExp(EXACT_SUPERLATIVE_RE.source, 'gi');
  while ((match = supRegex.exec(text)) !== null) {
    const spanText = match[0].trim();
    findings.push({
      span: { start: match.index, end: match.index + spanText.length },
      type: 'violation',
      verdict: 'Contradicted',
      confidence: 1.0,
      ruleId: 'rule.superlative.unqualified',
      explanation: 'An unqualified superlative is not permitted without substantiation.',
      suggestedFix: 'We offer a 30-day returns policy.',
      draftSpan: spanText,
      meaningCheck: { kept: [], changed: [], dropped: [] },
    });
  }

  // 2. Outdated returns window (14-day superseded by 30-day)
  const retRegex = new RegExp(EXACT_OUTDATED_RETURN_RE.source, 'gi');
  while ((match = retRegex.exec(text)) !== null) {
    const spanText = match[0].trim();
    findings.push({
      span: { start: match.index, end: match.index + spanText.length },
      type: 'violation',
      verdict: 'Outdated',
      confidence: 0.95,
      ruleId: 'rule.date.outdated',
      explanation: 'Prior policy documents referencing a 14-day window are superseded. The standard window is 30 days.',
      suggestedFix: 'Our 30-day return window applies to eligible items.',
      draftSpan: spanText,
      meaningCheck: { kept: [], changed: [], dropped: [] },
    });
  }

  // 3. Unverified cost claims
  const costRegex = new RegExp(EXACT_COST_CLAIM_RE.source, 'gi');
  while ((match = costRegex.exec(text)) !== null) {
    const spanText = match[0].trim();
    findings.push({
      span: { start: match.index, end: match.index + spanText.length },
      type: 'question',
      verdict: 'Not Found',
      confidence: 0.85,
      ruleId: 'rule.cost.claim',
      explanation: 'Unverified pricing or free-of-charge claim without supporting documentation.',
      suggestedFix: '',
      draftSpan: spanText,
      meaningCheck: { kept: [], changed: [], dropped: [] },
    });
  }

  // 4. Banned terms / watchlist terms
  for (const term of bannedTerms) {
    if (!term || typeof term !== 'string' || !term.trim()) continue;
    const termRegex = new RegExp(`\\b${escapeRegexStr(term.trim())}\\b`, 'gi');
    while ((match = termRegex.exec(text)) !== null) {
      const spanText = match[0].trim();
      findings.push({
        span: { start: match.index, end: match.index + spanText.length },
        type: 'violation',
        verdict: 'Contradicted',
        confidence: 1.0,
        ruleId: 'rule.banned-term',
        explanation: `Restricted or embargoed term "${term}" detected.`,
        suggestedFix: '',
        draftSpan: spanText,
        meaningCheck: { kept: [], changed: [], dropped: [] },
      });
    }
  }

  // Sort deterministically by start offset
  findings.sort((a, b) => a.span.start - b.span.start);
  return findings;
}

/**
 * Standard rule rewordings used for fallback or when offline.
 */
const DEFAULT_RULE_REWORDINGS = {
  'rule.superlative.unqualified':
    'Claims must avoid unverified superlatives ("best", "market leader"). State verified benchmark numbers or certified laboratory test data instead.',
  'rule.date.outdated':
    'Specify standard 30-day return window from physical delivery timestamp, referencing current Customer Terms v4.0.',
  'rule.cost.claim':
    'Free return phrasing is allowed only for domestic orders with original packaging intact.',
  'rule.contradiction':
    'Ensure product availability and returns eligibility match current published support guidelines.',
  'rule.unsupported':
    'Every factual claim must cite an approved active source document with matching passage proof.',
  'rule.meaning.changed':
    'Preserve mandatory approved brand terminology without altering core meaning.',
};

/**
 * Calls the ML service POST /rewrite endpoint to suggest clearer rewording for a rule or claim.
 *
 * @param {object} params
 * @param {object|string} [params.claim]
 * @param {string} [params.rule]
 * @param {string} [params.ruleId]
 * @param {string} [params.description]
 * @param {string} [params.originalText]
 * @param {object} [params.intent]
 * @param {Array<object>} [params.passages]
 * @param {string|import('mongoose').Types.ObjectId} [params.orgId]
 * @param {number} [params.timeoutMs]
 * @returns {Promise<{ suggestedFix: string, suggestedRewording: string, meaningCheck: object }>}
 */
async function rewriteClaim({
  claim,
  rule        = null,
  ruleId      = null,
  description = '',
  originalText = '',
  intent      = {},
  passages    = [],
  orgId       = '',
  timeoutMs   = DEFAULT_TIMEOUT_MS,
}) {
  const rId = ruleId || rule || (typeof claim === 'object' ? claim?.ruleId : null);
  const mlBaseUrl = (process.env.ML_SERVICE_URL || '').replace(/\/$/, '');

  const defaultRewording =
    DEFAULT_RULE_REWORDINGS[rId] ||
    (description ? `Refine guideline: ${description}. Must include verifiable compliance criteria.` : 'Guideline rule must specify clear, verifiable compliance criteria.');

  if (!mlBaseUrl) {
    return {
      suggestedFix: defaultRewording,
      suggestedRewording: defaultRewording,
      meaningCheck: { kept: [], changed: [], dropped: [] },
    };
  }

  const targetUrl = `${mlBaseUrl}/rewrite`;
  const claimPayload =
    typeof claim === 'object' && claim !== null
      ? claim
      : { text: String(claim || originalText || description || '') };

  const payload = {
    claim: claimPayload,
    rule: rId,
    ruleId: rId,
    originalText: String(originalText || claimPayload.text || description || ''),
    intent: {
      purpose: intent?.purpose || '',
      audience: intent?.audience || '',
      mustSay: Array.isArray(intent?.mustSay) ? intent.mustSay : [],
    },
    passages: Array.isArray(passages) ? passages : [],
    orgId: String(orgId || ''),
  };

  try {
    const rawResponse = await postJson(targetUrl, payload, timeoutMs, { 'X-ML-Internal-Token': process.env.ML_INTERNAL_TOKEN || '' });
    const suggestedFix = rawResponse?.suggestedFix || '';
    const suggestedRewording =
      rawResponse?.suggestedRewording ||
      suggestedFix ||
      defaultRewording;

    return {
      suggestedFix,
      suggestedRewording,
      meaningCheck: rawResponse?.meaningCheck || { kept: [], changed: [], dropped: [] },
    };
  } catch (err) {
    console.warn(`[mlOrchestrator] /rewrite call failed: ${err.message}. Using default rewording fallback.`);
    return {
      suggestedFix: defaultRewording,
      suggestedRewording: defaultRewording,
      meaningCheck: { kept: [], changed: [], dropped: [] },
    };
  }
}

/**
 * Calls the ML service POST /extract-claims endpoint with redacted content.
 * If rulesOnly is true, skips all LM / HTTP calls and returns exact-rule findings.
 *
 * Orchestration steps:
 *   1. Resolve ML_SERVICE_URL — throw immediately if not configured.
 *   2. Build safe payload: redactedContent + orgId + intent only.
 *   3. POST to /extract-claims with enforced timeout.
 *   4. Validate the response against the Claim / Finding schema.
 *   5. On schema failure: write 'ml_response_discarded' AuditLog (non-throwing) then throw.
 *   6. On success: return the validated claims array.
 *
 * @param {object} params
 * @param {string} params.redactedContent            - Content with confidential terms replaced
 * @param {string|import('mongoose').Types.ObjectId} params.orgId    - Organisation ID
 * @param {object} [params.intent]                   - Draft intent (purpose / audience / mustSay)
 * @param {string|import('mongoose').Types.ObjectId} [params.draftId] - Draft ID for audit context
 * @param {string|import('mongoose').Types.ObjectId} [params.actor]   - User ID for audit context
 * @param {boolean} [params.rulesOnly=false]         - If true, skip LM calls and return only exact-rule findings
 * @param {number} [params.timeoutMs]                - Override timeout in ms
 * @returns {Promise<Array<object>>} Validated claim objects
 *
 * @throws {Error} with .code:
 *   'ML_URL_NOT_CONFIGURED' — ML_SERVICE_URL env var missing
 *   'ML_TIMEOUT'            — request timed out
 *   'ML_HTTP_ERROR'         — non-2xx HTTP status
 *   'ML_NETWORK_ERROR'      — socket / DNS failure
 *   'ML_INVALID_JSON'       — response not valid JSON
 *   'ML_SCHEMA_INVALID'     — response fails schema validation
 */
async function extractClaims({
  redactedContent,
  orgId,
  intent    = {},
  draftId   = null,
  actor     = null,
  rulesOnly = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  // ── Rules-only mode: Skip all LM calls and return exact-rule findings only ───
  if (rulesOnly) {
    console.log(`[mlOrchestrator] rules_only=true: skipping all LM calls for org ${orgId}`);

    await logEventSafe({
      orgId,
      actor,
      eventType  : AUDIT_EVENTS.RULES_ONLY_FALLBACK,
      entityType : 'draft',
      entityId   : draftId,
      metadata   : {
        reason        : 'Org setting rules_only enabled; skipped all LM calls',
        contentLength : (redactedContent || '').length,
      },
    });

    return extractExactRuleFindings(redactedContent, { orgId, intent });
  }

  // ── 0. Resolve ML service base URL ─────────────────────────────────────────
  const mlBaseUrl = (process.env.ML_SERVICE_URL || '').replace(/\/$/, '');
  if (!mlBaseUrl) {
    throw Object.assign(
      new Error(
        'ML_SERVICE_URL environment variable is not configured. ' +
        'Set it to the internal ML service address (e.g. http://ml:8000).'
      ),
      { code: 'ML_URL_NOT_CONFIGURED' }
    );
  }

  const targetUrl = `${mlBaseUrl}/extract-claims`;

  // ── 1. Build safe payload — redacted content + orgId only ─────────────────
  const payload = {
    content : String(redactedContent || ''),
    orgId   : String(orgId),
    intent  : {
      purpose  : intent?.purpose  || '',
      audience : intent?.audience || '',
      mustSay  : Array.isArray(intent?.mustSay) ? intent.mustSay : [],
    },
  };

  console.log(
    `[mlOrchestrator] POST ${targetUrl} | org=${orgId}` +
    ` | contentLength=${payload.content.length} | timeout=${timeoutMs}ms`
  );

  // ── 2. HTTP POST with timeout ──────────────────────────────────────────────
  let rawResponse;
  try {
    rawResponse = await postJson(targetUrl, payload, timeoutMs, { 'X-ML-Internal-Token': process.env.ML_INTERNAL_TOKEN || '' });
  } catch (httpErr) {
    console.error(`[mlOrchestrator] HTTP call failed [${httpErr.code}]: ${httpErr.message}`);

    await logEventSafe({
      orgId,
      actor,
      eventType  : AUDIT_EVENTS.ML_RESPONSE_DISCARDED,
      entityType : 'draft',
      entityId   : draftId,
      metadata   : {
        reason    : httpErr.message,
        errorCode : httpErr.code,
        targetUrl,
      },
    });

    throw httpErr;
  }

  // ── 3. Schema validation ───────────────────────────────────────────────────
  const validation = validateExtractClaimsResponse(rawResponse, payload.content.length);

  if (!validation.valid) {
    const schemaErr = Object.assign(
      new Error(`ML service response failed schema validation: ${validation.error}`),
      { code: 'ML_SCHEMA_INVALID' }
    );

    console.error(`[mlOrchestrator] Schema validation failed: ${validation.error}`);
    console.error(
      '[mlOrchestrator] Raw response snippet:',
      JSON.stringify(rawResponse).slice(0, 500)
    );

    // ── 4. Write ml_response_discarded audit event ─────────────────────────
    await logEventSafe({
      orgId,
      actor,
      eventType  : AUDIT_EVENTS.ML_RESPONSE_DISCARDED,
      entityType : 'draft',
      entityId   : draftId,
      metadata   : {
        reason             : validation.error,
        errorCode          : 'ML_SCHEMA_INVALID',
        rawResponseSnippet : JSON.stringify(rawResponse).slice(0, 500),
        targetUrl,
      },
    });

    throw schemaErr;
  }

  // ── 5. Return validated claims ─────────────────────────────────────────────
  const { claims } = rawResponse;
  console.log(`[mlOrchestrator] ${claims.length} validated claim(s) received for org=${orgId}`);

  return claims;
}

module.exports = {
  // Core orchestration
  indexSource,
  updateSourceMetadata,
  extractClaims,
  rewriteClaim,
  extractExactRuleFindings,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RULE_REWORDINGS,

  // Response type constants
  ML_RESPONSE_TYPES,

  // Individual validators (all ML response shapes)
  validateExtractClaimsResponse,
  validateFactCheckResponse,
  validateSummariseResponse,
  validateClassifyResponse,
  validateIndexResponse,
  validateSourceIndexResponse,
  validateSimilarityResponse,
  validateRewriteResponse,

  // Sub-validators (exported for unit testing)
  validateClaim,
  validateClassLabel,
  validateSimilarityMatch,

  // Dispatcher and audit-integrated discard helper
  validateMlResponse,
  discardIfInvalid,

  // Validator registry (allows dynamic extension)
  ML_VALIDATORS,
};
