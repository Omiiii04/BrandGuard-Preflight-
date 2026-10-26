# Software Requirements Specification (SRS)
## BrandGuard Preflight — Codex 48 Hackathon (40-Hour Sprint)

> Version: 2.0 | Date: 26 October 2026
> Team: Somnath (Backend/Lead) | Falguni Sharma (Frontend) | Om Apar (AI/ML)

---

## 0. Judging Criteria Coverage

| Criterion | Points | Requirements That Address It |
|---|---|---|
| Working core workflow | 30 | FR-KB, FR-DS, FR-RD, FR-EC, FR-WF, FR-AP all together define the complete flow |
| Technical depth and reliability | 25 | FR-RD-03 (vector retrieval), FR-RD-04 (NLI entailment), FR-AP-02 (append-only passport), NFR-S-03/S-04/S-05 |
| Progress from Round 1 | 20 | FR-RD-05 (contradiction), FR-KB-06 (past content), FR-AP-01 (passport), FR-PS-02 (redaction) all new |
| Three planned improvements | 15 | FR-PH2-01 (Agent Gate), FR-PH2-02 (Rule Simulator), FR-PH2-03 (Voice Fingerprint) |
| Usability | 10 | FR-EC-01 to FR-EC-05, FR-PS-06 (AI notice), NFR-A-01 to NFR-A-03 |

---

## 1. Introduction

### 1.1 Purpose
This document specifies the functional and non-functional requirements for BrandGuard Preflight.
It serves as the contract between product, engineering, and ML functions during the 40-hour sprint.

### 1.2 Scope
BrandGuard Preflight checks content drafts against an organisation's approved guidelines, facts,
and published history before publication. It produces evidence-bound findings, routes uncertain
items to the correct human, and records every decision in an immutable audit log.

### 1.3 Definitions

| Term | Definition |
|---|---|
| Draft | Content submitted for review (text, DOCX, PDF) |
| Source | Organisation-approved document: guidelines, fact sheet, glossary, past content |
| Finding | A flagged item from the review — always contains verdict, confidence, and proof passage |
| Evidence Card | UI component showing draft sentence, proof passage, verdict, and suggested fix |
| Brand Passport | Tamper-evident record of an approved asset: checks run, rules version, approvers, AI-use flag, SHA-256 hash |
| Claim Shelf-Life | Mechanism by which every approved fact carries an owner and expiry date |
| Intent Lock | Mechanism that records creator's stated purpose and verifies each fix preserves it |
| Verdict | One of: Supported / Contradicted / Outdated / Not Found / Unclear |
| proofPassageId | MongoDB ObjectId of the passage record that a finding cites as proof |
| orgId | Organisation identifier; enforced on every query for tenant isolation |

---

## 2. Functional Requirements

### FR-KB: Knowledge Base Management

| ID | Requirement | Priority | Owner |
|---|---|---|---|
| FR-KB-01 | System SHALL allow knowledge owners and admins to upload sources in PDF, DOCX, and Markdown formats | Must | Somnath (storage + API), Om (parsing) |
| FR-KB-02 | Every uploaded source SHALL store: owner (userId), version identifier, effective date, and expiry date | Must | Somnath |
| FR-KB-03 | System SHALL allow manual definition of approved facts, terminology, claim evidence, and glossary entries | Must | Somnath |
| FR-KB-04 | System SHALL warn the source owner 30 days before any fact or source expires via an in-app notification and AuditLog event | Must | Somnath (shelfLifeScheduler.js) |
| FR-KB-05 | System SHALL mark any finding against an expired source with verdict Outdated | Must | Om (judge.py) |
| FR-KB-06 | Past approved published content SHALL be indexed alongside guideline documents to enable contradiction detection | Must | Om (embedder.py + retriever.py) |
| FR-KB-07 | System SHALL support per-org vector index isolation (one FAISS/Chroma index per orgId) | Must | Om (embedder.py) |

### FR-DS: Draft Submission and Intent Capture

