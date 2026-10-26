# System Design Document (SDD)
## BrandGuard Preflight — Codex 48 Hackathon (40-Hour Sprint)

> Version: 2.0 | Date: 26 October 2026
> Team: Somnath (Backend/Lead) | Falguni Sharma (Frontend) | Om Apar (AI/ML)

---

## 0. Judging Criteria Alignment

| Criterion | Points | Design Decisions That Address It |
|---|---|---|
| Working core workflow | 30 | State machine (Draft > Published), ML orchestration, three-layer call rule |
| Technical depth and reliability | 25 | NLI entailment, FAISS/Chroma per-org vector index, SHA-256 passport, append-only audit log |
| Progress from Round 1 | 20 | Contradiction engine (past content indexed), Brand Passport, Redaction Gateway, Claim Shelf-Life all new |
| Three planned improvements | 15 | Agent Gate API (gate.js stub), Rule Simulator (batch judge re-run), Voice Fingerprint (style embedding) |
| Usability | 10 | Evidence card as core primitive, WCAG 2.2 AA, AI-use always disclosed |

---

## 1. System Architecture Overview

### 1.1 Layered Architecture

```
+--------------------------------------------------+
|   Browser: React UI  (Falguni)                   |
|  Upload | Evidence Cards | Diff View | Dashboard  |
|  Comments | Approvals | AI-Use Notice             |
+--------------------------------------------------+
                   | REST API (OpenAPI 3.1 contract)
                   v
+--------------------------------------------------+
|   Node.js + Express Backend  (Somnath)           |
|  Auth (JWT) | RBAC | Org Isolation               |
|  Workflow Engine | Version Manager                |
|  Redaction Gateway | ML Orchestrator              |
|  Audit Logger | Passport Builder                 |
|  Insights Aggregator | Shelf-Life Cron            |
+-------------------+------------------------------+
                    |              |
           +--------+     +--------+--------+
           v               v                v
    +----------+   +---------------+  +---------------+
    | MongoDB  |   | Encrypted     |  | Python ML     |
    | (Somnath)|   | Object Store  |  | Service (Om)  |
    | 11 colls |   | MinIO         |  | FastAPI       |
    +----------+   +---------------+  | /extract-claims|
                                      | /match        |
                                      | /rewrite      |
                                      | /premortem    |
                                      | /image-check  |
                                      | /detect-entities|
                                      +------+--------+
                                             |
                                  only after redaction
                                  only if admin allows
                                             v
                                  +--------------------+
                                  | External Language  |
                                  | Model (optional)   |
                                  | no-training terms  |
                                  +--------------------+
```

Critical rule: The browser NEVER calls the ML service directly.
All ML calls are proxied through the Node.js backend, which applies auth, orgId isolation, and redaction first.

### 1.2 Ownership by Layer

| Layer | Technology | Owner | Key Files |
|---|---|---|---|
| Frontend | React + Vite | Falguni | frontend/src/pages/, components/ |
| API Layer | REST + OpenAPI 3.1 | Somnath | backend/openapi.yaml |
| Server | Node.js + Express | Somnath | backend/src/server.js, routes/, services/ |
| Database | MongoDB (Mongoose) | Somnath | backend/src/models/ |
| Auth and Security | JWT, RBAC, orgId isolation | Somnath | backend/src/middleware/ |
| File Storage | MinIO (S3-compatible) | Somnath | backend/src/config/storage.js |
| Parsing and OCR | PyMuPDF, python-docx, Tesseract | Om | ml_service/pipeline/parser.py |
| Retrieval | sentence-transformers + FAISS/Chroma | Om | ml_service/pipeline/embedder.py, retriever.py |
| Judging | Exact rules > NLI entailment > confidence | Om | ml_service/pipeline/judge.py |
| Fix Generation | LM constrained to retrieved facts | Om | ml_service/pipeline/rewriter.py, meaning_check.py |
| Pre-mortem | 4-viewpoint structured prompts | Om | ml_service/pipeline/premortem_engine.py |
| Image Checks | OpenCV | Om | ml_service/pipeline/image_analyser.py |
| ML Service Wrapper | FastAPI + Uvicorn | Om | ml_service/main.py, routers/ |

