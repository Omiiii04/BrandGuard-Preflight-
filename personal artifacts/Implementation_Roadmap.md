# Implementation Roadmap

## BrandGuard Preflight — Codex 48 Hackathon (40-Hour Sprint)

### 10 Blocks x 4 Hours Each | Judging-Criteria Aligned | Commit-Wise Task Breakdown

> Version: 4.0 | Date: 26 October 2026
> Team: Somnath (S) — Backend/Lead | Falguni (F) — Frontend | Om (O) — AI/ML

---

## Overview

The 40-hour sprint is divided into 10 blocks of 4 hours each.
Each block lists the tasks to complete within those 4 hours, along with the responsible person.

Stage breakdown:

- Stage 1 — Foundations       : Blocks 1–2  (Hours 0–8)    | Sync at Hour 10
- Stage 2 — Core Loop         : Blocks 3–5  (Hours 8–20)   | Sync at Hour 20
- Stage 3 — Unique Features   : Blocks 6–7  (Hours 20–30)  | Sync at Hour 30
- Stage 4 — Hardening & Demo  : Blocks 8–10 (Hours 30–40)

Cut rule: If time runs short, drop features from the bottom of the priority table.
Must-priority rows alone cover all 5 judging criteria.

### Commit Message Convention

```
[BLOCK-N][WHO] short description

Who prefixes:  S = Somnath | F = Falguni | O = Om
```

Example: `[BLOCK-1][S] add docker-compose with 5 services`

---

## STAGE 1 — FOUNDATIONS (Blocks 1–2)

**Exit check:** A source can be uploaded and appears indexed in the knowledge base.

---

### BLOCK 1 (Hours 0–4)

**Theme:** Project skeleton, API contract, design system, and synthetic data creation.

| Who         | Tasks to Complete in This Block                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | Create full repo structure (frontend/, backend/, ml_service/, docs/). Set up Docker Compose with all 5 services (web, api, ml, mongo, minio). Write .env.example. Write OpenAPI 3.1 contract (openapi.yaml) covering all endpoint paths, request/response schemas — share with team for agreement. Set up MongoDB connection and MinIO client. Write auth.js middleware (JWT verify + inject req.user). Write orgIsolation.js middleware.                                      |
| **F** | Bootstrap React + Vite project. Install dependencies (axios, react-router-dom, axe-core). Set up src/ folder structure (pages/, components/, context/, api/, utils/). Define design system tokens in index.css: HSL colour palette, spacing scale, Google Font Inter. Build Sidebar.jsx and TopBar.jsx layout shell. Implement React Router with placeholder routes for all 7 pages. Build LoginPage.jsx. Build AuthContext.jsx and OrgContext.jsx. Wire role-aware navigation. |
| **O** | Create Stellara Brands synthetic dataset: 3 guideline PDFs, 2 fact sheet DOCXs, 5 past approved blog posts, 1 returns policy with v1 (14-day) and v2 (30-day). Scaffold test_set.json. Set up FastAPI project. Install all requirements. Stub all 6 ML endpoints with mock responses matching agreed schemas.                                                                                                                                                                   |

**Block 1 exit:** Docker Compose starts. Vite dev server runs. All 6 ML stubs return valid mock JSON. OpenAPI contract agreed and frozen.

#### Commits — Block 1

**Somnath**

```
[BLOCK-1][S] init repo structure: frontend/ backend/ ml_service/ docs/
[BLOCK-1][S] add docker-compose with 5 services (web, api, ml, mongo, minio)
[BLOCK-1][S] add .env.example with all required env vars
[BLOCK-1][S] add openapi.yaml — full OpenAPI 3.1 contract (all endpoints + schemas)
[BLOCK-1][S] add MongoDB connection and MinIO client setup
[BLOCK-1][S] add auth.js middleware (JWT verify, req.user injection)
[BLOCK-1][S] add orgIsolation.js middleware
```

**Falguni**

```
[BLOCK-1][F] bootstrap React + Vite project, install all dependencies
[BLOCK-1][F] scaffold src/ folder structure (pages, components, context, api, utils)
[BLOCK-1][F] add index.css design tokens (HSL palette, spacing scale, Inter font)
[BLOCK-1][F] build Sidebar.jsx and TopBar.jsx layout shell
[BLOCK-1][F] add React Router with placeholder routes for all 7 pages
[BLOCK-1][F] build LoginPage.jsx with form validation
[BLOCK-1][F] add AuthContext.jsx, OrgContext.jsx, and role-aware navigation
```

**Om**

```
[BLOCK-1][O] add Stellara Brands synthetic dataset (PDFs, DOCXs, blog posts, returns policy)
[BLOCK-1][O] scaffold test_set.json with annotated expected findings
[BLOCK-1][O] init FastAPI project with all requirements installed
[BLOCK-1][O] stub all 6 ML endpoints with mock responses matching OpenAPI schemas
```

---

### BLOCK 2 (Hours 4–8) + Stage 1 Sync at Hour 10

