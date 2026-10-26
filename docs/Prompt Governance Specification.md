# Prompt Governance Specification
## BrandGuard Preflight — Codex 48 Hackathon (40-Hour Sprint)

> Version: 2.0 | Date: 26 October 2026
> Owner: Om Apar (AI/ML Specialist) with Somnath (Security Review)
> Implementation files: ml_service/routers/, ml_service/schemas/responses.py, backend/src/middleware/redactionGateway.js

---

## 0. Judging Criteria Alignment

| Criterion | Points | How This Document Addresses It |
|---|---|---|
| Working core workflow | 30 | Prompt governance ensures the ML pipeline runs reliably and produces usable findings |
| Technical depth and reliability | 25 | Schema validation, anti-injection design, OWASP LLM Top 10 compliance |
| Progress from Round 1 | 20 | Redaction gateway, rules-only mode, disclosure requirements all new vs Round 1 |
| Three planned improvements | 15 | All three Phase 2 improvements follow the same prompt governance rules |
| Usability | 10 | AI-use disclosure is a mandatory governance requirement — judges always know what AI did |

---

## 1. Purpose and Scope

This document specifies how BrandGuard Preflight governs every prompt sent to a language model.
Prompt governance covers:
1. What data is allowed to reach a language model (redaction and content filtering)
2. How prompts are structured (separation of instructions from user data)
3. How outputs are validated (schema gates and rejection rules)
4. How the model can be disabled entirely (rules-only mode)
5. How AI use is disclosed to users and recorded permanently (transparency requirements)

These rules apply to every ML pipeline call — whether the model is a local model or an external provider.
They apply in the 40-hour hackathon sprint and in any Phase 2 improvements.

---

## 2. Fundamental Governance Rules

### Rule G-1: No Source, No Violation
A language model output MUST NOT be saved as a finding of type "violation" without a cited
proofPassageId from the organisation's own source memory.
If the model cannot ground its output in a retrieved passage, the finding is stored as
type "question" and routed to a human. Implementation: Pydantic validator in schemas/responses.py.

### Rule G-2: Uploaded Text Is Data, Never Instructions
Uploaded documents are passed to the model as data within a strictly structured prompt.
The model is never shown a system prompt that refers to user content as "instructions to follow".
The model receives no tools that could be invoked by hostile instructions in the document.
Implementation: explicit delimiters in all 4 prompt templates.

### Rule G-3: Outputs Must Match a Fixed Schema
Every model output is validated against a Pydantic schema before being accepted by the system.
Outputs that do not match the schema are silently discarded, logged as a schema rejection event
in the AuditLog, and a safe empty result is returned to the Node.js backend.
Implementation: ml_service/schemas/responses.py.

### Rule G-4: Low Confidence Is a Human Decision
Any model output with confidence below 0.60 is classified as "Not Found" and sent to a human reviewer.
No low-confidence output is ever shown as a definitive finding.
Implementation: judge.py confidence routing logic.

### Rule G-5: High-Risk Topics Always Get a Human Reviewer
Findings on legal, health, financial, or comparative advertising topics are always routed to
an authorised reviewer, regardless of the model's confidence score.
Implementation: workflowEngine.js topic classification.

### Rule G-6: Model Can Always Be Turned Off
The system MUST function with all model calls disabled (rules-only mode).
In rules-only mode: exact rule checks run; retrieval works; no LM completion calls are made.
The core workflow is not broken.
Implementation: org settings rules_only flag; mlOrchestrator.js checks before calling FastAPI.

### Rule G-7: External Calls Require Explicit Permission
No content is sent to an external language model unless:
- An admin has explicitly enabled external model calls for the organisation (org settings)
- The content has passed through the redaction gateway
- A preview of what would be sent is shown to the user before the call
Implementation: redactionGateway.js (middleware chain); redaction preview endpoint.

---

## 3. Redaction Gateway (backend/src/middleware/redactionGateway.js)

All content MUST pass through the redaction gateway before any external model call.
The gateway runs in the Node.js backend before any call to FastAPI that would forward content externally.

### 3.1 Redaction Steps

