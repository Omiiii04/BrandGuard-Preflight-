# Implementation Roadmap
## BrandGuard Preflight — Codex 48 Hackathon (40-Hour Sprint)
### 10 Blocks x 4 Hours Each | Judging-Criteria Aligned

> Version: 3.0 | Date: 26 October 2026
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

---

## STAGE 1 — FOUNDATIONS (Blocks 1–2)
**Exit check:** A source can be uploaded and appears indexed in the knowledge base.

---

### BLOCK 1 (Hours 0–4)
**Theme:** Project skeleton, API contract, design system, and synthetic data creation.

| Who | Tasks to Complete in This Block |
|---|---|
| **S** | Create full repo structure (frontend/, backend/, ml_service/, docs/). Set up Docker Compose with all 5 services (web, api, ml, mongo, minio). Write .env.example. Write OpenAPI 3.1 contract (openapi.yaml) covering all endpoint paths, request/response schemas — share with team for agreement. Set up MongoDB connection and MinIO client. Write auth.js middleware (JWT verify + inject req.user). Write orgIsolation.js middleware. |
| **F** | Bootstrap React + Vite project. Install dependencies (axios, react-router-dom, axe-core). Set up src/ folder structure (pages/, components/, context/, api/, utils/). Define design system tokens in index.css: HSL colour palette, spacing scale, Google Font Inter. Build Sidebar.jsx and TopBar.jsx layout shell. Implement React Router with placeholder routes for all 7 pages. Build LoginPage.jsx. Build AuthContext.jsx and OrgContext.jsx. Wire role-aware navigation. |
| **O** | Create Stellara Brands synthetic dataset: 3 guideline PDFs, 2 fact sheet DOCXs, 5 past approved blog posts, 1 returns policy with v1 (14-day) and v2 (30-day). Scaffold test_set.json. Set up FastAPI project. Install all requirements. Stub all 6 ML endpoints with mock responses matching agreed schemas. |

**Block 1 exit:** Docker Compose starts. Vite dev server runs. All 6 ML stubs return valid mock JSON. OpenAPI contract agreed and frozen.

---

### BLOCK 2 (Hours 4–8) + Stage 1 Sync at Hour 10
**Theme:** Source upload pipeline end-to-end, ML parsing and vector indexing.

| Who | Tasks to Complete in This Block |
|---|---|
| **S** | Build POST /v1/sources route with uploadScan.js middleware (file-type allow-list, 10 MB limit, AV scan stub). Integrate MinIO upload. Save Source document to MongoDB with owner, version, expiryDate. Build GET /v1/sources and GET /v1/sources/:id. Add rbac.js middleware (requireRole factory). Write errorHandler.js (structured JSON errors). Write shelfLifeScheduler.js (node-cron daily expiry warning). Write auditLogger.js (append-only event creator). |
| **F** | Build KnowledgeBasePage.jsx: SourceUploader.jsx (drag-and-drop), SourceList.jsx, SourceCard.jsx (owner, version, expiry badge, status badge). Wire to GET /v1/sources. Build DraftSubmitPage.jsx: FileUploadZone.jsx, TextPasteEditor.jsx, IntentForm.jsx (purpose, audience, must-say[] repeatable inputs). |
| **O** | Build parser.py: PyMuPDF for PDF (text + page positions), python-docx for DOCX, Tesseract OCR for images. Test against all Stellara Brands synthetic documents. Build embedder.py: load sentence-transformers model, create FAISS index from parsed passages, store passages in MongoDB with embeddingRef. Build retriever.py: k-NN lookup filtered by orgId and expiry. Index all Stellara Brands synthetic sources. |

**Block 2 exit:** Source upload returns 201. File appears in MinIO. Passages indexed. Retriever returns top-3 passages for a test claim.

**Stage 1 Sync (10 min at Hour 10):** Each person demos deliverables. Confirm contract frozen. Mock any missing dependencies for Stage 2.

---

## STAGE 2 — CORE LOOP (Blocks 3–5)
**Exit check:** A text draft returns sourced findings end-to-end, visible as evidence cards in the UI.

---

### BLOCK 3 (Hours 10–14)
**Theme:** Draft submission pipeline, claim extraction, judgement Stage 1 (exact rules).