**Theme:** Source upload pipeline end-to-end, ML parsing and vector indexing.

| Who         | Tasks to Complete in This Block                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | Build POST /v1/sources route with uploadScan.js middleware (file-type allow-list, 10 MB limit, AV scan stub). Integrate MinIO upload. Save Source document to MongoDB with owner, version, expiryDate. Build GET /v1/sources and GET /v1/sources/:id. Add rbac.js middleware (requireRole factory). Write errorHandler.js (structured JSON errors). Write shelfLifeScheduler.js (node-cron daily expiry warning). Write auditLogger.js (append-only event creator). |
| **F** | Build KnowledgeBasePage.jsx: SourceUploader.jsx (drag-and-drop), SourceList.jsx, SourceCard.jsx (owner, version, expiry badge, status badge). Wire to GET /v1/sources. Build DraftSubmitPage.jsx: FileUploadZone.jsx, TextPasteEditor.jsx, IntentForm.jsx (purpose, audience, must-say[] repeatable inputs).                                                                                                                                                        |
| **O** | Build parser.py: PyMuPDF for PDF (text + page positions), python-docx for DOCX, Tesseract OCR for images. Test against all Stellara Brands synthetic documents. Build embedder.py: load sentence-transformers model, create FAISS index from parsed passages, store passages in MongoDB with embeddingRef. Build retriever.py: k-NN lookup filtered by orgId and expiry. Index all Stellara Brands synthetic sources.                                               |

**Block 2 exit:** Source upload returns 201. File appears in MinIO. Passages indexed. Retriever returns top-3 passages for a test claim.

#### Commits — Block 2

**Somnath**

```
[BLOCK-2][S] add POST /v1/sources with uploadScan.js middleware (type allow-list, 10 MB cap)
[BLOCK-2][S] integrate MinIO upload for source files
[BLOCK-2][S] save Source document to MongoDB (owner, version, expiryDate fields)
[BLOCK-2][S] add GET /v1/sources and GET /v1/sources/:id
[BLOCK-2][S] add rbac.js middleware with requireRole factory
[BLOCK-2][S] add errorHandler.js with structured JSON error responses
[BLOCK-2][S] add shelfLifeScheduler.js (node-cron daily expiry warning)
[BLOCK-2][S] add auditLogger.js (append-only event creator)
```

**Falguni**

```
[BLOCK-2][F] build KnowledgeBasePage.jsx with SourceUploader (drag-and-drop)
[BLOCK-2][F] add SourceList.jsx and SourceCard.jsx (owner, version, expiry, status badges)
[BLOCK-2][F] wire KnowledgeBasePage to GET /v1/sources API
[BLOCK-2][F] build DraftSubmitPage.jsx with FileUploadZone and TextPasteEditor
[BLOCK-2][F] add IntentForm.jsx (purpose, audience, must-say[] repeatable inputs)
```

**Om**

```
[BLOCK-2][O] build parser.py (PyMuPDF PDF, python-docx DOCX, Tesseract OCR)
[BLOCK-2][O] test parser against all Stellara Brands synthetic documents
[BLOCK-2][O] build embedder.py (sentence-transformers + FAISS index creation)
[BLOCK-2][O] store passages in MongoDB with embeddingRef field
[BLOCK-2][O] build retriever.py (k-NN lookup filtered by orgId and expiry)
[BLOCK-2][O] index all Stellara Brands synthetic sources into FAISS
```

**Stage 1 Sync (10 min at Hour 10):** Each person demos deliverables. Confirm contract frozen. Mock any missing dependencies for Stage 2.

---

## STAGE 2 — CORE LOOP (Blocks 3–5)

**Exit check:** A text draft returns sourced findings end-to-end, visible as evidence cards in the UI.

---

### BLOCK 3 (Hours 10–14)

**Theme:** Draft submission pipeline, claim extraction, judgement Stage 1 (exact rules).

| Who         | Tasks to Complete in This Block                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | Build POST /v1/drafts route: accept multipart (file + intent JSON), store Draft + DraftVersion with SHA-256 contentHash, write AuditLog event: draft_submitted. Build redactionGateway.js middleware: load org watchlist, replace matches with [REDACTED] in content copy, log what was redacted. Build mlOrchestrator.js: internal HTTP POST to FastAPI /extract-claims with redacted content + orgId; handle timeouts and schema validation of response. Build POST /v1/drafts/:id/review endpoint: call mlOrchestrator, validate response schema, save Finding documents to MongoDB (orgId-scoped), write AuditLog event: review_completed. |
| **F** | Build ReviewPage.jsx skeleton: DraftViewer.jsx (renders draft text with inline highlights), FindingsSidebar.jsx (loading state + empty state). Build EvidenceCard.jsx (core primitive) using mock data: DraftSpanHighlight, ProofPassagePanel (file/page/version/expiry), VerdictBadge (5 types), ConfidenceBar, SuggestedFix (editable text area), MeaningCheck (kept/changed/dropped), ActionButtons (Accept, Edit, Dismiss, Ask Owner). Build ComparisonView.jsx: two-column side-by-side draft text vs source passage.                                                                                                                     |
| **O** | Build claim_extractor.py: regex + keyword patterns for numbers, dates, percentages, product names, superlatives (best/only/fastest/leading/most/number one), promotional phrases. Test against Stellara Brands returns-policy draft. Build judge.py Stage 1 (exact rules): banned terms, unqualified superlatives, alt-text absence — all return Violated with confidence 1.0. Verify "best returns in India" is flagged correctly. Add Pydantic schema models in schemas/responses.py for all 6 ML endpoints.                                                                                                                                |