```
Original draft content
        |
Step 1: Confidential-term tripwire check
   Exact match against org watchlist (Organisation.watchlist[] in MongoDB)
   Embargoed terms, codenames, client names
   If match: BLOCK. Do not proceed. Alert creator. AuditLog: confidential_term_blocked
        |
Step 2: Entity detection (entities.py result used by gateway)
   spaCy NER for: personal names, phone numbers, email addresses, ID numbers
   Replace with: [PERSON], [PHONE], [EMAIL], [ID]
        |
Step 3: Org-specific sensitive category replacement
   Configured by admin in org settings
   e.g. unreleased product names > [PRODUCT_CODENAME]
   e.g. internal project names > [PROJECT_NAME]
        |
Step 4: Generate redacted preview
   Show creator modal: "The following content would be sent to [Provider Name]:"
   Redacted content displayed with placeholders highlighted in amber
   "What was removed" summary list
   Two buttons: "Proceed with External Review" | "Use Rules-Only Mode Instead"
        |
Step 5: User acknowledges or declines
   If Proceed: redacted content sent to ml_service; original content never leaves org
   If Decline: rules-only mode activated; no external call made
```

### 3.2 Redaction Preview UI (implemented by Falguni in ReviewPage.jsx)

The preview modal shows:
- Provider name and what type of data it receives
- The redacted draft with substituted placeholders highlighted in amber
- "What was removed" summary list (number of terms removed by category)
- Two action buttons: Proceed with External Review | Use Rules-Only Mode Instead

---

## 4. Prompt Templates (ml_service/routers/ and pipeline/)

### 4.1 Claim Extraction Prompt (/extract-claims endpoint; routers/extract.py)

Design: System instructions separated from user data by explicit delimiters.
User data appears only between ---CONTENT START--- and ---CONTENT END--- markers.

```
SYSTEM PROMPT (never modified by user input):
You are a claim extraction assistant for a brand compliance tool.
Your task is to extract checkable claims from the CONTENT below.

Checkable claims include:
- Numerical facts (prices, percentages, dates, quantities)
- Named entities (product names, company names, place names)
- Comparative or superlative statements (best, largest, fastest, only, most)
- Policy statements (return periods, warranty terms, guarantees)
- Promotional promises

Do NOT include: opinions, subjective descriptions, or tone observations.

Output MUST be a JSON array matching this schema exactly:
[{ "claim": "string", "span_start": int, "span_end": int, "type": "string" }]

If you cannot extract any claims, return an empty array: []
Do not add any text outside the JSON array.

---CONTENT START---
{REDACTED_DRAFT_CONTENT}
---CONTENT END---
```

Anti-injection measures:
- Delimiters signal to the validator that anything between them is user data, not instructions
- Model receives no tools (no function calling, no code execution)
- Output containing the delimiter strings is rejected as prompt leakage

### 4.2 Entailment / Judgement Prompt (/match endpoint; routers/match.py, pipeline/judge.py)

```
SYSTEM PROMPT:
You are a fact-checking assistant for a brand compliance tool.
Given a CLAIM and a SOURCE PASSAGE, determine whether the passage supports,
contradicts, or is irrelevant to the claim.

You MUST output ONLY a JSON object matching this schema exactly:
{
  "verdict": "Supported" | "Contradicted" | "Irrelevant",
  "confidence": <float between 0.0 and 1.0>,
  "reason": "<one sentence explaining your verdict>"
}

Do not output any text outside the JSON object.

---CLAIM---
{CLAIM_TEXT}
---END CLAIM---

---SOURCE PASSAGE---
(Source: {SOURCE_FILE}, page {SOURCE_PAGE}, version {SOURCE_VERSION},
 expires {SOURCE_EXPIRY}, owner {SOURCE_OWNER})
{PASSAGE_TEXT}
---END SOURCE PASSAGE---
```

Note: For the primary entailment model (cross-encoder/nli-deberta-v3-base) the structured prompt
format is replaced by the cross-encoder's direct scoring API. The structured prompt above is used
only when the external LM path is activated and the NLI model is not available.

### 4.3 Fix Generation Prompt (/rewrite endpoint; routers/rewrite.py, pipeline/rewriter.py)