| Who | Tasks to Complete in This Block |
|---|---|
| **S** | Build POST /v1/drafts route: accept multipart (file + intent JSON), store Draft + DraftVersion with SHA-256 contentHash, write AuditLog event: draft_submitted. Build redactionGateway.js middleware: load org watchlist, replace matches with [REDACTED] in content copy, log what was redacted. Build mlOrchestrator.js: internal HTTP POST to FastAPI /extract-claims with redacted content + orgId; handle timeouts and schema validation of response. Build POST /v1/drafts/:id/review endpoint: call mlOrchestrator, validate response schema, save Finding documents to MongoDB (orgId-scoped), write AuditLog event: review_completed. |
| **F** | Build ReviewPage.jsx skeleton: DraftViewer.jsx (renders draft text with inline highlights), FindingsSidebar.jsx (loading state + empty state). Build EvidenceCard.jsx (core primitive) using mock data: DraftSpanHighlight, ProofPassagePanel (file/page/version/expiry), VerdictBadge (5 types), ConfidenceBar, SuggestedFix (editable text area), MeaningCheck (kept/changed/dropped), ActionButtons (Accept, Edit, Dismiss, Ask Owner). Build ComparisonView.jsx: two-column side-by-side draft text vs source passage. |
| **O** | Build claim_extractor.py: regex + keyword patterns for numbers, dates, percentages, product names, superlatives (best/only/fastest/leading/most/number one), promotional phrases. Test against Stellara Brands returns-policy draft. Build judge.py Stage 1 (exact rules): banned terms, unqualified superlatives, alt-text absence — all return Violated with confidence 1.0. Verify "best returns in India" is flagged correctly. Add Pydantic schema models in schemas/responses.py for all 6 ML endpoints. |

**Block 3 exit:** Draft submission works. Claim extractor finds "14 days" and "best returns in India". Stage 1 judge flags the superlative. EvidenceCard renders all 5 verdict types with mock data.

---

### BLOCK 4 (Hours 14–18)
**Theme:** NLI entailment, live findings, fix generation, meaning check.

| Who | Tasks to Complete in This Block |
|---|---|
| **S** | Build GET /v1/drafts/:id/findings (orgId-scoped, paginated). Build PATCH /v1/findings/:id (accept/edit/dismiss with reason; validate status transitions; write AuditLog event: finding_actioned). Build POST /v1/facts (add approved fact with owner + expiry). Add server-side schema validation for all ML response types — non-conforming responses discarded with AuditLog event: ml_response_discarded. Run full integration check: Stellara Brands returns-policy draft → claim extracted → passage retrieved → NLI verdict = Contradicted → finding saved → UI displays card. |
| **F** | Wire EvidenceCard to live findings API (replace mock data with real backend responses). Render all 5 verdict types with correct verdict colours. Wire Accept/Edit/Dismiss buttons to PATCH /v1/findings/:id. Show success/error toast on action. Build SuggestedFix.jsx as editable text area pre-filled by ML. Build MeaningCheck.jsx: kept = green badge, changed = amber, dropped = red. Integrate both into EvidenceCard with real ML data. |
| **O** | Build judge.py Stage 2 (NLI entailment): load cross-encoder/nli-deberta-v3-base; score each claim against top-3 retrieved passages; map entails → Supported, contradicts → Contradicted, neutral → Unclear; confidence from softmax; apply Outdated override if passage.expiryDate < today; Not Found if no passage retrieved. Verify: "14 days" claim vs 30-day policy passage returns Contradicted (conf ~0.90). Build rewriter.py: LM prompt constrained to retrieved passages + must-say list. Build meaning_check.py: compare each must-say point against the fix; label kept/changed/dropped. |

**Block 4 exit:** NLI returns Contradicted for the core demo scenario. Live evidence cards display in UI. Accept/dismiss work end-to-end. Suggested fix + meaning check display real ML data.

---

### BLOCK 5 (Hours 18–22) + Stage 2 Sync at Hour 20
**Theme:** Comments, approvals, insights aggregation, entity detection. Stage 2 sync.

