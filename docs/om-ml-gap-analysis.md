# Om ML gap analysis

Baseline: 27 backend tests passed and 11 test files failed before loading because
Node dependencies are not installed; the frontend build could not find Vite; the
ML suite had no tests. These are environment/setup failures, not fresh ML
regressions.

| Roadmap | Current state | Gap / dependency |
| --- | --- | --- |
| Blocks 1-2: typed ML boundary, corpus, parsing/retrieval | Partial: `ml_service/app/main.py` has an in-memory two-passage Stellara fixture and untyped request dictionaries | Add typed validation at the service boundary and deterministic tenant/expiry-aware retrieval; backend remains the owner of ingestion and persistence |
| Blocks 3-4: claims, rules, NLI fallback, fixes | Partial: only a few hard-coded regexes and verdicts exist | Add exact offsets, focused numeric/superlative rules, supported/not-found paths, grounded fixes, and intent checks |
| Block 5: entities | Partial: `/detect-entities` only emits a hard-coded ORG with incorrect offsets | Add case-insensitive configured watchlist matching and stable entity spans |
| Block 6: pre-mortem and past content | Partial: `/premortem` returns a fixed response that does not match the documented risk schema | Return contract-compatible, draft-grounded risk lines and preserve the four required viewpoints |
| Block 9: image checks | Missing: `/image-check` always returns an empty result | Add deterministic palette, WCAG contrast, and alt-text checks for supplied image metadata/pixels |
| Blocks 7-8: evaluation | Missing | Add only after the core endpoint contract is stable; no honest metrics exist yet |
| Integration | Partial: backend calls `POST /extract-claims` with redacted `content`, `orgId`, and `intent` and validates claim fields | Preserve the existing envelope and fields; install dependencies before full backend/frontend integration verification |

The implementation below keeps the existing FastAPI routes and response enums,
does not add model downloads, and treats absent evidence or unavailable image
metadata honestly.