**Block 3 exit:** Draft submission works. Claim extractor finds "14 days" and "best returns in India". Stage 1 judge flags the superlative. EvidenceCard renders all 5 verdict types with mock data.

#### Commits — Block 3

**Somnath**

```
[BLOCK-3][S] add POST /v1/drafts (multipart, SHA-256 contentHash, DraftVersion save)
[BLOCK-3][S] write AuditLog event: draft_submitted
[BLOCK-3][S] add redactionGateway.js (watchlist replace with [REDACTED], log redacted items)
[BLOCK-3][S] add mlOrchestrator.js (HTTP POST to /extract-claims, timeout + schema validation)
[BLOCK-3][S] add POST /v1/drafts/:id/review (orchestrate ML, save Findings, audit review_completed)
```

**Falguni**

```
[BLOCK-3][F] build ReviewPage.jsx skeleton with DraftViewer and FindingsSidebar
[BLOCK-3][F] add loading and empty states to FindingsSidebar
[BLOCK-3][F] build EvidenceCard.jsx with DraftSpanHighlight and ProofPassagePanel (mock data)
[BLOCK-3][F] add VerdictBadge (5 types) and ConfidenceBar to EvidenceCard
[BLOCK-3][F] add SuggestedFix (editable textarea) and MeaningCheck (kept/changed/dropped) to EvidenceCard
[BLOCK-3][F] add ActionButtons (Accept, Edit, Dismiss, Ask Owner) to EvidenceCard
[BLOCK-3][F] build ComparisonView.jsx (two-column draft vs source passage)
```

**Om**

```
[BLOCK-3][O] build claim_extractor.py (regex + keywords: numbers, dates, superlatives, promos)
[BLOCK-3][O] test claim_extractor against Stellara Brands returns-policy draft
[BLOCK-3][O] build judge.py Stage 1: banned terms, superlatives, alt-text (confidence 1.0)
[BLOCK-3][O] verify "best returns in India" flagged as Violated
[BLOCK-3][O] add Pydantic schema models in schemas/responses.py for all 6 ML endpoints
```

---

### BLOCK 4 (Hours 14–18)

**Theme:** NLI entailment, live findings, fix generation, meaning check.

| Who         | Tasks to Complete in This Block                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S** | Build GET /v1/drafts/:id/findings (orgId-scoped, paginated). Build PATCH /v1/findings/:id (accept/edit/dismiss with reason; validate status transitions; write AuditLog event: finding_actioned). Build POST /v1/facts (add approved fact with owner + expiry). Add server-side schema validation for all ML response types — non-conforming responses discarded with AuditLog event: ml_response_discarded. Run full integration check: Stellara Brands returns-policy draft → claim extracted → passage retrieved → NLI verdict = Contradicted → finding saved → UI displays card.             |
| **F** | Wire EvidenceCard to live findings API (replace mock data with real backend responses). Render all 5 verdict types with correct verdict colours. Wire Accept/Edit/Dismiss buttons to PATCH /v1/findings/:id. Show success/error toast on action. Build SuggestedFix.jsx as editable text area pre-filled by ML. Build MeaningCheck.jsx: kept = green badge, changed = amber, dropped = red. Integrate both into EvidenceCard with real ML data.                                                                                                                                                        |
| **O** | Build judge.py Stage 2 (NLI entailment): load cross-encoder/nli-deberta-v3-base; score each claim against top-3 retrieved passages; map entails → Supported, contradicts → Contradicted, neutral → Unclear; confidence from softmax; apply Outdated override if passage.expiryDate < today; Not Found if no passage retrieved. Verify: "14 days" claim vs 30-day policy passage returns Contradicted (conf ~0.90). Build rewriter.py: LM prompt constrained to retrieved passages + must-say list. Build meaning_check.py: compare each must-say point against the fix; label kept/changed/dropped. |

**Block 4 exit:** NLI returns Contradicted for the core demo scenario. Live evidence cards display in UI. Accept/dismiss work end-to-end. Suggested fix + meaning check display real ML data.

#### Commits — Block 4

**Somnath**

```
[BLOCK-4][S] add GET /v1/drafts/:id/findings (orgId-scoped, paginated)
[BLOCK-4][S] add PATCH /v1/findings/:id (accept/edit/dismiss, status transition validation)
[BLOCK-4][S] write AuditLog event: finding_actioned
[BLOCK-4][S] add POST /v1/facts (approved fact with owner + expiry)
[BLOCK-4][S] add server-side ML response schema validation (discard + audit ml_response_discarded)
[BLOCK-4][S] run integration check: draft → claim → passage → NLI → finding → UI card
```

