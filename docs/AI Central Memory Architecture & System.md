# AI Central Memory Architecture & System
## BrandGuard Preflight — Codex 48 Hackathon (40-Hour Sprint)

> Version: 2.0 | Date: 26 October 2026
> Owner: Om Apar (AI/ML Specialist)
> Implementation files: ml_service/pipeline/ (all files), ml_service/indexes/, ml_service/evaluation/

---

## 0. Judging Criteria Alignment

| Criterion | Points | How This Module Addresses It |
|---|---|---|
| Working core workflow | 30 | Memory is the ground truth the entire review pipeline depends on; without it no findings are produced |
| Technical depth and reliability | 25 | 5-layer memory architecture, per-org FAISS/Chroma isolation, NLI entailment, Claim Shelf-Life, ruling memory |
| Progress from Round 1 | 20 | Layer 4 (past approved content contradiction) and Layer 5 (ruling memory) are new vs Round 1 |
| Three planned improvements | 15 | Voice Fingerprint requires the embedding infrastructure already built for retrieval |
| Usability | 10 | Memory quality directly determines whether findings are useful and trustworthy to reviewers |

---

## 1. Overview

BrandGuard Preflight's AI Central Memory is the system that gives the ML pipeline its ground truth.
It is not a general-purpose knowledge graph; it is a tightly scoped, organisation-owned memory of
approved facts, source passages, past rulings, and past published content.
Every AI-generated finding must cite a unit from this memory, or it is classified as a question
and sent to a human — never shown as a violation.

Core principle: No source in memory = no violation. AI may only assert what it can prove.

---

## 2. Memory Architecture

### 2.1 Five Memory Layers (per-org, isolated by orgId)

```
+============================================================+
|              ORGANISATION MEMORY SPACE                      |
|              (per-org, isolated by orgId)                   |
+============================================================+
|                                                             |
|  Layer 1: SOURCE DOCUMENTS                                  |
|  Files: ml_service/pipeline/parser.py                       |
|  backend/src/models/Source.js                               |
|  PDF, DOCX, Markdown uploads                                |
|  Owner | Version | Effective Date | Expiry Date             |
|  Status: active / expired / superseded                      |
|                                                             |
|  Layer 2: PASSAGE INDEX (Vector)                            |
|  Files: ml_service/pipeline/embedder.py, retriever.py       |
|  backend/src/models/Passage.js                              |
|  Granular text chunks from Layer 1 (512 tokens, 64 overlap) |
|  sourceId | version | page | text | embeddingRef            |
|  Stored in FAISS or Chroma (per-org index in indexes/)      |
|                                                             |
|  Layer 3: STRUCTURED FACTS                                  |
|  Files: backend/src/models/Fact.js, routes/facts.js         |
|  Discrete approved claims                                   |
|  statement | value | evidenceLink | owner | expiry          |
|  supersedes (links to previous version of this fact)        |
|  = Claim Shelf-Life implementation                          |
|                                                             |
|  Layer 4: PAST APPROVED CONTENT  [NEW vs Round 1]           |
|  Files: ml_service/pipeline/embedder.py (sourceType filter) |
|  Previously approved and published drafts                   |
|  Indexed in vector store alongside guidelines               |
|  = Self-contradiction check source                          |
|                                                             |
|  Layer 5: RULING MEMORY  [NEW vs Round 1]                   |
|  Files: backend/src/models/Fact.js (savedAsRule=true)       |
|  Decisions made by authorised reviewers                     |
|  claim | verdict | reason | ruledBy | date | claimEmbedding |
|  Surfaces as instant resolution when same claim appears     |
|                                                             |
+============================================================+
```

### 2.2 Memory Lifecycle (Source Upload to Ready)

```
Knowledge Owner uploads source
        |
        v
uploadScan.js: file-type allow-list, 10 MB limit, AV scan
        |
        v
File stored encrypted in MinIO (S3-compatible)
        |
        v
parser.py: PyMuPDF (PDF text + page positions)
           python-docx (DOCX text)
           Tesseract (image OCR)
        |
        v
Chunker: splits into passages
   max 512 tokens, 64 token overlap
   preserves sentence boundaries
        |
        v
embedder.py: sentence-transformers model
   generates embedding vector per passage
        |
        v
Vector index (FAISS or Chroma):
   per-org partition in ml_service/indexes/{orgId}/
   stores: passage text + embedding + sourceId + version + page + expiryDate
        |
        v
MongoDB passages collection updated
   embeddingRef: index entry ID
   orgId: for isolation
        |
        v
Source status: ACTIVE
   Ready for retrieval at review time
   AuditLog event: source_indexed
```

