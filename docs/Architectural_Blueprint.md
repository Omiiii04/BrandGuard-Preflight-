# Architectural Blueprint

## BrandGuard Preflight — Codex 48 Hackathon (40-Hour Sprint)

> Version: 2.0 | Date: 26 October 2026
> Team: Somnath (Backend/Lead) | Falguni Sharma (Frontend) | Om Apar (AI/ML)

---

## 0. Judging Criteria Alignment Map

| Criterion                       | Points | How This Architecture Addresses It                                                                           |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| Working core workflow           | 30     | Three-layer system with strict call rule delivers upload > review > approve > publish                        |
| Technical depth and reliability | 25     | Vector retrieval, NLI entailment, schema-validated ML outputs, RBAC, tenant isolation, append-only audit log |
| Progress from Round 1           | 20     | Claim extraction, contradiction detection, Brand Passport, Redaction Gateway all new vs Round 1              |
| Three planned improvements      | 15     | Agent Gate API, Rule Simulator, Voice Fingerprint behind isolated stubs                                      |
| Usability                       | 10     | Evidence card as core UI primitive; WCAG 2.2 AA; AI-use always disclosed                                     |

---

## 1. High-Level System Architecture

Golden Rule: Browser -> Node.js Backend -> Python ML Service. The browser NEVER calls ML directly.

```
+------------------------------------------------------------------+
|                       BROWSER LAYER                              |
|                  React Application  (Falguni)                    |
|  [Upload UI]  [Intent Form]  [Evidence Cards]  [Findings Panel] |
|  [Diff/Ver]   [Comments]     [Approvals]       [Dashboard]      |
|          AI-Use Disclosure Notice (always visible)               |
+------------------------------------------------------------------+
                            |
                   HTTPS / REST API  (OpenAPI 3.1 contract)
                            |
+------------------------------------------------------------------+
|                      API / APP LAYER                             |
|              Node.js + Express Backend  (Somnath)                |
|  [Auth/JWT/RBAC]  [Workflow Engine]  [Redaction Gateway]         |
|  [ML Orchestrator]  [Version Manager]  [Audit Log]               |
|  [Passport Builder]  [Insights Aggregator]  [Shelf-Life Cron]    |
+------------------------------------------------------------------+
         |                    |                      |
         v                    v                      v
+---------------+  +--------------------+  +--------------------+
|   MongoDB     |  | Encrypted Object   |  | Python ML Service  |
|  (Somnath)    |  | Storage  (MinIO)   |  |   (Om Apar)        |
| orgs,users    |  | uploaded files     |  | FastAPI / Uvicorn  |
| sources       |  | draft exports      |  | /extract-claims    |
| passages      |  +--------------------+  | /match             |
| facts,drafts  |                          | /rewrite           |
| findings      |   only after redaction   | /premortem         |
| passports     |   only if admin allows   | /image-check       |
| auditLog      |         |                | /detect-entities   |
+---------------+         v                +--------------------+
                  +--------------------+
                  | External Language  |
                  | Model (optional)   |
                  | no-train/no-ret    |
                  +--------------------+
```

---

## 2. Complete Project File Structure