**Falguni**

```
[BLOCK-4][F] wire EvidenceCard to live findings API (replace mock data)
[BLOCK-4][F] render all 5 verdict types with correct colours from live data
[BLOCK-4][F] wire Accept/Edit/Dismiss buttons to PATCH /v1/findings/:id
[BLOCK-4][F] add success/error toast notifications on finding action
[BLOCK-4][F] build SuggestedFix.jsx (editable textarea pre-filled by ML suggested fix)
[BLOCK-4][F] build MeaningCheck.jsx (kept = green, changed = amber, dropped = red)
[BLOCK-4][F] integrate SuggestedFix and MeaningCheck into EvidenceCard with real ML data
```

**Om**

```
[BLOCK-4][O] build judge.py Stage 2 (NLI entailment with nli-deberta-v3-base)
[BLOCK-4][O] map NLI outputs: entails→Supported, contradicts→Contradicted, neutral→Unclear
[BLOCK-4][O] add Outdated override (expiryDate < today) and Not Found (no passage) logic
[BLOCK-4][O] verify "14 days" vs 30-day policy returns Contradicted ~0.90 confidence
[BLOCK-4][O] build rewriter.py (LM prompt constrained to passages + must-say list)
[BLOCK-4][O] build meaning_check.py (compare must-say points to fix: kept/changed/dropped)
```

---

### BLOCK 5 (Hours 18–22) + Stage 2 Sync at Hour 20

**Theme:** Comments, approvals, insights aggregation, entity detection. Stage 2 sync.

| Who         | Tasks to Complete in This Block                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S** | Build POST /v1/drafts/:id/comments (threaded, orgId-scoped, AuditLog event). Build GET /v1/drafts/:id/comments. Build POST /v1/drafts/:id/approve (RBAC: manager only; new DraftVersion; trigger passportBuilder; status = Approved; AuditLog: draft_approved). Build POST /v1/drafts/:id/request-changes (RBAC: manager; status = Draft; AuditLog: changes_requested). Build insightsAggregator.js: per-rule flag counts, override counts, time-to-approval. Expose via GET /v1/insights/rules and GET /v1/insights/mistakes. |
| **F** | Build WorkflowPage.jsx skeleton: CommentThread.jsx, CommentInput.jsx — wire to comments API. Build ApprovalControls.jsx (Approve, Request Changes, Override buttons). Build OverrideReasonModal.jsx (required text area; submit blocked if empty). Wire to approval endpoints. Build PreMortemPanel.jsx: display highest-risk line + viewpoint + reason. Integrate into ReviewPage.                                                                                                                                           |
| **O** | Build entities.py (/detect-entities): spaCy NER + org watchlist pattern matching; identify embargoed product names, client names, confidential terms. Test: correctly identifies Stellara Brands embargoed product "Project Nova". Tune all Pydantic schemas in schemas/responses.py. Verify non-conforming outputs are discarded not propagated.                                                                                                                                                                              |

**Block 5 exit:** Comments and approvals work with RBAC. Insights endpoints return data. Pre-mortem panel renders.

#### Commits — Block 5

**Somnath**

```
[BLOCK-5][S] add POST /v1/drafts/:id/comments (threaded, orgId-scoped, AuditLog)
[BLOCK-5][S] add GET /v1/drafts/:id/comments
[BLOCK-5][S] add POST /v1/drafts/:id/approve (manager RBAC, new DraftVersion, audit draft_approved)
[BLOCK-5][S] add POST /v1/drafts/:id/request-changes (manager RBAC, audit changes_requested)
[BLOCK-5][S] add insightsAggregator.js (per-rule flag counts, override counts, time-to-approval)
[BLOCK-5][S] expose GET /v1/insights/rules and GET /v1/insights/mistakes
```

**Falguni**

```
[BLOCK-5][F] build WorkflowPage.jsx skeleton
[BLOCK-5][F] add CommentThread.jsx and CommentInput.jsx (wired to comments API)
[BLOCK-5][F] build ApprovalControls.jsx (Approve, Request Changes, Override buttons)
[BLOCK-5][F] add OverrideReasonModal.jsx (required textarea, blocked submit if empty)
[BLOCK-5][F] wire ApprovalControls and OverrideReasonModal to approval endpoints
[BLOCK-5][F] build PreMortemPanel.jsx (highest-risk line + viewpoint + reason)
[BLOCK-5][F] integrate PreMortemPanel into ReviewPage
```

**Om**

```
[BLOCK-5][O] build entities.py /detect-entities (spaCy NER + org watchlist pattern match)
[BLOCK-5][O] test entity detection: verify "Project Nova" flagged as embargoed
[BLOCK-5][O] tune all Pydantic schemas in schemas/responses.py
[BLOCK-5][O] verify non-conforming ML outputs are discarded, not propagated
```