---

## 3. Claim Shelf-Life System

Every fact in memory has a finite valid life. The Claim Shelf-Life mechanism implements this.

### 3.1 Fact Data Model (ml_service: facts referenced via passages; backend: Fact.js)

```json
{
  "statement": "Stellara Brands offers free returns within 30 days",
  "value": "30 days",
  "evidenceLink": "<passageId pointing to Returns Policy v2, page 3>",
  "owner": "<userId of Support team lead>",
  "expiryDate": "2027-03-31T00:00:00Z",
  "supersedes": "<factId of previous 14-day policy or null>",
  "status": "active"
}
```

### 3.2 Shelf-Life State Machine

```
ACTIVE
  |
  | (30 days before expiryDate)
  v
EXPIRING SOON
  shelfLifeScheduler.js fires daily cron
  AuditLog event: expiry_warning
  In-app notification sent to owner
  |
  | (on expiryDate)
  v
EXPIRED
  All findings against this fact: verdict = Outdated
  Drafts using this claim are flagged for review
  |
  | (owner uploads new version or renews)
  v
SUPERSEDED
  Old fact: status = superseded
  New fact: status = active
  Historical findings retain reference to the version they were checked against
```

### 3.3 Conflict Resolution

When two active sources contradict each other (e.g. two fact sheets with different return periods):
- System does NOT guess which is correct
- Finding is surfaced as: verdict = Unclear; reason = "Sources disagree"
- Routed to Knowledge Owner to resolve
- No external model is called for this judgement

---

## 4. Retrieval Pipeline

### 4.1 Full Retrieval Flow for One Claim

```
Claim: "Free returns within 14 days"
        |
        v
Step 1: Exact rule check (judge.py Stage 1)
   Is this a banned term? No
   Is this an unqualified superlative? No
   Is there an accessibility violation? No
   --> Proceed to semantic retrieval
        |
        v
Step 2: Query vector index (retriever.py, per-org partition)
   Embed claim with same sentence-transformers model
   k-NN lookup: retrieve top-5 passages by cosine similarity
   Filter: only ACTIVE sources (expiryDate > today)
   Also retrieve from: Layer 4 (past approved content, sourceType = past_content)
        |
        v
Step 3: Candidate passages returned (example for Stellara Brands demo)
   - Returns Policy v2, page 3: "...within 30 days of delivery"  [ACTIVE]
   - FAQ v1, page 7: "...14-day return window"  [EXPIRED]
   - Past blog post (Layer 4): "We offer 14-day returns"  [ACTIVE, past_content]
        |
        v
Step 4: Entailment judgement per candidate (judge.py Stage 2)
   - Claim vs Returns Policy v2, page 3: Contradicted (confidence 0.92)
   - Claim vs FAQ v1, page 7: Outdated (source expired)
   - Claim vs past blog post: Contradicted (self-contradiction, confidence 0.88)
        |
        v
Step 5: Select winning verdict
   Highest confidence from ACTIVE non-expired source wins
   proofPassageId = Returns Policy v2, page 3
   Verdict: Contradicted, confidence: 0.92
        |
        v
Step 6: Fix generation (rewriter.py)
   LM constrained to: Returns Policy v2 passage + intent form must-say points
   Fix: "Free returns within 30 days."
   meaning_check: kept=[free returns, time limit]; changed=[14>30 days]; dropped=[]
```

### 4.2 Retrieval Parameters

| Parameter | Default Value | Note |
|---|---|---|
| Embedding model | sentence-transformers/all-MiniLM-L6-v2 | Upgrade to multilingual model for Phase 2 |
| Chunk size | 512 tokens | Balance between context and precision |
| Chunk overlap | 64 tokens | Preserve sentence boundaries |
| Top-K retrieval | 5 | Tune based on evaluation results |
| Similarity threshold | 0.60 | Below this: Not Found (question, not violation) |
| Violation confidence threshold | 0.85 | Below this: Unclear (question, not violation) |

---

## 5. Judgement Pipeline (judge.py)

### 5.1 Verdict Assignment Logic