```
brandguard-preflight/
|
+-- docker-compose.yml
+-- .env.example
+-- README.md
|
+-- frontend/                  (FALGUNI)
|   +-- package.json
|   +-- vite.config.js
|   +-- index.html
|   +-- src/
|       +-- main.jsx
|       +-- App.jsx
|       +-- index.css           # design tokens
|       +-- context/
|       |   +-- AuthContext.jsx
|       |   +-- OrgContext.jsx
|       +-- api/
|       |   +-- client.js       # Axios + JWT; never points at ML
|       +-- pages/
|       |   +-- LoginPage.jsx
|       |   +-- DashboardPage.jsx
|       |   +-- KnowledgeBasePage.jsx
|       |   +-- DraftSubmitPage.jsx
|       |   +-- ReviewPage.jsx
|       |   +-- WorkflowPage.jsx
|       |   +-- PassportPage.jsx
|       +-- components/
|       |   +-- layout/
|       |   |   +-- Sidebar.jsx
|       |   |   +-- TopBar.jsx
|       |   |   +-- AIUseNotice.jsx
|       |   +-- knowledge/
|       |   |   +-- SourceUploader.jsx
|       |   |   +-- SourceList.jsx
|       |   |   +-- SourceCard.jsx
|       |   |   +-- FactEditor.jsx
|       |   |   +-- TerminologyEditor.jsx
|       |   +-- draft/
|       |   |   +-- FileUploadZone.jsx
|       |   |   +-- TextPasteEditor.jsx
|       |   |   +-- IntentForm.jsx
|       |   +-- review/
|       |   |   +-- DraftViewer.jsx
|       |   |   +-- FindingsSidebar.jsx
|       |   |   +-- EvidenceCard.jsx      # CORE PRIMITIVE
|       |   |   +-- DraftSpanHighlight.jsx
|       |   |   +-- ProofPassagePanel.jsx
|       |   |   +-- VerdictBadge.jsx
|       |   |   +-- ConfidenceBar.jsx
|       |   |   +-- SuggestedFix.jsx
|       |   |   +-- MeaningCheck.jsx
|       |   |   +-- ActionButtons.jsx
|       |   |   +-- ComparisonView.jsx
|       |   |   +-- PreMortemPanel.jsx
|       |   +-- workflow/
|       |   |   +-- VersionTimeline.jsx
|       |   |   +-- DiffView.jsx
|       |   |   +-- CommentThread.jsx
|       |   |   +-- CommentInput.jsx
|       |   |   +-- ApprovalControls.jsx
|       |   |   +-- OverrideReasonModal.jsx
|       |   +-- dashboard/
|       |   |   +-- OrgMetricsCard.jsx
|       |   |   +-- RecentDraftsTable.jsx
|       |   |   +-- InsightsPanel.jsx
|       |   |   +-- RepeatMistakesChart.jsx
|       |   |   +-- GuidelineDebuggerList.jsx
|       |   +-- passport/
|       |       +-- PassportDetails.jsx
|       |       +-- TamperCheck.jsx
|       +-- utils/
|           +-- formatters.js
|           +-- constants.js
|
+-- backend/                   (SOMNATH)
|   +-- package.json
|   +-- src/
|   |   +-- server.js
|   |   +-- config/
|   |   |   +-- db.js
|   |   |   +-- storage.js
|   |   +-- middleware/
|   |   |   +-- auth.js
|   |   |   +-- rbac.js
|   |   |   +-- orgIsolation.js
|   |   |   +-- redactionGateway.js
|   |   |   +-- uploadScan.js
|   |   |   +-- errorHandler.js
|   |   +-- routes/
|   |   |   +-- auth.js
|   |   |   +-- sources.js
|   |   |   +-- drafts.js
|   |   |   +-- findings.js
|   |   |   +-- comments.js
|   |   |   +-- approvals.js
|   |   |   +-- passports.js
|   |   |   +-- insights.js
|   |   |   +-- gate.js
|   |   +-- services/
|   |   |   +-- workflowEngine.js
|   |   |   +-- versionManager.js
|   |   |   +-- auditLogger.js
|   |   |   +-- passportBuilder.js
|   |   |   +-- mlOrchestrator.js
|   |   |   +-- insightsAggregator.js
|   |   |   +-- shelfLifeScheduler.js
|   |   +-- models/
|   |   |   +-- Organisation.js
|   |   |   +-- User.js
|   |   |   +-- Source.js
|   |   |   +-- Passage.js
|   |   |   +-- Fact.js
|   |   |   +-- Draft.js
|   |   |   +-- DraftVersion.js
|   |   |   +-- Finding.js
|   |   |   +-- Comment.js
|   |   |   +-- Passport.js
|   |   |   +-- AuditLog.js
|   |   +-- utils/
|   |       +-- hash.js
|   |       +-- diffUtil.js
|   +-- openapi.yaml
|
+-- ml_service/                (OM)
|   +-- requirements.txt
|   +-- main.py
|   +-- routers/
|   |   +-- extract.py
|   |   +-- match.py
|   |   +-- rewrite.py
|   |   +-- premortem.py
|   |   +-- image_check.py
|   |   +-- entities.py
|   +-- pipeline/
|   |   +-- parser.py
|   |   +-- claim_extractor.py
|   |   +-- embedder.py
|   |   +-- retriever.py
|   |   +-- judge.py
|   |   +-- rewriter.py
|   |   +-- meaning_check.py
|   |   +-- premortem_engine.py
|   |   +-- image_analyser.py
|   +-- schemas/
|   |   +-- responses.py
|   +-- indexes/
|   |   +-- .gitkeep
|   +-- evaluation/
|       +-- test_set.json
|       +-- evaluator.py
|
+-- docs/
    +-- Architectural_Blueprint.md
    +-- Implementation_Roadmap.md
    +-- Team_Roles.md
    +-- PRD.md
    +-- SRS.md
    +-- SDD.md
    +-- AI_Central_Memory.md
    +-- Prompt_Governance.md
    +-- UI_UX_Specification.md
```