**Stage 2 Sync (10 min at Hour 20):** Live demo — draft submitted → findings visible as evidence cards → creator accepts returns-policy fix. Confirm Stage 2 exit check passed. Plan Stage 3.

---

## STAGE 3 — UNIQUE FEATURES (Blocks 6–7)

**Exit check:** Full demo story runs for all three roles (creator → manager → reviewer).

---

### BLOCK 6 (Hours 22–26)

**Theme:** Brand Passport, version history, pre-mortem, contradiction check, shelf-life.

| Who         | Tasks to Complete in This Block                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S** | Build passportBuilder.js: SHA-256 of approved content + checksRun[] + rulesVersion + approvers[] + aiUsed flag; store in append-only passports collection (no PATCH/DELETE routes). Build GET /v1/passports/:id. Build versionManager.js: create new DraftVersion on each accepted fix (increment version number, store new contentHash, compute text diff). Expose via GET /v1/drafts/:id/versions. Add Claim Shelf-Life logic in workflowEngine.js: at review time check all retrieved passage expiry dates; if expired, create additional Finding with verdict = Outdated.                                      |
| **F** | Build PassportPage.jsx: PassportDetails.jsx (hash, checks run, approvers, aiUsed badge, timestamp). Build TamperCheck.jsx (re-compute hash; show Verified or Tampered badge). Build VersionTimeline.jsx: chronological list of versions with status badge, author, timestamp. Build DiffView.jsx: line-by-line diff (additions green, deletions red). Wire both to GET /v1/drafts/:id/versions. Wire AIUseNotice.jsx into TopBar (always visible when current review used any LM call).                                                                                                                            |
| **O** | Build premortem_engine.py: 4 structured LM prompts (regulator, journalist, competitor, screen-reader); fixed JSON output per viewpoint {riskiest_line, reason, viewpoint}; return only the highest-risk line across all 4 viewpoints. Test: "best returns in India" superlative should surface regulator viewpoint. Ensure riskiest_span validation — if span not found verbatim in draft, discard output. Build contradiction check against past content: ensure all 5 Stellara Brands past approved blog posts are indexed with sourceType = past_content; verify new draft contradicting old post is detected. |

**Block 6 exit:** Brand Passport created on approval and verifiable. Version timeline and diff view render. Pre-mortem returns correct highest-risk line for demo scenario. Past-content contradiction detected.

#### Commits — Block 6

**Somnath**

```
[BLOCK-6][S] build passportBuilder.js (SHA-256, checksRun, rulesVersion, approvers, aiUsed)
[BLOCK-6][S] create append-only passports collection (no PATCH/DELETE routes)
[BLOCK-6][S] add GET /v1/passports/:id
[BLOCK-6][S] build versionManager.js (DraftVersion on accepted fix, contentHash, text diff)
[BLOCK-6][S] add GET /v1/drafts/:id/versions
[BLOCK-6][S] add Claim Shelf-Life logic in workflowEngine.js (Outdated verdict for expired passages)
```

**Falguni**

```
[BLOCK-6][F] build PassportPage.jsx with PassportDetails.jsx (hash, checks, approvers, aiUsed badge)
[BLOCK-6][F] add TamperCheck.jsx (recompute SHA-256, show Verified/Tampered badge)
[BLOCK-6][F] build VersionTimeline.jsx (chronological versions with status badge, author, timestamp)
[BLOCK-6][F] build DiffView.jsx (line-by-line diff: additions green, deletions red)
[BLOCK-6][F] wire VersionTimeline and DiffView to GET /v1/drafts/:id/versions
[BLOCK-6][F] add AIUseNotice.jsx into TopBar (always visible on LM-triggered reviews)
```

**Om**

```
[BLOCK-6][O] build premortem_engine.py (4 LM prompts: regulator, journalist, competitor, screen-reader)
[BLOCK-6][O] return highest-risk line across all 4 viewpoints with riskiest_span validation
[BLOCK-6][O] test premortem: "best returns in India" surfaces regulator viewpoint
[BLOCK-6][O] index all 5 past approved blog posts with sourceType = past_content
[BLOCK-6][O] verify contradiction check: new draft contradicting old post is detected
```

---

### BLOCK 7 (Hours 26–30) + Stage 3 Sync at Hour 30

**Theme:** Dashboard, insights, guideline debugger, redaction preview, full demo story verification.

| Who         | Tasks to Complete in This Block                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | Build Guideline Debugger logic: query findings for rules with override rate > 50%; for each, suggest clearer rewording via /rewrite ML call; expose in GET /v1/insights/rules response as {rule, overrideRate, suggestedRewording}. Build redaction preview endpoint: before any external ML call, show user a preview of what content (after redaction) would be sent. Add rules-only mode: if org setting rules_only = true, skip all LM calls and return only exact-rule findings. |
| **F** | Build DashboardPage.jsx: OrgMetricsCard.jsx (total drafts, avg time to approve, open findings count, citation rate), RecentDraftsTable.jsx (status badge, owner, last updated, link to ReviewPage). Build InsightsPanel.jsx: RepeatMistakesChart.jsx (top 5 finding types bar chart), GuidelineDebuggerList.jsx (high-override rules with override rate + suggested rewording + Approve Rewording button). Verify MeaningCheck.jsx displays real ML data end-to-end (not mock data).  |
| **O** | Run full demo story end-to-end through ML pipeline: Priya submits draft with 3 seeded issues (returns-policy contradiction + unsupported superlative + expired fact). Verify all 3 findings are returned with correct verdicts and proofPassageIds. Verify fix generation and meaning check work for all 3. Verify past-content contradiction is caught. Document any gaps to fix before Block 8.                                                                                     |