```python
# judge.py — simplified pseudocode
def assign_verdict(claim, retrieved_passages, rules_results, org_settings):

    # Stage 1: Exact rules (deterministic, highest priority, confidence = 1.0)
    for rule in rules_results:
        if rule.matched:
            return Finding(
                verdict="Violated",
                confidence=1.0,
                proofPassageId=rule.ruleId,
                type="violation",
                ruleId=rule.id
            )

    # Expiry check
    active_passages = [p for p in retrieved_passages if p.expiryDate > now]
    if len(retrieved_passages) > 0 and len(active_passages) == 0:
        return Finding(verdict="Outdated", confidence=0.95, type="violation",
                       proofPassageId=retrieved_passages[0].id)

    # Sources disagree check
    if len(active_passages) == 0:
        return Finding(verdict="Not Found", confidence=0.0, type="question")

    # Stage 2: NLI entailment (cross-encoder/nli-deberta-v3-base)
    verdicts = [nli_model.predict(claim, p.text) for p in active_passages]
    # entails > Supported; contradicts > Contradicted; neutral > Unclear

    contradictions = [v for v in verdicts if v.label == "Contradicted"]
    supports = [v for v in verdicts if v.label == "Supported"]

    if contradictions and supports:
        # Sources disagree
        return Finding(verdict="Unclear", confidence=0.50, type="question",
                       note="Sources disagree")

    best = max(verdicts, key=lambda v: v.confidence)

    if best.confidence >= VIOLATION_THRESHOLD:  # 0.85
        f_type = "violation" if best.label == "Contradicted" else "verification"
        return Finding(verdict=best.label, confidence=best.confidence,
                       proofPassageId=best.passageId, type=f_type)
    elif best.confidence >= QUESTION_THRESHOLD:  # 0.60
        return Finding(verdict="Unclear", confidence=best.confidence, type="question")
    else:
        return Finding(verdict="Not Found", confidence=best.confidence, type="question")
```

### 5.2 Pydantic Schema Validation Gate (schemas/responses.py)

All 6 ML endpoints return Pydantic-validated outputs.
Non-conforming outputs raise ValidationError, caught by FastAPI router,
logged as AuditLog event: ml_response_discarded,
and a safe empty result is returned to Node.js backend.

```python
class FindingResult(BaseModel):
    verdict: Literal["Supported", "Contradicted", "Outdated", "Not Found", "Unclear", "Violated"]
    confidence: float = Field(ge=0.0, le=1.0)
    type: Literal["violation", "question", "verification"]
    proofPassageId: Optional[str] = None
    suggestedFix: Optional[str] = None
    meaningCheck: Optional[MeaningCheck] = None
    ruleId: Optional[str] = None

    @validator("proofPassageId", always=True)
    def proof_required_for_violation(cls, v, values):
        if values.get("type") == "violation" and not v:
            raise ValueError("proofPassageId is required for type=violation")
        return v
```

---

## 6. Ruling Memory (Rulings Become Knowledge)

### 6.1 Purpose

When an authorised reviewer rules on a finding, that ruling can be saved as a permanent fact
in the organisation's memory (POST /v1/facts with savedAsRule=true).
The next time an identical or highly similar claim appears, it resolves automatically.

### 6.2 Ruling Data Model (Fact.js with savedAsRule=true)

```json
{
  "orgId": "<orgId>",
  "claim": "Stellara Brands has the best returns in India",
  "claimEmbedding": "<vector from sentence-transformers>",
  "ruling": "rejected",
  "reason": "Superlative cannot be substantiated; no comparative market data available",
  "ruledBy": "<reviewerId>",
  "ruledAt": "2026-10-25T14:00:00Z",
  "savedAsRule": true,
  "ruleText": "Do not use comparative superlatives about returns policy without cited market data"
}
```

### 6.3 Ruling Retrieval at Review Time

```
New claim: "We have the fastest delivery in India"
        |
        v
retriever.py: check ruling memory (cosine similarity >= 0.90 threshold)
        |
        v
Match found: ruling on "best returns in India" superlative
Similarity: 0.93 (both are comparative superlatives without evidence)
        |
        v
Finding created:
  verdict: Contradicted (against the ruling)
  confidence: 0.93
  proofPassageId: ruling memory entry ID
  note: "A reviewer previously rejected a similar superlative claim.
         Reason: Superlatives require cited market data."
        |
        v
Creator shown existing ruling immediately, without waiting for a reviewer
```

---

## 7. Pre-Mortem Memory Module (premortem_engine.py)

### 7.1 Four Viewpoints and Prompts