---

## 2. MongoDB Data Model (11 Collections)

### 2.1 organisations

```json
{
  "orgId": "ObjectId",
  "name": "string",
  "settings": {
    "allowExternalModel": "boolean",
    "retentionDays": "number",
    "rules_only": "boolean"
  },
  "watchlist": ["string"]
}
```

### 2.2 users

```json
{
  "_id": "ObjectId",
  "orgId": "ObjectId",
  "email": "string",
  "passwordHash": "string",
  "role": "creator | manager | reviewer | owner",
  "createdAt": "Date"
}
```

### 2.3 sources

```json
{
  "_id": "ObjectId",
  "orgId": "ObjectId",
  "storageRef": "string",
  "type": "guideline | fact-sheet | glossary | past-content | asset",
  "owner": "UserId",
  "version": "string",
  "effectiveDate": "Date",
  "expiryDate": "Date",
  "status": "active | expired | superseded"
}
```

### 2.4 passages

```json
{
  "_id": "ObjectId",
  "sourceId": "ObjectId",
  "orgId": "ObjectId",
  "version": "string",
  "page": "number",
  "text": "string",
  "embeddingRef": "string"
}
```

### 2.5 facts

```json
{
  "_id": "ObjectId",
  "orgId": "ObjectId",
  "statement": "string",
  "value": "string",
  "evidenceLink": "ObjectId (passages._id)",
  "owner": "UserId",
  "expiryDate": "Date",
  "supersedes": "ObjectId (previous fact)"
}
```

### 2.6 drafts

```json
{
  "_id": "ObjectId",
  "orgId": "ObjectId",
  "author": "UserId",
  "status": "draft | checked | in-review | approved | published",
  "format": "text | docx | pdf",
  "intent": {
    "purpose": "string",
    "audience": "string",
    "mustSay": ["string"]
  }
}
```

### 2.7 draftVersions

```json
{
  "_id": "ObjectId",
  "draftId": "ObjectId",
  "orgId": "ObjectId",
  "versionNumber": "number",
  "content": "string",
  "contentHash": "string (SHA-256)",
  "diff": "string (vs previous version)",
  "createdAt": "Date"
}
```

### 2.8 findings

```json
{
  "_id": "ObjectId",
  "orgId": "ObjectId",
  "draftVersionId": "ObjectId",
  "span": { "start": "number", "end": "number" },
  "type": "violation | question",
  "verdict": "Supported | Contradicted | Outdated | Not Found | Unclear",
  "confidence": "number (0.0-1.0)",
  "proofPassageId": "ObjectId (REQUIRED if type=violation)",
  "suggestedFix": "string",
  "meaningCheck": {
    "kept": ["string"],
    "changed": ["string"],
    "dropped": ["string"]
  },
  "status": "open | accepted | edited | dismissed | escalated",
  "ruleId": "string (if exact rule)"
}
```

### 2.9 comments

```json
{
  "_id": "ObjectId",
  "orgId": "ObjectId",
  "draftId": "ObjectId",
  "findingId": "ObjectId (optional)",
  "thread": [
    { "author": "UserId", "text": "string", "timestamp": "Date" }
  ],
  "action": "comment | approve | request-changes | override",
  "reason": "string (required for override)"
}
```

### 2.10 passports (append-only)

```json
{
  "_id": "ObjectId",
  "orgId": "ObjectId",
  "draftId": "ObjectId",
  "contentHash": "string (SHA-256 of approved content)",
  "checksRun": ["string"],
  "rulesVersion": "string",
  "approvers": ["UserId"],
  "aiUsed": "boolean",
  "timestamp": "Date"
}
```

### 2.11 auditLog (append-only)

```json
{
  "_id": "ObjectId",
  "orgId": "ObjectId",
  "actor": "UserId",
  "eventType": "string",
  "entityType": "string",
  "entityId": "ObjectId",
  "metadata": "Object",
  "timestamp": "Date"
}
```

Key constraints:
- Every query includes orgId filter (enforced by orgIsolation.js middleware)
- findings of type violation must have proofPassageId (enforced in findings.js route)
- passports and auditLog have no PATCH or DELETE routes (append-only)
- orgId is always extracted from JWT claims, never from request body