**Block 7 exit:** Dashboard shows live metrics. Guideline Debugger has data. Redaction preview works. Full ML demo story verified for all 3 seeded issues.

#### Commits — Block 7

**Somnath**

```
[BLOCK-7][S] build Guideline Debugger logic (override rate >50%, /rewrite suggestion, expose in rules endpoint)
[BLOCK-7][S] add redaction preview endpoint (preview redacted content before ML call)
[BLOCK-7][S] add rules-only mode (skip LM calls when org.rules_only = true)
```

**Falguni**

```
[BLOCK-7][F] build DashboardPage.jsx with OrgMetricsCard (drafts, avg time, findings, citation rate)
[BLOCK-7][F] add RecentDraftsTable.jsx (status badge, owner, last updated, link to ReviewPage)
[BLOCK-7][F] build InsightsPanel.jsx with RepeatMistakesChart (top 5 finding types bar chart)
[BLOCK-7][F] add GuidelineDebuggerList.jsx (high-override rules + suggested rewording + Approve button)
[BLOCK-7][F] verify MeaningCheck.jsx end-to-end with real ML data (remove all mock data)
```

**Om**

```
[BLOCK-7][O] run full ML demo story: 3 seeded issues (contradiction + superlative + expired fact)
[BLOCK-7][O] verify all 3 findings returned with correct verdicts and proofPassageIds
[BLOCK-7][O] verify fix generation and meaning check for all 3 findings
[BLOCK-7][O] verify past-content contradiction detection end-to-end
[BLOCK-7][O] document all ML gaps found; prioritise fixes for Block 8
```

**Stage 3 Sync (10 min at Hour 30):** Full Priya demo story run by all three roles. Creator submits → findings appear → accepts fix → manager approves → passport created. All three members confirm journey works end-to-end.

---

## STAGE 4 — HARDENING & DEMO (Blocks 8–10)

**Exit check:** Metrics measured, WCAG pass, end-to-end test passes, demo rehearsed twice.

---

### BLOCK 8 (Hours 30–34)

**Theme:** Security audit, error handling, accessibility pass, evaluation run begins.

| Who         | Tasks to Complete in This Block                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | Security review: manually verify orgId enforced on every MongoDB query. Verify RBAC on every approve/override endpoint. Verify no PATCH/DELETE routes exist for auditLog and passports. Add structured errorHandler.js responses for all error cases: invalid JWT (401), forbidden role (403), draft not found (404), ML timeout (503), schema validation failure (422), upload scan failure (400) — no stack traces in responses. Write unit tests: JWT verification, orgId isolation (orgA cannot return orgB data), SHA-256 passport computation, role checks, finding status transitions. |
| **F** | Accessibility pass Part 1: run axe-core against all 7 pages; fix all colour contrast issues (minimum 4.5:1 for normal text). Accessibility pass Part 2: fix keyboard navigation tab order, focus indicators (2px solid focus ring on all interactive elements), aria-labels on all icon-only buttons, heading hierarchy (single h1 per page). Build and verify all loading states (spinner while review runs), error states (toast on API failure), and empty states (no findings yet, empty dashboard) across all pages.                                                                      |
| **O** | Run seeded evaluation: submit all ~60 Stellara Brands test drafts through the full ML pipeline. Record recall (planted issues found / planted), precision (correct findings / all flagged), citation rate (findings with valid proofPassageId), confidence calibration. Begin tuning confidence thresholds (default: Contradicted at 0.85, Unclear at 0.60) based on results.                                                                                                                                                                                                                  |

**Block 8 exit:** Security checklist complete (zero cross-tenant leakage). All pages pass axe automated check. All error/loading/empty states handled. Evaluation numbers measured.

#### Commits — Block 8

**Somnath**

```
[BLOCK-8][S] security: verify orgId enforcement on all MongoDB queries
[BLOCK-8][S] security: verify RBAC on approve/override endpoints; confirm no PATCH/DELETE on audit/passports
[BLOCK-8][S] add structured error responses for 401, 403, 404, 422, 503, 400 (no stack traces)
[BLOCK-8][S] add unit tests: JWT verify, orgId isolation, SHA-256 passport, role checks, finding transitions
```

**Falguni**