| ID | Requirement | Priority | Owner |
|---|---|---|---|
| FR-DS-01 | A creator SHALL be able to submit a draft via file upload (DOCX, PDF) or text paste | Must | Falguni (DraftSubmitPage), Somnath (POST /v1/drafts) |
| FR-DS-02 | Before review runs, system SHALL present intent form capturing: purpose, target audience, and >= 1 must-say point | Must | Falguni (IntentForm.jsx) |
| FR-DS-03 | System SHALL store intent form data with the draft version for use in fix generation and meaning checks | Must | Somnath (Draft model) |
| FR-DS-04 | System SHALL associate a SHA-256 content hash with every draft version to detect tampering | Must | Somnath (hash.js + DraftVersion model) |
| FR-DS-05 | System SHALL apply the confidential-term tripwire check before storing any draft; embargoed terms SHALL block the draft | Must | Somnath (workflowEngine.js + entities.py) |

### FR-RD: Review and Detection

| ID | Requirement | Priority | Owner |
|---|---|---|---|
| FR-RD-01 | System SHALL extract checkable claims (numbers, dates, percentages, product terms, superlatives, promotional phrases) from the draft | Must | Om (claim_extractor.py) |
| FR-RD-02 | System SHALL apply exact rule checks first: banned terms, unqualified superlatives, accessibility violations (alt text absence, low contrast) | Must | Om (judge.py Stage 1) |
| FR-RD-03 | System SHALL retrieve candidate proof passages using multilingual sentence embeddings and a per-org vector index | Must | Om (embedder.py + retriever.py) |
| FR-RD-04 | System SHALL compare each claim against retrieved passages using an NLI entailment model; output Supported, Contradicted, or Unclear with a confidence score | Must | Om (judge.py Stage 2) |
| FR-RD-05 | System SHALL compare the draft against all past approved content indexed as sources to detect self-contradictions | Must | Om (retriever.py: sourceType = past_content) |
| FR-RD-06 | System SHALL assign a verdict and confidence score to each finding | Must | Om (judge.py) |
| FR-RD-07 | A finding of type violation SHALL NOT be saved without a valid proofPassageId; unproven issues SHALL be stored as type question | Must | Somnath (findings.js API validation) |
| FR-RD-08 | System SHALL complete review of a one-page text draft in under 30 seconds (model on or off) | Must | Om (pipeline optimisation) |
| FR-RD-09 | System SHALL run basic image checks: alt text presence, contrast ratio, colour palette extraction | Should | Om (image_analyser.py) |
| FR-RD-10 | System SHALL run a hostile-reader pre-mortem and surface the single highest-risk line with its viewpoint and reason | Should | Om (premortem_engine.py) |

### FR-EC: Evidence Cards and Findings Display

| ID | Requirement | Priority | Owner |
|---|---|---|---|
| FR-EC-01 | Every finding displayed SHALL include: exact highlighted draft span, proof passage with file/page/version/expiry citation, verdict, and confidence level | Must | Falguni (EvidenceCard.jsx) |
| FR-EC-02 | System SHALL display a suggested fix alongside each finding | Must | Falguni (SuggestedFix.jsx), Om (rewriter.py) |
| FR-EC-03 | Each suggested fix SHALL include a meaning check showing what was kept, changed, and dropped relative to creator's must-say list | Must | Falguni (MeaningCheck.jsx), Om (meaning_check.py) |
| FR-EC-04 | A creator SHALL be able to: Accept a fix, Edit the fix, or Dismiss with a mandatory written reason | Must | Falguni (ActionButtons.jsx), Somnath (PATCH /v1/findings/:id) |
| FR-EC-05 | Findings classified as questions SHALL show Ask Owner as an action option | Must | Falguni (ActionButtons.jsx) |
| FR-EC-06 | Side-by-side comparison view SHALL be accessible from every evidence card | Must | Falguni (ComparisonView.jsx) |

### FR-WF: Workflow, Roles, and Collaboration