---

## 3. Component Architecture

### 3.1 Frontend Tree (Falguni)

```
App
 +- AuthProvider
     +- OrgProvider
         +- Router
             +- LoginPage
             +- DashboardPage
             |   +- OrgMetricsCard
             |   +- RecentDraftsTable
             |   +- InsightsPanel
             |       +- RepeatMistakesChart
             |       +- GuidelineDebuggerList
             +- KnowledgeBasePage
             |   +- SourceUploader
             |   +- SourceList -> SourceCard
             |   +- FactEditor
             |   +- TerminologyEditor
             +- DraftSubmitPage
             |   +- FileUploadZone
             |   +- TextPasteEditor
             |   +- IntentForm
             +- ReviewPage
             |   +- DraftViewer
             |   +- FindingsSidebar
             |   |   +- EvidenceCard  <-- CORE PRIMITIVE
             |   |       +- DraftSpanHighlight
             |   |       +- ProofPassagePanel
             |   |       +- VerdictBadge
             |   |       +- ConfidenceBar
             |   |       +- SuggestedFix
             |   |       +- MeaningCheck
             |   |       +- ActionButtons
             |   +- ComparisonView
             |   +- PreMortemPanel
             +- WorkflowPage
             |   +- VersionTimeline + DiffView
             |   +- CommentThread + CommentInput
             |   +- ApprovalControls + OverrideReasonModal
             |   +- AIUseNotice
             +- PassportPage
                 +- PassportDetails + TamperCheck
```

### 3.2 Backend Middleware Chain (Somnath)

Every authenticated request passes through:
auth.js > orgIsolation.js > rbac.js > [redactionGateway or uploadScan] > errorHandler.js

Services hold all business logic. Routes are thin delegators only.

### 3.3 ML Pipeline (Om)

All 6 ML endpoints are internal only (never exposed to browser).
Every output is Pydantic-validated. Non-conforming outputs are discarded and logged.

---

## 4. Data Flows

### 4.1 Draft Review Flow

```
Creator
  | 1. Fill intent form + upload/paste draft
  v
React UI -> POST /v1/drafts  [HTTPS]
  v
Node.js Backend
  | 3. Verify JWT; extract orgId from token
  | 4. RBAC: creator role required
  | 5. Confidential-term tripwire (embargoed terms = block)
  | 6. Redaction gateway (watchlist terms > [REDACTED] in copy)
  | 7. Store draft + SHA-256 hash
  | 8. AuditLog: draft_submitted
  | POST /ml/extract-claims (internal)
  v
Python ML Service
  | 10. Parse document -> text + spans
  | 11. Extract claims (rules + LM)
  | 12. Retrieve passages (k-NN FAISS/Chroma per org)
  | 13. Judge: exact rules > NLI entailment > verdict + confidence
  | 14. Generate fix (LM constrained to facts + intent)
  | 15. Meaning check (kept/changed/dropped per must-say)
  | 16. Pre-mortem (4 viewpoints > riskiest line)
  | 17. Schema validate; discard non-conforming
  | Return FindingResult[]
  v
Node.js Backend
  | 18. Validate schema
  | 19. Save findings (orgId-scoped)
  | 20. Route: contradiction > creator; uncertain > reviewer
  | 21. AuditLog: review_completed
  v
React UI
  | 22. Render evidence cards
  | 23. Highlight draft with verdict colours
  | 24. Show AI-use disclosure notice
  v
Creator sees findings in under 30 seconds
```

### 4.2 Confidence Routing

