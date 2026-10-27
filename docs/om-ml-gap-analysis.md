# Om ML gap analysis

Current verification baseline: the backend, ML, and frontend dependencies are
installed; the Docker stack is healthy; and the real-source integration path is
covered by the live integration script.

| Roadmap | Current state | Gap / dependency |
| --- | --- | --- |
| Blocks 1-2: typed ML boundary, corpus, parsing/retrieval | Partial: `ml_service/app/main.py` has an in-memory two-passage Stellara fixture and untyped request dictionaries | Add typed validation at the service boundary and deterministic tenant/expiry-aware retrieval; backend remains the owner of ingestion and persistence |
| Blocks 3-4: claims, rules, NLI fallback, fixes | Partial: only a few hard-coded regexes and verdicts exist | Add exact offsets, focused numeric/superlative rules, supported/not-found paths, grounded fixes, and intent checks |
| Block 5: entities | Partial: `/detect-entities` only emits a hard-coded ORG with incorrect offsets | Add case-insensitive configured watchlist matching and stable entity spans |
| Block 6: pre-mortem and past content | Partial: `/premortem` returns a fixed response that does not match the documented risk schema | Return contract-compatible, draft-grounded risk lines and preserve the four required viewpoints |
| Block 9: image checks | Missing: `/image-check` always returns an empty result | Add deterministic palette, WCAG contrast, and alt-text checks for supplied image metadata/pixels |
| Blocks 7-8: evaluation | Missing | Add only after the core endpoint contract is stable; no honest metrics exist yet |
| Integration | Implemented: authenticated source uploads are stored in MinIO/Mongo, parsed by ML, and indexed under `/app/indexes`; review retrieves only the requesting organisation's active passages | Lexical overlap is deterministic but not semantic; OCR and heavyweight NLI remain future work |

## Phase 2 ingestion design

- `parser.py` extracts PDF text with 1-based page numbers, DOCX paragraphs/tables,
  and UTF-8 Markdown/text. Empty, malformed, unsupported, and image-only PDFs
  return structured errors; OCR is intentionally unsupported.
- `PersistentLexicalIndex` stores deterministic passages in `passages.json` on
  the existing `faiss_data` volume. Passage IDs are SHA-256 values, while the
  MongoDB `sourceId` is retained separately. Re-ingesting the same source
  replaces its passages, so retries are idempotent.
- Retrieval is lexical token overlap, scoped by `orgId`, and excludes expired,
  superseded, blocked, processing, and error sources. It is not vector or
  semantic search.
- Backend calls the authenticated ML `/index-source` endpoint after MinIO and
  Mongo persistence. Sources stay `processing` until indexing succeeds and move
  to `error` on failure. `ML_INTERNAL_TOKEN` is shared only between backend and
  ML; `DEMO_MODE=false` is the normal default.
- Fixture passages remain available only when `DEMO_MODE=true` or when explicit
  passages are supplied by a controlled test call. Normal requests with no
  indexed source return no fabricated proof or evidence.

The implementation below keeps the existing FastAPI routes and response enums,
does not add model downloads, and treats absent evidence or unavailable image
metadata honestly.