| ID | Requirement | Priority | Owner |
|---|---|---|---|
| FR-WF-01 | System SHALL support four roles: Creator, Brand Manager, Authorised Reviewer, Knowledge Owner/Admin | Must | Somnath (rbac.js, User model) |
| FR-WF-02 | A draft SHALL progress through states: Draft > Checked > In Review > Approved > Published | Must | Somnath (workflowEngine.js) |
| FR-WF-03 | Manager and Reviewer roles SHALL be able to approve, request changes, or override findings with a mandatory written reason | Must | Somnath (approvals.js), Falguni (ApprovalControls.jsx) |
| FR-WF-04 | System SHALL maintain versioned diffs between all draft versions | Must | Somnath (versionManager.js), Falguni (DiffView.jsx) |
| FR-WF-05 | Threaded comments SHALL be attachable to any draft via the comments API | Must | Somnath (comments.js), Falguni (CommentThread.jsx) |
| FR-WF-06 | High-confidence contradictions (>= 0.85) SHALL route to creator then manager; low-confidence or risky topics SHALL route to authorised reviewer | Must | Somnath (workflowEngine.js routing logic) |
| FR-WF-07 | A reviewer's ruling SHALL be optionally saveable as an approved fact or rule, auto-resolving the same question in future reviews | Must | Somnath (POST /v1/facts), Om (retrieval index update) |

### FR-AP: Brand Passport and Audit Log

| ID | Requirement | Priority | Owner |
|---|---|---|---|
| FR-AP-01 | Upon approval, system SHALL create a Brand Passport containing: SHA-256 content hash, checks run[], rules version, approvers[], AI-use flag | Must | Somnath (passportBuilder.js) |
| FR-AP-02 | Brand Passport SHALL be stored in an append-only collection with no update or delete routes | Must | Somnath (Passport model; no PATCH/DELETE routes) |
| FR-AP-03 | An audit log SHALL record every action as an immutable append-only event | Must | Somnath (auditLogger.js) |
| FR-AP-04 | Any change to approved content after passport creation SHALL be detectable via hash comparison | Must | Somnath (hash.js), Falguni (TamperCheck.jsx) |

### FR-PS: Privacy, Security, and Confidentiality

| ID | Requirement | Priority | Owner |
|---|---|---|---|
| FR-PS-01 | All data SHALL be isolated per organisation; orgId enforced on every query server-side | Must | Somnath (orgIsolation.js middleware) |
| FR-PS-02 | Before any content is sent to an external model, system SHALL apply redaction gateway replacing confidential terms with [REDACTED] | Must | Somnath (redactionGateway.js) |
| FR-PS-03 | A user preview SHALL show exactly what would be sent externally before the external call is made | Must | Somnath (redaction preview endpoint), Falguni (preview modal) |
| FR-PS-04 | System SHALL operate in rules-only mode with the language model disabled; all exact-rule checks SHALL work in this mode | Must | Om (rules-only flag in judge.py), Somnath (org settings) |
| FR-PS-05 | Confidential-term tripwire SHALL block drafts containing embargoed terms until the embargo date | Must | Om (entities.py), Somnath (workflowEngine.js) |
| FR-PS-06 | UI SHALL display a visible AI-use notice whenever AI or an external service was used in any review | Must | Falguni (AIUseNotice.jsx) |
| FR-PS-07 | Uploaded files SHALL be scanned before parsing; parsing SHALL run in an isolated process | Must | Somnath (uploadScan.js), Om (parser.py sandboxing) |

### FR-IN: Insights and Guideline Debugger

| ID | Requirement | Priority | Owner |
|---|---|---|---|
| FR-IN-01 | System SHALL track per-rule counts of flags, creator overrides, and reviewer disputes | Should | Somnath (insightsAggregator.js) |
| FR-IN-02 | Rules with a high override rate SHALL be surfaced in the Guideline Debugger with a proposed clearer wording | Should | Somnath (GET /v1/insights/rules), Falguni (GuidelineDebuggerList.jsx) |
| FR-IN-03 | An Insights dashboard SHALL show repeated mistakes, unclear rules, and time-to-approval | Should | Somnath (GET /v1/insights/mistakes), Falguni (DashboardPage.jsx) |

### FR-PH2: Phase 2 Features (Three Planned Improvements)