| Confidence           | Verdict                   | Handler                          |
| -------------------- | ------------------------- | -------------------------------- |
| Exact rule match     | Violated                  | Creator                          |
| >= 0.85              | Supported or Contradicted | Creator; manager if Contradicted |
| 0.60-0.84            | Unclear                   | Creator; reviewer if high-risk   |
| < 0.60 or no passage | Not Found                 | Reviewer or knowledge owner      |
| Any, high-risk topic | Always queued             | Authorised reviewer              |

### 4.3 Approval and Brand Passport Flow

```
Creator accepts fixes > new version + new SHA-256 hash > status = Checked
Manager approves: passportBuilder runs
  contentHash = SHA-256(approved content)
  checksRun[] + rulesVersion + approvers[] + aiUsed
  Stored in append-only passports collection
  AuditLog: passport_created
Creator publishes > status = Published
Passport verifiable via GET /v1/passports/:id
Tamper detection: re-hash and compare at any time
```

### 4.4 Claim Shelf-Life Flow

```
Fact: { statement, value, owner, expiryDate }
node-cron daily: query facts expiring within 30 days > notify owner > AuditLog: expiry_warning
At review time: if passage.expiryDate < today > verdict = Outdated (overrides entailment)
```

---

## 5. MongoDB Data Model

| Collection    | Key Fields                                                                                              | Purpose          |
| ------------- | ------------------------------------------------------------------------------------------------------- | ---------------- |
| organisations | orgId, name, settings, watchlist[]                                                                      | Tenant root      |
| users         | userId, orgId, role, email                                                                              | RBAC             |
| sources       | sourceId, orgId, file, type, owner, version, effectiveDate, expiryDate, status                          | Knowledge base   |
| passages      | passageId, sourceId, orgId, version, page, text, embeddingRef                                           | Retrieval units  |
| facts         | factId, orgId, statement, value, owner, expiry, supersedes                                              | Claim Shelf-Life |
| drafts        | draftId, orgId, content, format, intent, author, status                                                 | Draft store      |
| draftVersions | draftVersionId, draftId, versionNumber, contentHash, diff                                               | Revision history |
| findings      | findingId, orgId, draftVersionId, span, type, verdict, confidence, proofPassageId, suggestedFix, status | Evidence cards   |
| comments      | commentId, orgId, draftId, thread, author, action, reason, timestamp                                    | Collaboration    |
| passports     | passportId, orgId, contentHash, checksRun[], rulesVersion, approvers[], aiUsed, timestamp               | Brand Passport   |
| auditLog      | eventId, orgId, eventType, actor, target, metadata, timestamp                                           | Immutable log    |

Key constraints:

- Every query includes orgId filter (orgIsolation.js middleware)
- findings violations must have proofPassageId (enforced at API layer)
- auditLog and passports are append-only (no update/delete routes)

---

## 6. Full API Reference

### Public API (/v1/ prefix)

| Method | Endpoint                       | Purpose                                  | Roles            |
| ------ | ------------------------------ | ---------------------------------------- | ---------------- |
| POST   | /v1/auth/login                 | Authenticate; return JWT                 | All              |
| POST   | /v1/sources                    | Upload guideline/fact sheet/past content | owner            |
| GET    | /v1/sources                    | List sources with version + expiry       | All              |
| GET    | /v1/sources/:id                | Get specific source                      | All              |
| POST   | /v1/facts                      | Add approved fact with owner + expiry    | owner            |
| POST   | /v1/drafts                     | Submit draft + intent form               | creator          |
| POST   | /v1/drafts/:id/review          | Trigger ML review pipeline               | creator          |
| GET    | /v1/drafts/:id/findings        | Get all evidence cards                   | creator, manager |
| PATCH  | /v1/findings/:id               | Accept/edit/dismiss with reason          | creator          |
| POST   | /v1/drafts/:id/comments        | Add threaded comment                     | All              |
| POST   | /v1/drafts/:id/approve         | Manager approves; triggers passport      | manager          |
| POST   | /v1/drafts/:id/request-changes | Send back to creator                     | manager          |
| GET    | /v1/passports/:id              | Retrieve Brand Passport                  | All              |
| GET    | /v1/insights/rules             | Per-rule flag/override counts            | manager, owner   |
| GET    | /v1/insights/mistakes          | Most-repeated finding types              | manager          |
| POST   | /v1/gate/check                 | Agent Gate (Phase 2)                     | API key          |