| Who | Tasks to Complete in This Block |
|---|---|
| **S** | Build POST /v1/drafts/:id/comments (threaded, orgId-scoped, AuditLog event). Build GET /v1/drafts/:id/comments. Build POST /v1/drafts/:id/approve (RBAC: manager only; new DraftVersion; trigger passportBuilder; status = Approved; AuditLog: draft_approved). Build POST /v1/drafts/:id/request-changes (RBAC: manager; status = Draft; AuditLog: changes_requested). Build insightsAggregator.js: per-rule flag counts, override counts, time-to-approval. Expose via GET /v1/insights/rules and GET /v1/insights/mistakes. |
| **F** | Build WorkflowPage.jsx skeleton: CommentThread.jsx, CommentInput.jsx — wire to comments API. Build ApprovalControls.jsx (Approve, Request Changes, Override buttons). Build OverrideReasonModal.jsx (required text area; submit blocked if empty). Wire to approval endpoints. Build PreMortemPanel.jsx: display highest-risk line + viewpoint + reason. Integrate into ReviewPage. |
| **O** | Build entities.py (/detect-entities): spaCy NER + org watchlist pattern matching; identify embargoed product names, client names, confidential terms. Test: correctly identifies Stellara Brands embargoed product "Project Nova". Tune all Pydantic schemas in schemas/responses.py. Verify non-conforming outputs are discarded not propagated. |

**Block 5 exit:** Comments and approvals work with RBAC. Insights endpoints return data. Pre-mortem panel renders.

**Stage 2 Sync (10 min at Hour 20):** Live demo — draft submitted → findings visible as evidence cards → creator accepts returns-policy fix. Confirm Stage 2 exit check passed. Plan Stage 3.

---

## STAGE 3 — UNIQUE FEATURES (Blocks 6–7)
**Exit check:** Full demo story runs for all three roles (creator → manager → reviewer).

---

### BLOCK 6 (Hours 22–26)
**Theme:** Brand Passport, version history, pre-mortem, contradiction check, shelf-life.

| Who | Tasks to Complete in This Block |
|---|---|
| **S** | Build passportBuilder.js: SHA-256 of approved content + checksRun[] + rulesVersion + approvers[] + aiUsed flag; store in append-only passports collection (no PATCH/DELETE routes). Build GET /v1/passports/:id. Build versionManager.js: create new DraftVersion on each accepted fix (increment version number, store new contentHash, compute text diff). Expose via GET /v1/drafts/:id/versions. Add Claim Shelf-Life logic in workflowEngine.js: at review time check all retrieved passage expiry dates; if expired, create additional Finding with verdict = Outdated. |
| **F** | Build PassportPage.jsx: PassportDetails.jsx (hash, checks run, approvers, aiUsed badge, timestamp). Build TamperCheck.jsx (re-compute hash; show Verified or Tampered badge). Build VersionTimeline.jsx: chronological list of versions with status badge, author, timestamp. Build DiffView.jsx: line-by-line diff (additions green, deletions red). Wire both to GET /v1/drafts/:id/versions. Wire AIUseNotice.jsx into TopBar (always visible when current review used any LM call). |
| **O** | Build premortem_engine.py: 4 structured LM prompts (regulator, journalist, competitor, screen-reader); fixed JSON output per viewpoint {riskiest_line, reason, viewpoint}; return only the highest-risk line across all 4 viewpoints. Test: "best returns in India" superlative should surface regulator viewpoint. Ensure riskiest_span validation — if span not found verbatim in draft, discard output. Build contradiction check against past content: ensure all 5 Stellara Brands past approved blog posts are indexed with sourceType = past_content; verify new draft contradicting old post is detected. |

**Block 6 exit:** Brand Passport created on approval and verifiable. Version timeline and diff view render. Pre-mortem returns correct highest-risk line for demo scenario. Past-content contradiction detected.

---

### BLOCK 7 (Hours 26–30) + Stage 3 Sync at Hour 30
**Theme:** Dashboard, insights, guideline debugger, redaction preview, full demo story verification.

