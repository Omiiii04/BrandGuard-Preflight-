# Team Roles

## BrandGuard Preflight — Codex 48 Hackathon (40-Hour Sprint)

> Version: 2.0 | Date: 26 October 2026
> Hackathon: Codex 48 | Duration: 40 Hours

---

## Team Overview

| Member         | Role                                  | Layer Owned               | Primary Judging Impact                             |
| -------------- | ------------------------------------- | ------------------------- | -------------------------------------------------- |
| Somnath        | Team Lead + MERN Full Stack Developer | Backend, APIs, DevOps     | Core workflow (30 pts) + Technical depth (25 pts)  |
| Falguni Sharma | MERN Full Stack Developer             | Frontend (React)          | Usability (10 pts) + Core workflow UI              |
| Om Apar        | AI/ML Specialist                      | Machine Learning (Python) | Technical depth (25 pts) + Evidence-bound findings |

---

## 1. Somnath — Team Lead & Backend Engineer

### Judging Impact Owned

- Working core workflow (30 pts): all API endpoints connecting upload > review > approve > publish
- Technical depth (25 pts): auth, RBAC, tenant isolation, audit log, Brand Passport, Redaction Gateway
- Three planned improvements (15 pts): Agent Gate API stub, Rule Simulator data model, Phase 2 architecture

### Architecture and Leadership

- Owns overall system architecture and the delivery plan
- Chairs 10-minute stage-boundary syncs at Hours 10, 20, 30, and 40
- Owns the OpenAPI 3.1 contract — the definitive boundary between all three layers
- Final decision-maker on scope cut vs. keep when time is short

### Backend and APIs (Node.js + Express)