| ID | Requirement | Priority | Owner |
|---|---|---|---|
| FR-PH2-01 | Agent Gate API: external AI tools and agencies SHALL be able to call POST /v1/gate/check (API key required) and receive a Preflight verdict before publishing | Phase 2 | Somnath (gate.js stub), Om (ML pipeline reuse) |
| FR-PH2-02 | Rule Simulator: system SHALL allow managers to replay a proposed guideline change against the last 100 approved drafts before enabling it | Phase 2 | Somnath (POST /v1/rules/simulate), Om (judge pipeline batch re-run) |
| FR-PH2-03 | Voice Fingerprint: system SHALL learn brand tone from approved posts and show a tone-drift metre on new drafts | Phase 2 | Om (voice_fingerprint.py using sentence-transformers) |

---

## 3. Non-Functional Requirements

### NFR-P: Performance

| ID | Requirement |
|---|---|
| NFR-P-01 | One-page draft reviewed in under 30 seconds (rules-only or small local model) |
| NFR-P-02 | System SHALL remain responsive under concurrent review of up to 10 drafts |
| NFR-P-03 | Docker Compose cold start SHALL complete in under 3 minutes |

### NFR-S: Security

| ID | Requirement |
|---|---|
| NFR-S-01 | Authentication via JWT; sessions expire; tokens never stored in localStorage without encryption |
| NFR-S-02 | All stored files encrypted at rest (AES-256 or equivalent via MinIO) |
| NFR-S-03 | The browser SHALL never communicate directly with the ML service |
| NFR-S-04 | Uploaded text is treated as data, never as instructions to the model |
| NFR-S-05 | All model outputs must match a fixed Pydantic JSON schema; non-conforming outputs are discarded and logged |
| NFR-S-06 | orgId SHALL be extracted from JWT claims only, never from the request body |

### NFR-R: Reliability

| ID | Requirement |
|---|---|
| NFR-R-01 | Low-confidence findings NEVER block a draft; they route to a human reviewer |
| NFR-R-02 | Wrong findings reported by reviewers feed back into the evaluation test set |
| NFR-R-03 | Rules-only mode SHALL provide meaningful checking with zero model dependency |
| NFR-R-04 | ML service timeouts SHALL not crash the backend; a safe error state with retry option is returned |

### NFR-A: Accessibility

| ID | Requirement |
|---|---|
| NFR-A-01 | UI SHALL meet WCAG 2.2 Level AA (4.5:1 contrast for normal text; 3:1 for large text) |
| NFR-A-02 | All interactive elements SHALL be keyboard navigable with visible focus rings |
| NFR-A-03 | Automated axe-core checks SHALL pass on all 7 pages before the demo |
| NFR-A-04 | All inputs, buttons, and icon-only controls SHALL have ARIA labels |

### NFR-D: Deployability

| ID | Requirement |
|---|---|
| NFR-D-01 | System SHALL be deployable via Docker Compose (web, api, ml, mongo, minio) with a single docker-compose up command |
| NFR-D-02 | No secrets SHALL be stored in the repository; all configuration via environment variables |
| NFR-D-03 | Demo SHALL use fictional company Stellara Brands with synthetic documents only |
| NFR-D-04 | A seed script SHALL load all demo data on first startup |

---

## 4. Confidence Thresholds and Routing

| Situation | Verdict | Handler |
|---|---|---|
| Exact rule matched | Violated (conf 1.0) | Creator |
| Claim matched, confidence >= 0.85 | Supported or Contradicted | Creator; manager if Contradicted |
| Confidence 0.60 to 0.84 | Unclear (shown as question) | Creator; reviewer if high-risk topic |
| Confidence < 0.60 or no passage | Not Found (shown as question) | Reviewer or knowledge owner |
| Any confidence, high-risk topic (legal/health/finance/comparisons) | Always queued | Authorised reviewer |

Note: Threshold values are starting values. Final values will be published after tuning on the seeded evaluation test set.

---

## 5. Constraints

- Team size: 3 people; each owns one layer with a clear API contract enabling parallel work
- Timeline: 40 hours
- Data: Synthetic Stellara Brands data only for the demo; no real confidential material
- Stack: MERN (MongoDB, Express, React, Node) + Python FastAPI for ML; no additional vendor lock-in
- External model: Optional; system must function without it via rules-only mode

---

*Document version: 2.0 | Hackathon: Codex 48 | 40-Hour Sprint*