| Who | Tasks to Complete in This Block |
|---|---|
| **S** | Build Guideline Debugger logic: query findings for rules with override rate > 50%; for each, suggest clearer rewording via /rewrite ML call; expose in GET /v1/insights/rules response as {rule, overrideRate, suggestedRewording}. Build redaction preview endpoint: before any external ML call, show user a preview of what content (after redaction) would be sent. Add rules-only mode: if org setting rules_only = true, skip all LM calls and return only exact-rule findings. |
| **F** | Build DashboardPage.jsx: OrgMetricsCard.jsx (total drafts, avg time to approve, open findings count, citation rate), RecentDraftsTable.jsx (status badge, owner, last updated, link to ReviewPage). Build InsightsPanel.jsx: RepeatMistakesChart.jsx (top 5 finding types bar chart), GuidelineDebuggerList.jsx (high-override rules with override rate + suggested rewording + Approve Rewording button). Verify MeaningCheck.jsx displays real ML data end-to-end (not mock data). |
| **O** | Run full demo story end-to-end through ML pipeline: Priya submits draft with 3 seeded issues (returns-policy contradiction + unsupported superlative + expired fact). Verify all 3 findings are returned with correct verdicts and proofPassageIds. Verify fix generation and meaning check work for all 3. Verify past-content contradiction is caught. Document any gaps to fix before Block 8. |

**Block 7 exit:** Dashboard shows live metrics. Guideline Debugger has data. Redaction preview works. Full ML demo story verified for all 3 seeded issues.

**Stage 3 Sync (10 min at Hour 30):** Full Priya demo story run by all three roles. Creator submits → findings appear → accepts fix → manager approves → passport created. All three members confirm journey works end-to-end.

---

## STAGE 4 — HARDENING & DEMO (Blocks 8–10)
**Exit check:** Metrics measured, WCAG pass, end-to-end test passes, demo rehearsed twice.

---

### BLOCK 8 (Hours 30–34)
**Theme:** Security audit, error handling, accessibility pass, evaluation run begins.

| Who | Tasks to Complete in This Block |
|---|---|
| **S** | Security review: manually verify orgId enforced on every MongoDB query. Verify RBAC on every approve/override endpoint. Verify no PATCH/DELETE routes exist for auditLog and passports. Add structured errorHandler.js responses for all error cases: invalid JWT (401), forbidden role (403), draft not found (404), ML timeout (503), schema validation failure (422), upload scan failure (400) — no stack traces in responses. Write unit tests: JWT verification, orgId isolation (orgA cannot return orgB data), SHA-256 passport computation, role checks, finding status transitions. |
| **F** | Accessibility pass Part 1: run axe-core against all 7 pages; fix all colour contrast issues (minimum 4.5:1 for normal text). Accessibility pass Part 2: fix keyboard navigation tab order, focus indicators (2px solid focus ring on all interactive elements), aria-labels on all icon-only buttons, heading hierarchy (single h1 per page). Build and verify all loading states (spinner while review runs), error states (toast on API failure), and empty states (no findings yet, empty dashboard) across all pages. |
| **O** | Run seeded evaluation: submit all ~60 Stellara Brands test drafts through the full ML pipeline. Record recall (planted issues found / planted), precision (correct findings / all flagged), citation rate (findings with valid proofPassageId), confidence calibration. Begin tuning confidence thresholds (default: Contradicted at 0.85, Unclear at 0.60) based on results. |

**Block 8 exit:** Security checklist complete (zero cross-tenant leakage). All pages pass axe automated check. All error/loading/empty states handled. Evaluation numbers measured.

---

### BLOCK 9 (Hours 34–38)
**Theme:** Image checks, end-to-end automated test, deployment finalisation, demo prep.

| Who | Tasks to Complete in This Block |
|---|---|
| **S** | Write automated end-to-end test: login as creator → upload Stellara Brands guideline → submit returns-policy draft → review triggered → 3 findings returned → accept policy fix → login as manager → approve → passport created → verify passport SHA-256 hash. Full test must pass in under 5 minutes. Finalize Docker Compose: health checks on all 5 services, volume mounts for MongoDB data and FAISS index persistence, seed script (seed.js) that loads all demo data on first startup. Verify cold start completes in under 3 minutes. Run API contract tests: every OpenAPI-defined endpoint tested for 400/401/403 compliance. |
| **F** | Demo flow preparation: walk through the full Priya journey manually; write concise 8-minute demo script covering all steps. Prepare fallback screenshots of every key screen in case of live demo failure. Final UI polish: verify all hover states, focus rings, transition animations, loading spinners, status badges. Confirm AI-use disclosure notice appears on all review pages that triggered any LM call. |
| **O** | Build image_analyser.py: OpenCV dominant colour extraction (compare to brand palette in org settings), text-over-image contrast ratio (WCAG luminance formula), alt text presence detection. Wire to /image-check endpoint. Test with a synthetic Stellara Brands social media image. Finalise confidence threshold tuning based on Block 8 evaluation results. Document final threshold values. Write evaluation report (1-page markdown table + 3-sentence interpretation). |