---

## 3. API Endpoints

### Source Management
| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | /v1/sources | owner | Upload and index approved material |
| GET | /v1/sources | All | List org sources with version + expiry |
| GET | /v1/sources/:id | All | Get source metadata and version history |
| PATCH | /v1/sources/:id | owner | Update owner, expiry date, or status |

### Draft and Review
| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | /v1/drafts | creator | Submit draft with intent form |
| POST | /v1/drafts/:id/review | creator | Trigger review run on latest version |
| GET | /v1/drafts/:id | All | Get draft metadata and status |
| GET | /v1/drafts/:id/versions | All | Get version history with diffs |
| GET | /v1/drafts/:id/findings | creator, manager | Get all evidence cards |
| PATCH | /v1/findings/:id | creator | Accept, edit, or dismiss a finding with reason |

### Collaboration and Approval
| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | /v1/drafts/:id/comments | All | Add threaded comment |
| POST | /v1/drafts/:id/approve | manager | Approve draft; triggers passport builder |
| POST | /v1/drafts/:id/request-changes | manager | Send back to creator |

### Facts
| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | /v1/facts | owner | Add an approved fact with owner + expiry |
| GET | /v1/facts | All | List org facts |

### Brand Passport
| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | /v1/passports/:id | All | Retrieve Brand Passport |

### Insights
| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | /v1/insights/rules | manager, owner | Rules ranked by override rate; Guideline Debugger data |
| GET | /v1/insights/mistakes | manager | Most repeated mistake categories |

### Agent Gate (Phase 2)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | /v1/gate/check | API key | External AI tool gets Preflight verdict before publishing |

### Internal ML API (Backend to ML Service Only)
| Method | Endpoint | Owner |
|---|---|---|
| POST | /extract-claims | Om |
| POST | /match | Om |
| POST | /rewrite | Om |
| POST | /premortem | Om |
| POST | /image-check | Om |
| POST | /detect-entities | Om |

---

## 4. ML Pipeline Design

### 4.1 Seven Pipeline Stages

| Stage | Implementation | Owner |
|---|---|---|
| 1. Parse | PyMuPDF (PDF), python-docx (DOCX), Tesseract OCR (images) | Om |
| 2. Extract Claims | Regex + keyword rules + small LM step for ambiguous phrases | Om |
| 3. Retrieve | multilingual sentence-transformers; k-NN from per-org FAISS/Chroma; filter by orgId, expiry, version | Om |
| 4. Judge (Stage 1) | Exact rules: banned terms, banned superlatives, low contrast / no alt text; confidence = 1.0 | Om |
| 4. Judge (Stage 2) | NLI: cross-encoder/nli-deberta-v3-base; entails > Supported, contradicts > Contradicted, neutral > Unclear | Om |
| 5. Suggest Fix | LM prompt constrained to retrieved passages + must-say list; meaning_check.py compares result | Om |
| 6. Pre-mortem | 4 structured prompts; fixed JSON output; highest-risk line returned | Om |
| 7. Image Check | OpenCV: palette extraction, WCAG contrast formula, alt text detection | Om |

### 4.2 Schema Validation (Critical for Reliability)

All 6 ML endpoints return Pydantic-validated JSON.
Non-conforming outputs raise ValidationError, which is caught by the router, logged as AuditLog event:
ml_response_discarded, and a safe empty result is returned.
This ensures no hallucinated findings ever reach the UI.

### 4.3 Confidence Thresholds

| Confidence | Verdict | Handler |
|---|---|---|
| Exact rule match | Violated (conf 1.0) | Creator |
| >= 0.85 | Supported or Contradicted | Creator; manager if Contradicted |
| 0.60 to 0.84 | Unclear | Creator; reviewer if high-risk |
| < 0.60 or no passage | Not Found | Reviewer or knowledge owner |
| Any + high-risk topic | Always queued | Authorised reviewer |

---

## 5. Security Architecture

### 5.1 Threat Model and Controls