```
SYSTEM PROMPT:
You are a writing assistant for a brand compliance tool.
Your job is to suggest a minimal fix for a FLAGGED SENTENCE that:
1. Uses only facts from the APPROVED PASSAGES provided
2. Preserves the creator's INTENT (purpose and must-say points)
3. Changes as little as possible

You MUST output ONLY a JSON object matching this schema exactly:
{
  "suggested_fix": "<revised sentence>",
  "meaning_check": {
    "kept": ["<must-say point>", ...],
    "changed": ["<original> > <revised>", ...],
    "dropped": ["<missing must-say point>", ...]
  }
}

---FLAGGED SENTENCE---
{FLAGGED_SENTENCE}
---END FLAGGED SENTENCE---

---APPROVED PASSAGES---
{APPROVED_PASSAGE_1}
{APPROVED_PASSAGE_2}
---END APPROVED PASSAGES---

---CREATOR INTENT---
Purpose: {INTENT_PURPOSE}
Audience: {INTENT_AUDIENCE}
Must-say points: {MUST_SAY_POINTS}
---END CREATOR INTENT---
```

### 4.4 Pre-Mortem Prompt (/premortem endpoint; routers/premortem.py, pipeline/premortem_engine.py)

One call per viewpoint (4 calls total). Highest-confidence output across all 4 is returned.

```
SYSTEM PROMPT:
You are a risk analyst for a brand compliance tool.
Review the DRAFT below from the perspective of a {VIEWPOINT}.

Viewpoint definitions:
- regulator: Someone looking for claims that violate advertising standards or consumer protection rules
- journalist: Someone looking for the single most quotable, potentially embarrassing sentence
- competitor: Someone looking for claims usable in comparative advertising against this brand
- screen-reader: Someone relying on a screen reader, looking for accessibility failures

Identify the SINGLE highest-risk sentence from this viewpoint.

You MUST output ONLY a JSON object matching this schema exactly:
{
  "riskiest_span": "<exact sentence from the draft — must be verbatim>",
  "viewpoint": "{VIEWPOINT}",
  "reason": "<one sentence explaining why this is the riskiest>",
  "confidence": <float between 0.0 and 1.0>
}

---DRAFT---
{REDACTED_DRAFT_CONTENT}
---END DRAFT---
```

---

## 5. Output Validation (schemas/responses.py)

### 5.1 Pydantic Schema Definitions

| Output Type | Required Fields | Type Constraints | Non-conforming Action |
|---|---|---|---|
| Claim extraction | claim (str), span_start (int), span_end (int), type (str) | JSON array | Discard; return [] |
| Entailment | verdict (enum), confidence (float 0-1), reason (str) | JSON object | Discard; return Not Found |
| Fix generation | suggested_fix (str), meaning_check (obj with kept/changed/dropped) | JSON object | Discard; no fix shown |
| Pre-mortem | riskiest_span (str), viewpoint (str), reason (str), confidence (float) | JSON object | Discard; no pre-mortem shown |

### 5.2 Content Rejection Rules (applied after schema validation)

After schema validation passes, the output is also rejected if:

1. PROMPT LEAKAGE: Output contains any of the delimiter strings (---CONTENT START---, ---END CLAIM---, etc.)
2. RISKIEST SPAN HALLUCINATION: The riskiest_span in a pre-mortem output cannot be found verbatim in the original draft
3. FACT INVENTION IN FIX: The suggested_fix contains specific named facts (numbers, percentages, dates) not present in either the approved passages or the original flagged sentence
4. TYPE COERCION ATTACK: confidence is a string rather than a float
5. VERDICT MISMATCH: verdict value is not in the allowed enum (Supported, Contradicted, Outdated, Not Found, Unclear, Violated, Irrelevant)

### 5.3 Rejection Logging

All rejections logged to AuditLog (backend/src/services/auditLogger.js) with:
- eventType: ml_response_discarded
- rejectionReason: schema | prompt_leakage | hallucination | fact_invention | type_coercion
- endpoint: which ML endpoint generated the output
- orgId: for incident analysis
- timestamp

Rejected outputs are NEVER shown to users.
The finding is created as type "question" with verdict "Not Found" and routed to the appropriate reviewer.

---

## 6. Disclosure Requirements

### 6.1 Per-Review Disclosure (AIUseNotice.jsx)

Every review result page MUST display (always visible, cannot be dismissed):
```
"This review used AI assistance.
 Findings are checked against your uploaded sources only.
 External services used: [Provider Name / None].
 Final decisions are made by you."
```