**Block 9 exit:** End-to-end automated test passes. Docker Compose cold start under 3 minutes. Image check endpoint works. Evaluation report with final numbers ready. Demo script written.

---

### BLOCK 10 (Hours 38–40)
**Theme:** Two full demo rehearsals, final fixes, backup recording.

| Who | Tasks to Complete in This Block |
|---|---|
| **All** | **Rehearsal 1:** Somnath deploys from cold start using docker-compose up. Falguni runs the full 8-minute Priya demo covering all 3 roles (creator → manager → reviewer). Om presents the 1-page evaluation report. Somnath walks through Brand Passport and audit log. Target: under 12 minutes total. Log all issues found. |
| **All** | **Fix issues from Rehearsal 1** in priority order: (1) anything that breaks the core workflow, (2) UI rough edges visible to judges, (3) evaluation numbers presentation clarity. |
| **All** | **Rehearsal 2 (final):** Run the full demo with all fixes applied. Record a backup video of the working product. Confirm all 5 judging-criteria talking points are explicitly addressed in the demo script. Product is ready. |

**Block 10 exit:** Demo rehearsed twice. Backup recording saved. All 5 judging criteria covered in the demo script.

---

## Judging-Criteria Coverage Checklist

| Criterion | Points | Covered By | Demo Evidence |
|---|---|---|---|
| Working core workflow | 30 | Falguni (UI) + Somnath (API) + Om (ML) | Upload → submit intent → review findings → accept fix → manager approves → passport created |
| Technical depth and reliability | 25 | Om (ML) + Somnath (audit/passport) | Evidence cards with proofPassageId; NLI confidence scores; SHA-256 Brand Passport; redaction gateway |
| Progress from Round 1 | 20 | All | Contradiction detection, Brand Passport, Redaction Gateway, Claim Shelf-Life all new vs Round 1 |
| Three planned improvements | 15 | Somnath (arch walk-through) | Agent Gate API stub; Rule Simulator design; Voice Fingerprint architecture |
| Usability | 10 | Falguni (demo) | Judges follow Priya's journey without guidance; WCAG AA; AI-use always disclosed |

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

| Risk | Fallback |
|---|---|
| NLI model too slow (> 10 s per draft) | Return exact-rule findings immediately; NLI results append asynchronously |
| Claim-to-source matching too noisy | Limit to numbers, named products, superlatives; skip free-text claims |
| External model provider unavailable | Use rules-only mode; all exact-rule findings still work |
| Node.js/FastAPI integration slips | Somnath mocks ML responses; Om continues; integrate in Block 7 |
| Docker Compose issues | Run services individually with npm start and uvicorn as fallback |

---

## Priority Table (Cut Line)

| Feature | Priority | Owner |
|---|---|---|
| Upload sources with owner, version, expiry | Must | Somnath |
| Rules checks (banned terms, superlatives, alt text) | Must | Om |
| Claim extraction, retrieval, matching | Must | Om |
| Evidence cards and comparison view | Must | Falguni |
| Roles, comments, approvals, version history | Must | Somnath + Falguni |
| Suggested fixes with Intent Lock and meaning check | Must | Om + Falguni |
| Redaction preview, audit log, AI-use notice | Must | Somnath |
| Claim Shelf-Life (Outdated verdict) | Should | Somnath |
| Brand Passport (SHA-256 hash) | Should | Somnath |
| Pre-mortem panel | Should | Om |
| Insights dashboard and Guideline Debugger | Should | Somnath + Falguni |
| Basic image checks | Should | Om |
| Agent Gate API (Phase 2) | Could | Shared |
| Rule Simulator (Phase 2) | Could | Shared |
| Voice Fingerprint (Phase 2) | Could | Shared |

Cut line: Drop from bottom upward. Must rows alone deliver the full demo story and address all 5 judging criteria.

---

*Document version: 3.0 | Hackathon: Codex 48 | 40-Hour Sprint*