| Threat | Control | Location |
|---|---|---|
| Prompt injection via uploaded document | Text as data only; fixed Pydantic schema; non-conforming outputs discarded | schemas/responses.py, judge.py |
| Cross-tenant data access | orgId on every record; every query filtered; separate vector index per org | orgIsolation.js, retriever.py |
| Confidential text sent to external model | Redaction gateway; user preview; rules-only mode | redactionGateway.js |
| Approval beyond authorised role | Server-side RBAC; overrides require written reason; logged | rbac.js, approvals.js |
| Tampered approved content | SHA-256 in passport; append-only audit log | passportBuilder.js |
| Malicious or oversized uploads | File-type allow-list; 10 MB limit; AV scan; isolated parser process | uploadScan.js |
| Model hallucinations | No source = no violation; schema validation; low confidence goes to human | judge.py, findings.js |

### 5.2 Data Flow Security Sequence

1. Creator uploads file > uploadScan.js (type + size + AV) > encrypted storage in MinIO
2. Review triggered > auth.js (verify JWT) > orgIsolation.js (inject orgId) > rbac.js (verify creator role)
3. redactionGateway.js replaces watchlist terms with [REDACTED] in content copy
4. mlOrchestrator.js sends ONLY the redacted copy to FastAPI
5. FastAPI pipeline runs > Pydantic validates all outputs > non-conforming discarded
6. Findings returned > findings.js validates proofPassageId > saved to MongoDB (orgId-scoped)
7. Every step: auditLogger.js appends immutable event to auditLog collection

---

## 6. Review Lifecycle State Machine

```
Draft
  |
  v (creator submits + review completes)
Checked
  |
  +-- No open findings > Approved (skip In Review)
  |
  v (has open findings)
In Review
  |
  +-- Creator fixes > new DraftVersion created > back to Checked
  |
  +-- Waiting on owner (source expired or sources disagree) > [Blocked]
  |
  +-- Confidential-term tripwire triggered > [Blocked: cannot go external]
  |
  v (manager POST /v1/drafts/:id/approve)
Approved
  > passportBuilder.js creates Brand Passport (SHA-256 + checksRun + approvers + aiUsed)
  > AuditLog event: passport_created
  |
  v (creator or manager sets Published)
Published
  > Passport verifiable at any time via GET /v1/passports/:id
  > Tamper detection: re-hash and compare
```

---

## 7. End-to-End Example: Returns Policy Error (Demo Story)

1. Knowledge Owner uploads Returns Policy v2.pdf (owner: Support, expires 31 Mar 2027).
   Parser extracts passages; embedder indexes page 3 ("30 days") in per-org FAISS index.

2. Creator (Priya) submits draft "Free returns within 14 days." with intent:
   purpose = promotional post, audience = existing customers, must-say = [free returns, time limit].
   SHA-256 hash stored with DraftVersion v1.

3. ML Pipeline:
   - claim_extractor finds claim "14 days" (type: temporal)
   - retriever fetches top-3 passages; page 3 of Returns Policy v2 is top result
   - judge.py Stage 2 NLI: "14 days" vs "30 days" > Contradicted (confidence: 0.92)
   - rewriter.py generates fix: "Free returns within 30 days."
   - meaning_check: kept = [free returns, time limit]; changed = [14 days > 30 days]; dropped = []
   - Pre-mortem: regulator viewpoint surfaces "14 days" as the riskiest line
   - Pydantic schema validates all outputs before returning

4. Evidence card displayed to Priya:
   Draft: "Free returns within 14 days." | Verdict: Contradicted (92%) |
   Proof: Returns Policy v2, page 3, expires 31 Mar 2027 |
   Fix: "Free returns within 30 days." |
   Meaning check: kept = free returns + time limit; changed = 14 > 30 days; dropped = nothing

5. Priya accepts fix.
   Finding status = accepted. New DraftVersion v2 created. SHA-256 updated. AuditLog: finding_accepted.

6. Manager approves via POST /v1/drafts/:id/approve.
   passportBuilder.js: contentHash = SHA-256(v2 content), checksRun = [claim_match, contradiction, rules, premortem],
   rulesVersion = v1.2, approvers = [managerId], aiUsed = true.
   Passport stored in append-only collection. AuditLog: passport_created.

7. All 7 actions appear in the immutable auditLog. Passport verifiable at any future time.

---

*Document version: 2.0 | Hackathon: Codex 48 | 40-Hour Sprint*