```
[BLOCK-8][F] accessibility: run axe-core on all 7 pages, fix colour contrast (min 4.5:1)
[BLOCK-8][F] accessibility: fix keyboard tab order and add 2px focus rings on all interactive elements
[BLOCK-8][F] accessibility: add aria-labels to icon-only buttons, fix heading hierarchy (single h1/page)
[BLOCK-8][F] add loading states (spinner during review), error toasts (API failure), empty states (all pages)
```

**Om**

```
[BLOCK-8][O] run seeded evaluation: ~60 Stellara Brands test drafts through full ML pipeline
[BLOCK-8][O] record recall, precision, citation rate, confidence calibration metrics
[BLOCK-8][O] begin tuning confidence thresholds (Contradicted 0.85, Unclear 0.60 baseline)
```

---

### BLOCK 9 (Hours 34–38)

**Theme:** Image checks, end-to-end automated test, deployment finalisation, demo prep.

| Who         | Tasks to Complete in This Block                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | Write automated end-to-end test: login as creator → upload Stellara Brands guideline → submit returns-policy draft → review triggered → 3 findings returned → accept policy fix → login as manager → approve → passport created → verify passport SHA-256 hash. Full test must pass in under 5 minutes. Finalize Docker Compose: health checks on all 5 services, volume mounts for MongoDB data and FAISS index persistence, seed script (seed.js) that loads all demo data on first startup. Verify cold start completes in under 3 minutes. Run API contract tests: every OpenAPI-defined endpoint tested for 400/401/403 compliance. |
| **F** | Demo flow preparation: walk through the full Priya journey manually; write concise 8-minute demo script covering all steps. Prepare fallback screenshots of every key screen in case of live demo failure. Final UI polish: verify all hover states, focus rings, transition animations, loading spinners, status badges. Confirm AI-use disclosure notice appears on all review pages that triggered any LM call.                                                                                                                                                                                                                                |
| **O** | Build image_analyser.py: OpenCV dominant colour extraction (compare to brand palette in org settings), text-over-image contrast ratio (WCAG luminance formula), alt text presence detection. Wire to /image-check endpoint. Test with a synthetic Stellara Brands social media image. Finalise confidence threshold tuning based on Block 8 evaluation results. Document final threshold values. Write evaluation report (1-page markdown table + 3-sentence interpretation).                                                                                                                                                                     |

**Block 9 exit:** End-to-end automated test passes. Docker Compose cold start under 3 minutes. Image check endpoint works. Evaluation report with final numbers ready. Demo script written.

#### Commits — Block 9

**Somnath**

```
[BLOCK-9][S] write automated e2e test (creator → upload → review → accept → manager approve → passport verify)
[BLOCK-9][S] finalize Docker Compose: health checks, volume mounts, seed.js for demo data
[BLOCK-9][S] verify cold start under 3 minutes
[BLOCK-9][S] run API contract tests: all OpenAPI endpoints tested for 400/401/403 compliance
```

**Falguni**

```
[BLOCK-9][F] walk through full Priya journey manually; write 8-minute demo script
[BLOCK-9][F] prepare fallback screenshots of all key screens
[BLOCK-9][F] final UI polish: hover states, focus rings, transition animations, spinners, status badges
[BLOCK-9][F] verify AI-use disclosure notice on all LM-triggered review pages
```

**Om**

```
[BLOCK-9][O] build image_analyser.py (OpenCV colour extraction, WCAG contrast, alt text detection)
[BLOCK-9][O] wire image_analyser to /image-check endpoint
[BLOCK-9][O] test /image-check with synthetic Stellara Brands social media image
[BLOCK-9][O] finalise confidence threshold tuning based on Block 8 evaluation results
[BLOCK-9][O] document final threshold values and write evaluation report (markdown table + interpretation)
```

---

### BLOCK 10 (Hours 38–40)

**Theme:** Two full demo rehearsals, final fixes, backup recording.

| Who           | Tasks to Complete in This Block                                                                                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **All** | **Rehearsal 1:** Somnath deploys from cold start using docker-compose up. Falguni runs the full 8-minute Priya demo covering all 3 roles (creator → manager → reviewer). Om presents the 1-page evaluation report. Somnath walks through Brand Passport and audit log. Target: under 12 minutes total. Log all issues found. |
| **All** | **Fix issues from Rehearsal 1** in priority order: (1) anything that breaks the core workflow, (2) UI rough edges visible to judges, (3) evaluation numbers presentation clarity.                                                                                                                                              |
| **All** | **Rehearsal 2 (final):** Run the full demo with all fixes applied. Record a backup video of the working product. Confirm all 5 judging-criteria talking points are explicitly addressed in the demo script. Product is ready.                                                                                                  |

**Block 10 exit:** Demo rehearsed twice. Backup recording saved. All 5 judging criteria covered in the demo script.

#### Commits — Block 10

**All Members**

```
[BLOCK-10][S] cold-start deploy from docker-compose up (rehearsal 1 verified)
[BLOCK-10][F] fix UI issues found in rehearsal 1
[BLOCK-10][S] fix backend/workflow issues found in rehearsal 1
[BLOCK-10][O] fix ML/evaluation issues found in rehearsal 1
[BLOCK-10][ALL] final rehearsal 2 verified — all 5 judging criteria addressed
[BLOCK-10][ALL] save backup demo recording
```