### Internal ML API (Backend to ML only)

| Method | Endpoint         | Owner |
| ------ | ---------------- | ----- |
| POST   | /extract-claims  | Om    |
| POST   | /match           | Om    |
| POST   | /rewrite         | Om    |
| POST   | /premortem       | Om    |
| POST   | /image-check     | Om    |
| POST   | /detect-entities | Om    |

---

## 7. ML Pipeline

```
Input: redacted content + orgId + intent

1. PARSE         parser.py          PDF/DOCX/image > text + page positions
2. EXTRACT       claim_extractor    rules + LM > Claim[]{text, span, type}
3. RETRIEVE      retriever.py       k-NN from per-org FAISS/Chroma
4. JUDGE         judge.py
     Stage 1 exact rules  > Violated (conf 1.0)
     Stage 2 NLI entail   > Supported/Contradicted/Unclear
     Expired passage      > Outdated
     No passage found     > Not Found (never a violation)
5. SUGGEST FIX   rewriter.py        LM constrained to facts + intent
6. MEANING CHECK meaning_check.py   kept/changed/dropped per must-say
7. PRE-MORTEM    premortem_engine   4 viewpoints > riskiest line
8. VALIDATE      schemas/           Pydantic; discard non-conforming

Output: FindingResult[]
```

---

## 8. Security Controls

| Threat                        | Control                                                                   |
| ----------------------------- | ------------------------------------------------------------------------- |
| Prompt injection in upload    | Text as data; fixed Pydantic schema; non-conforming discarded             |
| Cross-tenant access           | orgId on every record; separate vector index per org                      |
| Confidential text leaving org | Redaction gateway; user preview; rules-only mode                          |
| Approval beyond role          | Server-side RBAC; override requires written reason                        |
| Tampered approved content     | SHA-256 in Passport; append-only audit log                                |
| Malicious uploads             | File-type allow-list; 10 MB limit; AV scan; isolated parser               |
| Model hallucinations          | No source = no violation; schema validation; low confidence goes to human |

---

## 9. Technology Decisions

| Decision       | Chosen                         | Rationale                                  |
| -------------- | ------------------------------ | ------------------------------------------ |
| Database       | MongoDB                        | MERN familiarity; document-shaped findings |
| Vector search  | FAISS/Chroma inside ML service | Local; embeddings never leave org          |
| Judging        | Rules > NLI > LM for rewrites  | Explainable; auditable                     |
| Model hosting  | Optional external or local     | Zero-egress mode possible                  |
| Frontend       | React + Vite                   | Familiar; fast HMR                         |
| ML service     | FastAPI + Uvicorn              | Lightweight; async                         |
| Auth           | JWT                            | Stateless                                  |
| Object storage | MinIO (S3-compatible)          | Local Docker                               |

---

## 10. Docker Compose Deployment

```
services:
  web:    React app (nginx)         PORT 3000
  api:    Node.js Express backend    PORT 4000
  ml:     Python FastAPI service     PORT 8000
  mongo:  MongoDB 7                  PORT 27017 (internal)
  minio:  S3-compatible store        PORT 9000 / 9001
```

Demo: Stellara Brands synthetic data. One command: docker-compose up > localhost:3000.

---

## 11. Three Phase 2 Improvements (15 pts)

### Agent Gate API

What: External AI tools call POST /v1/gate/check before publishing and receive a Preflight verdict.
Why substantial: Closes the loop so no AI content bypasses brand review.
Architecture: Same internal ML pipeline; route stub in gate.js already committed.

### Rule Simulator

What: Test a guideline change by replaying it against the last 100 approved drafts before enabling it.
Why substantial: Turns guidelines into testable assets; prevents rule churn.
Architecture: POST /v1/rules/simulate triggers batch re-run of judge pipeline on stored draftVersion records.

### Voice Fingerprint

What: Learn brand tone from approved posts; show tone-drift metre on new drafts.
Why substantial: Longitudinal consistency checking beyond single-document rules.
Architecture: pipeline/voice_fingerprint.py; sentence-transformers infrastructure already in place.

---

*Document version: 2.0 | Hackathon: Codex 48 | 40-Hour Sprint*
