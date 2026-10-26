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
 *   - No auth headers are added; the ML service is inside the private network.
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
function postJson(targetUrl, payload, timeoutMs) {
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
function validateClaim(claim, index) {
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
function validateExtractClaimsResponse(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Response body must be a JSON object' };
  }

  if (!Array.isArray(body.claims)) {
    return { valid: false, error: 'Response must contain a "claims" array' };
  }

  for (let i = 0; i < body.claims.length; i++) {
    const result = validateClaim(body.claims[i], i);
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

/**
 * Calls the ML service POST /extract-claims endpoint with redacted content.
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
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
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
    rawResponse = await postJson(targetUrl, payload, timeoutMs);
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
  const validation = validateExtractClaimsResponse(rawResponse);

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
  extractClaims,
  DEFAULT_TIMEOUT_MS,

  // Response type constants
  ML_RESPONSE_TYPES,

  // Individual validators (all ML response shapes)
  validateExtractClaimsResponse,
  validateFactCheckResponse,
  validateSummariseResponse,
  validateClassifyResponse,
  validateIndexResponse,
  validateSimilarityResponse,

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