---

## Commit Summary by Block

| Block           | Hours          | S Commits    | F Commits    | O Commits    | Total          |
| --------------- | -------------- | ------------ | ------------ | ------------ | -------------- |
| 1               | 0–4           | 7            | 7            | 4            | **18**   |
| 2               | 4–8           | 8            | 5            | 6            | **19**   |
| 3               | 10–14         | 5            | 7            | 5            | **17**   |
| 4               | 14–18         | 6            | 7            | 6            | **19**   |
| 5               | 18–22         | 6            | 7            | 4            | **17**   |
| 6               | 22–26         | 6            | 6            | 5            | **17**   |
| 7               | 26–30         | 3            | 5            | 5            | **13**   |
| 8               | 30–34         | 4            | 4            | 3            | **11**   |
| 9               | 34–38         | 4            | 4            | 5            | **13**   |
| 10              | 38–40         | 2            | 1            | 1+3          | **7**    |
| **Total** | **40 h** | **51** | **53** | **44** | **~151** |

---

## Judging-Criteria Coverage Checklist

| Criterion                       | Points | Covered By                             | Demo Evidence                                                                                        |
| ------------------------------- | ------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Working core workflow           | 30     | Falguni (UI) + Somnath (API) + Om (ML) | Upload → submit intent → review findings → accept fix → manager approves → passport created     |
| Technical depth and reliability | 25     | Om (ML) + Somnath (audit/passport)     | Evidence cards with proofPassageId; NLI confidence scores; SHA-256 Brand Passport; redaction gateway |
| Progress from Round 1           | 20     | All                                    | Contradiction detection, Brand Passport, Redaction Gateway, Claim Shelf-Life all new vs Round 1      |
| Three planned improvements      | 15     | Somnath (arch walk-through)            | Agent Gate API stub; Rule Simulator design; Voice Fingerprint architecture                           |
| Usability                       | 10     | Falguni (demo)                         | Judges follow Priya's journey without guidance; WCAG AA; AI-use always disclosed                     |

---

## Parallel Work Strategy

```
Falguni (Frontend)        Somnath (Backend)         Om (ML Service)
      |                         |                          |
      |<-- REST API contract -->|<-- Internal ML API ----->|
      |      (openapi.yaml)     |      (ml schemas)        |
      |                         |                          |
Block 1-2: App shell + KB   API skeleton + auth       ML stubs + data + index
Block 3-4: Evidence cards   Review endpoints           Judge pipeline
Block 5:   Workflow start   Comments + approvals       Schema + entities
Block 6-7: Workflow full    Passport + versions        Premortem + contradiction
Block 8-9: Polish + a11y    Security + deploy          Evaluation + image checks
Block 10:  Demo rehearsal   Demo deployment            Results presentation
```

Mocking strategy: All three layers mock the adjacent service's responses until
integration points are ready. This prevents any single layer from blocking another.

---

## Risk and Fallback Table

| Risk                                  | Fallback                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------- |
| NLI model too slow (> 10 s per draft) | Return exact-rule findings immediately; NLI results append asynchronously |
| Claim-to-source matching too noisy    | Limit to numbers, named products, superlatives; skip free-text claims     |
| External model provider unavailable   | Use rules-only mode; all exact-rule findings still work                   |
| Node.js/FastAPI integration slips     | Somnath mocks ML responses; Om continues; integrate in Block 7            |
| Docker Compose issues                 | Run services individually with npm start and uvicorn as fallback          |

---

## Priority Table (Cut Line)

| Feature                                             | Priority | Owner             |
| --------------------------------------------------- | -------- | ----------------- |
| Upload sources with owner, version, expiry          | Must     | Somnath           |
| Rules checks (banned terms, superlatives, alt text) | Must     | Om                |
| Claim extraction, retrieval, matching               | Must     | Om                |
| Evidence cards and comparison view                  | Must     | Falguni           |
| Roles, comments, approvals, version history         | Must     | Somnath + Falguni |
| Suggested fixes with Intent Lock and meaning check  | Must     | Om + Falguni      |
| Redaction preview, audit log, AI-use notice         | Must     | Somnath           |
| Claim Shelf-Life (Outdated verdict)                 | Should   | Somnath           |
| Brand Passport (SHA-256 hash)                       | Should   | Somnath           |
| Pre-mortem panel                                    | Should   | Om                |
| Insights dashboard and Guideline Debugger           | Should   | Somnath + Falguni |
| Basic image checks                                  | Should   | Om                |
| Agent Gate API (Phase 2)                            | Could    | Shared            |
| Rule Simulator (Phase 2)                            | Could    | Shared            |
| Voice Fingerprint (Phase 2)                         | Could    | Shared            |

Cut line: Drop from bottom upward. Must rows alone deliver the full demo story and address all 5 judging criteria.

---

*Document version: 4.0 | Hackathon: Codex 48 | 40-Hour Sprint*