| Viewpoint | Question Asked | File |
|---|---|---|
| Regulator | What claim could trigger advertising standards or consumer protection scrutiny? | premortem_engine.py |
| Journalist | What single sentence could be taken out of context for a damaging headline? | premortem_engine.py |
| Competitor | What claim could be used against this brand in comparative advertising? | premortem_engine.py |
| Screen-reader user | What accessibility failure (no alt text, unclear structure, jargon) would this user encounter? | premortem_engine.py |

### 7.2 Fixed Output Schema (Pydantic validated)

```json
{
  "riskiest_span": "Free returns within 14 days",
  "viewpoint": "regulator",
  "reason": "The stated return period contradicts the current policy. A regulator reviewing a complaint could cite this as a misleading claim.",
  "confidence": 0.88
}
```

Only the single highest-confidence risk across all 4 viewpoints is surfaced in the UI pre-mortem panel.
The full 4-viewpoint analysis is available via "View full pre-mortem" expand.

### 7.3 Riskiest-Span Validation

Before accepting the pre-mortem output, the pipeline verifies that riskiest_span is a verbatim
substring of the original draft. If not, the output is discarded as hallucinated.
This is one of the content rejection rules in the Prompt Governance Specification.

---

## 8. Confidential-Term Memory (Tripwire)

### 8.1 Watchlist (Organisation.watchlist[] in MongoDB)

Each organisation maintains a watchlist:
- Embargoed product names (unreleased products, e.g. "Project Nova")
- Embargoed client names (unannounced partnerships)
- Internal project codenames
- PII categories specific to the org

### 8.2 Detection Flow (entities.py + redactionGateway.js)

```
Draft content
     |
     v (entities.py called by mlOrchestrator BEFORE any external call)
spaCy NER + watchlist exact-match
     |
     v
Confidential term found?
  YES --> Block draft from external services
          Show creator: "This draft contains an embargoed term.
                         External review has been paused."
          Offer redacted preview (term replaced with [REDACTED])
          AuditLog event: confidential_term_blocked
  NO  --> redactionGateway.js: replace remaining sensitive-category
          terms with [REDACTED] placeholders
          Show user redaction preview before any external call
          Proceed with external model (if org setting allows)
```

---

## 9. Evaluation and Memory Quality

### 9.1 Seeded Test Set (evaluation/test_set.json)

~60 synthetic drafts for fictional company Stellara Brands.
Planted issues per draft:
- Contradiction against Returns Policy v2 (14 days vs 30 days)
- Unsupported superlative ("best returns in India")
- Outdated fact (reference to expired FAQ v1)
- Banned term from org watchlist ("Project Nova" embargoed product)
- Missing alt text in image-containing draft
- Self-contradiction against a past approved blog post

### 9.2 Metrics Tracked (evaluation/evaluator.py)

| Metric | Target | Description |
|---|---|---|
| Recall | >= 80% | Of all planted issues, how many were caught |
| Precision | >= 80% | Of all findings raised, how many were correct |
| Citation rate | >= 95% | Of all findings, what fraction cited a source proofPassageId |
| Contradiction catch rate | >= 85% | Of all planted contradictions, how many were caught |
| Confidence calibration | within 5% | 90% confident should be correct ~90% of the time |
| False positive rate | <= 20% | Findings raised on clean content |

### 9.3 Continuous Improvement Protocol

1. Wrong findings reported by reviewers are immediately added to test_set.json.
2. Full evaluation run after every threshold change (python evaluator.py).
3. Confidence thresholds tuned to maximise recall while keeping false positive rate <= 20%.
4. No retraining on customer content (provider terms and architecture both prevent it).
5. Final evaluation report prepared before demo with all 6 metrics measured.

---

## 10. Memory Security

| Control | Implementation | File |
|---|---|---|
| Per-org vector index partition | FAISS/Chroma index per orgId; cross-org queries architecturally impossible | ml_service/indexes/{orgId}/ |
| No raw content to external model | Redaction gateway before any external call | backend/src/middleware/redactionGateway.js |
| Embedding privacy | Embeddings in ML service only; not in MongoDB; orgId as partition key | ml_service/pipeline/embedder.py |
| Ruling memory access | Read/write by authorised reviewer and Knowledge Owner roles only | backend/src/middleware/rbac.js |
| Memory deletion | Configurable retention per org; deletion cascades through passages, facts, embeddings | backend/src/models/*.js |
| orgId isolation in retrieval | Every k-NN query filtered by orgId; passed as metadata filter to FAISS/Chroma | ml_service/pipeline/retriever.py |

---

*Document version: 2.0 | Hackathon: Codex 48 | 40-Hour Sprint*