The notice is:
- Persistent (no dismiss button)
- Visible without scrolling (placed in TopBar or bottom of page)
- Screen-reader accessible (ARIA role="status")

### 6.2 Per-Finding Disclosure (VerdictBadge.jsx)

Each evidence card shows one of two badges:
- "Rule" badge (blue): finding came from an exact rule match (confidence = 1.0; no model involved)
- "AI" badge (purple): finding came from a model (NLI entailment or LM completion)

### 6.3 Per-Version Disclosure (passportBuilder.js + PassportDetails.jsx)

The Brand Passport for every approved asset permanently records:
- aiUsed: true | false
- externalProviderUsed: "Provider Name" | null
- checksRun: ["rules", "claim-extraction", "retrieval", "entailment", "fix-generation", "premortem"]

This creates a permanent, auditable record of how AI was used in producing every approved piece of content.
Verifiable at any future time via GET /v1/passports/:id.

### 6.4 Org-Level Disclosure (Org Settings Page)

The organisation settings page lists:
- Every external service connected (model providers and their API endpoints)
- What data each service receives (redacted content only; no raw confidential data)
- Whether no-training and no-retention terms are in effect for each provider
- Timestamp of when external services were last used for a review

---

## 7. Rules-Only Mode

In rules-only mode (org settings: rules_only = true OR model provider unavailable):
- All LM API calls are skipped: /extract-claims (LM step), /rewrite, /premortem
- Exact rule checks still run in judge.py Stage 1: banned terms, superlatives, alt text, contrast
- Vector retrieval still runs: retrieved passages are shown as "relevant context" without an AI-generated verdict
- Claim extraction uses rules-only patterns from claim_extractor.py (no LM step)
- All findings are classified as type "question" and routed to reviewers
- The AI-use notice reads: "This review ran in rules-only mode. No AI model was used."
- Rules-only mode is the default for new organisations until admin explicitly enables external model use

---

## 8. OWASP LLM Top 10 Compliance

| OWASP Risk | Control in Preflight | Implementation File |
|---|---|---|
| LLM01: Prompt Injection | Uploaded text passed as delimited data; model has no tools; schema validated; prompt-keyword rejection | routers/*.py, schemas/responses.py |
| LLM02: Insecure Output Handling | Fixed JSON schema; output never rendered as HTML; no eval(); structured output only | schemas/responses.py, frontend API client.js |
| LLM03: Training Data Poisoning | No training on customer content; provider terms enforce this; architecture prevents it | Architecture (golden rule: no direct browser-ML contact) |
| LLM04: Model Denial of Service | Request size limits (10 MB upload); timeout enforced (5s ML call); per-org rate limiting | uploadScan.js, mlOrchestrator.js |
| LLM05: Supply-Chain Vulnerabilities | Pinned model versions in requirements.txt; no dynamic model loading; provider vetted for no-training terms | requirements.txt |
| LLM06: Sensitive Information Disclosure | Redaction gateway before any external call; per-org data isolation; no cross-org vector queries | redactionGateway.js, retriever.py |
| LLM07: Insecure Plugin Design | No plugins or tools exposed to the model; model has no function calling | All prompt templates |
| LLM08: Excessive Agency | Model never publishes, approves, sends, or takes any external action; all actions are opt-in by humans | workflowEngine.js; RBAC on all action endpoints |
| LLM09: Overreliance | AI-use notice; confidence always shown; wrong findings feed back to test set; rules-only mode | AIUseNotice.jsx, ConfidenceBar.jsx, evaluation/evaluator.py |
| LLM10: Model Theft | Model API keys in environment variables only; not in code or logs; .env.example in repo | .env.example, config files |

---

## 9. Compliance with No-Training Terms

Every external language model provider used with BrandGuard Preflight MUST have in effect:
1. No-training clause: the provider must not use submitted content to train or fine-tune any model.
2. No-retention clause: submitted content must not be stored beyond the current request.
3. Data processing agreement: must cover the org's jurisdiction.

These are verified and documented in the org settings page before the first external call.
The architecture enforces this additionally by: sending only redacted content; keeping all
retrieval and indexing local; and making rules-only mode always available as a fallback.

---

*Document version: 2.0 | Hackathon: Codex 48 | 40-Hour Sprint*