- REST API design and all versioned endpoint implementations (/v1/*)
- OpenAPI 3.1 specification: request/response schemas for every route
- ML orchestration: internal HTTP calls from Node.js to FastAPI ML service
- Agent Gate API stub in gate.js ready for Phase 2 activation

### Data and Storage

- MongoDB schema design: all 11 collections
- Encrypted object storage integration via MinIO (S3-compatible local store)
- Claim Shelf-Life scheduler: node-cron warns owners 30 days before fact expiry

### Auth and Security

- JWT authentication middleware (verify + inject req.user with userId, orgId, role)
- Role-based access control via requireRole() factory middleware
- Per-organisation tenant isolation: orgId enforced on every query and response
- Redaction gateway: replace confidential terms with [REDACTED] before any external ML call
- Confidential-term tripwire: block drafts mentioning embargoed terms
- Upload scanning: file-type allow-list, 10 MB limit, AV scan stub

### Audit and Governance

- Append-only audit log: every action is an immutable event in auditLog collection
- Brand Passport builder: SHA-256 hash + checksRun[] + rulesVersion + approvers[] + aiUsed flag
- Version manager: create new draft version on each change; compute text diff
- Insights aggregation: per-rule flag counts, override counts, time-to-approval metrics

### Deployment

- Docker Compose configuration for all 5 services (web, api, ml, mongo, minio)
- Environment variable management (.env.example in repo; secrets never committed)
- End-to-end test that replays the full demo story automatically

### Technical Stack Owned

- Node.js + Express
- MongoDB (Mongoose)
- MinIO / S3-compatible storage
- JWT (jsonwebtoken)
- node-cron (Shelf-Life scheduler)
- OpenAPI 3.1 (openapi.yaml)
- Docker + Docker Compose
- Node crypto (SHA-256)

---

## 2. Falguni Sharma — Frontend Engineer

### Judging Impact Owned

- Usability (10 pts): judges must be able to use the product without guidance
- Working core workflow (30 pts): the UI that makes the entire journey visible
- Progress from Round 1 (20 pts): evidence card and comparison view are new; did not exist in Round 1

### UI Architecture (React)

- React application shell: routing, auth screens, design system tokens
- Accessible and responsive targeting WCAG 2.2 Level AA
- Keyboard navigation and sufficient contrast (4.5:1 minimum) throughout
- Automated accessibility checks with axe-core in the build pipeline

### The EvidenceCard — Core UI Primitive

The EvidenceCard is the centrepiece of the product. Each finding renders one card with:

- Exact draft sentence with inline colour-coded highlight
  (green = Supported, red = Contradicted, amber = Unclear, grey = Not Found, orange = Outdated)
- Proof passage panel: source file name, page number, version, expiry date
- Verdict badge: Supported / Contradicted / Outdated / Not Found / Unclear
- Confidence bar: visual percentage representation
- Suggested fix: editable text box pre-filled by the ML service
- Meaning check: kept / changed / dropped per must-say point
- Action buttons: Accept | Edit | Dismiss | Ask Owner

### All Screens Owned by Falguni

- LoginPage: email + password; JWT stored in context on success
- DashboardPage: org metrics card, recent drafts table, insights panel with charts
- KnowledgeBasePage: source uploader (drag-and-drop), source list, fact editor, terminology editor
- DraftSubmitPage: file upload zone + text paste area + intent form (purpose, audience, must-say[])
- ReviewPage: draft viewer with inline highlights, findings sidebar, comparison view, pre-mortem panel
- WorkflowPage: version timeline, diff view, comment thread, approval controls, override modal, AI-use notice
- PassportPage: passport details (hash, checks, approvers, aiUsed flag), tamper check display

### Demo Flow

- Owns the end-to-end demo walkthrough (Priya's journey from intent form to published post)
- Ensures all demo steps are smooth, error states handled, loading states visible
- Prepares fallback screenshots in case of live demo failure

### Technical Stack Owned

- React 18 (hooks, context, React Router v6)
- Vanilla CSS (design tokens: HSL colour palette, spacing scale, Google Font Inter)
- Axios (API calls to Node.js backend only; ML service never contacted from browser)
- axe-core (accessibility testing in build)
- react-diff-viewer or custom diff component
- Vite (build tool and dev server)

---

## 3. Om Apar — AI/ML Specialist

### Judging Impact Owned

- Technical depth (25 pts): ML pipeline is the core differentiator — evidence-bound findings, NLI entailment, vector retrieval
- Working core workflow (30 pts): without the ML pipeline, no findings are produced
- Three planned improvements (15 pts): Voice Fingerprint architecture and prototype

### ML Service Architecture (Python / FastAPI)

- FastAPI service with all 6 internal ML endpoints
- Fixed Pydantic schema validation on every output; non-conforming outputs discarded and logged
- Clean boundary: ML service only called by Somnath's backend, never by the browser

### Document Parsing (parser.py)

- PyMuPDF (fitz): extract text + page positions from PDF files
- python-docx: extract text from DOCX files
- Tesseract OCR: extract text from image regions within documents

### Claim Extraction (claim_extractor.py)

- Rule-based patterns: numbers, dates, percentages, product names, superlatives (best/only/fastest/leading), promotional phrases
- Small LM-assisted step for ambiguous cases
- Output: Claim[]{text, span, type: numerical | superlative | temporal | promotional | terminology}

### Retrieval and Indexing (embedder.py + retriever.py)

- Multilingual sentence-transformers model
- Vector index: FAISS or ChromaDB with per-org isolation (separate index per orgId)
- Passages stored with: sourceId, version, page number, expiry date
- Past approved content indexed alongside guideline documents (enables contradiction detection)

### Judgement Pipeline (judge.py)

- Stage 1 Exact Rules: banned terms, banned superlatives, accessibility violations > Violated (confidence 1.0)
- Stage 2 NLI Entailment: cross-encoder/nli-deberta-v3-base
  - entails = Supported, contradicts = Contradicted, neutral = Unclear
- Expiry override: if retrieved passage expired > Outdated (regardless of entailment result)
- No passage found: verdict = Not Found (never stored as violation; goes to human reviewer)
- Confidence: softmax probability, calibrated on evaluation set

### Fix Generation and Intent Lock (rewriter.py + meaning_check.py)

- LM-constrained fix: must use only retrieved facts and respect creator's stated intent
- Meaning check: compare original must-say list against fix; label each point: kept / changed / dropped
- Output shown to creator so they can verify fix preserves their purpose

### Pre-mortem (premortem_engine.py)

- Four structured prompts: regulator, journalist, competitor, screen-reader user
- Fixed JSON output per viewpoint: {riskiest_line, reason, viewpoint}
- Only the single highest-risk line across all viewpoints surfaced to the creator

### Confidential Term Detection (entities.py)

- Named entity recognition for embargoed product names, client names, org-specific watchlist terms
- Output feeds directly into Somnath's redaction gateway

### Image Checks (image_analyser.py)

- OpenCV: colour palette extraction, text-over-image contrast ratio (WCAG formula)
- Alt text presence detection
- Logo template matching (stretch goal)

### Evaluation

- Seeded test set: ~60 drafts for Stellara Brands with planted issues
- Metrics: recall (found/planted), precision (correct/flagged), citation rate (findings with proofPassageId), confidence calibration
- Wrong findings reported by reviewers added to the test set
- Evaluation report with final numbers prepared before the demo

### Technical Stack Owned

- Python 3.11+
- FastAPI + Uvicorn
- PyMuPDF (fitz), python-docx, Tesseract
- sentence-transformers (HuggingFace)
- FAISS or ChromaDB
- spaCy (rule-based extraction helpers)
- cross-encoder/nli-deberta-v3-base (entailment model)
- OpenCV (image analysis)
- External LM client (configurable; no-training, no-retention terms; can be switched off)

---

## 4. Shared Responsibilities

| Responsibility                             | Who                                                            |
| ------------------------------------------ | -------------------------------------------------------------- |
| OpenAPI 3.1 contract                       | Somnath leads; Om and Falguni review and agree before frozen   |
| Internal ML API schemas                    | Om leads; Somnath reviews and agrees                           |
| Demo story content (Stellara Brands)       | Om provides synthetic data; Falguni runs demo; Somnath deploys |
| Evaluation results presentation            | Om leads; Somnath supports deployment; Falguni shows UI        |
| Integration testing at each stage boundary | All; each tests own contract boundaries                        |
| Security review                            | Somnath leads; Om reviews ML-side data handling                |
| Accessibility review                       | Falguni leads; Somnath validates server-side disclosures       |

---

## 5. Communication and Decision-Making

Stage syncs: 10-minute check-in at Hours 10, 20, 30, and 40.

Contract freeze: OpenAPI contract and ML API schemas frozen after Stage 1 sync.
Any change requires all three members to agree and must be committed immediately.

Blocker protocol: Any blocker surfaced in team chat immediately.
Default resolution: blocked person mocks the dependency and continues; owner fixes and integrates.

Scope decisions: If cut line needs to move, Somnath makes the call with input from all three.
Cut line is the bottom of the priority table in the Implementation Roadmap.

---

## 6. Individual Research Domains

| Member  | Research Domain                                                                                                                                                                                                                                                      | Key Design Decision Applied                                                                                                                                                                        |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Somnath | Role-based review workflows; securing confidential uploads; LLM application risks (OWASP LLM Top 10); content hashing; API design                                                                                                                                    | Four roles; per-org isolation; encrypted storage; redaction gateway; versioned REST API; SHA-256 Brand Passport; append-only audit log                                                             |
| Falguni | How reviewers consume feedback (inline highlights, side-by-side, threaded comments); WCAG 2.2 AA; existing brand-governance tools and what their review screens miss                                                                                                 | Evidence card as core screen; proof panel and comparison view; WCAG AA throughout; AI-use notice always visible                                                                                    |
| Om      | Claim extraction and claim-to-source matching; hallucination vs. faithfulness (Berkeley SCET: factuality and faithfulness are distinct failure types); tone modelling; contradiction detection; image checks; evaluation (precision, recall, confidence calibration) | Evidence-bound findings (no source = no violation); ungrounded output shown as question not violation; tone advisory only; NLI entailment as primary judge; seeded test set with published metrics |

---

*Document version: 2.0 | Hackathon: Codex 48 | 40-Hour Sprint*
