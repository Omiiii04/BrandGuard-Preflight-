# Product Requirements Document (PRD)
## BrandGuard Preflight — Inkloom AI | Codex 48 Hackathon (40-Hour Sprint)

> Version: 2.0 | Date: 26 October 2026
> Team: Somnath (Team Lead, MERN Full Stack) | Falguni Sharma (MERN Full Stack) | Om Apar (AI/ML)

---

## 0. Judging Criteria Alignment

| Criterion | Points | How This PRD Addresses It |
|---|---|---|
| Working core workflow | 30 | End-to-end journey defined: upload > submit intent > review findings > accept fix > approve > publish |
| Technical depth and reliability | 25 | Evidence-bound findings, NLI entailment, RBAC, tenant isolation, audit log, Brand Passport all specified |
| Progress from Round 1 | 20 | Contradiction check, Claim Shelf-Life, Brand Passport, Redaction Gateway, Intent Lock all new vs Round 1 |
| Three planned improvements | 15 | Agent Gate API, Rule Simulator, Voice Fingerprint defined with clear value propositions |
| Usability | 10 | Every screen defined from the user's perspective; WCAG 2.2 AA required; AI-use always disclosed |

---

## 1. Executive Summary

BrandGuard Preflight is an AI-assisted brand compliance platform that checks every content draft before it is published.
It compares each claim in a draft against the company's own approved guidelines, facts, and past published content.
When a problem can be proven with a cited source, Preflight shows the proof and suggests a fix that preserves the writer's intent.
When it cannot prove it either way, a human decides.

Core value proposition:
Instead of judging how content sounds, Preflight checks what it says — against the company's own approved facts
and its published history — and every human ruling becomes knowledge it can reuse.

---

## 2. Problem Statement

### 2.1 The Gap

Most growing companies have brand guidelines, but in practice nobody checks content against them.
Writing now comes from employees, agencies, and AI tools. Mistakes — wrong claims, old prices,
off-tone wording, off-brand images — often reach the public before anyone spots them.

### 2.2 Market Evidence

| Statistic | Source |
|---|---|
| 85% of organisations have brand guidelines; only ~30% enforce them consistently | Marq (Lucidpress) |
| 77% regularly deal with off-brand content | Marq |
| 47.1% of marketers encounter AI inaccuracies several times a week | NP Digital (565 US marketers, Feb 2026) |
| 36.5% say incorrect AI content has already gone public | NP Digital |
| 70%+ spend 1-5 hours/week fact-checking AI content | NP Digital |
| 50% of consumers prefer brands that avoid GenAI in consumer-facing content | Gartner (1,539 US consumers, Mar 2026) |

### 2.3 Root Causes

1. Guidelines written for people, not machines — rules like "keep a friendly but professional tone" cannot be checked consistently.
2. Facts have no owner and no expiry date — prices, policies, and customer counts change but old copies persist everywhere.
3. Feedback comes late and without proof — problems surface after publishing or after several review rounds.

### 2.4 A Typical Failure (Step by Step)

| Step | What Happens | Where It Goes Wrong |
|---|---|---|
| 1 | Returns policy changes from 14 days to 30 days | No one updates older posts, decks, or FAQs |
| 2 | Agency writer drafts post from old brief saying "14 days" | Guidelines don't mention return periods |
| 3 | AI tool rewrites post, adds "best returns in India" | New superlative has no evidence |
| 4 | Brand manager skims and approves | Fact-checking was never part of the review |
| 5 | Post goes live; customer quotes it at support desk | Error found after damage is done |

Preflight intervenes at steps 2 and 3: shows the writer the current policy next to the draft,
and routes the unsupported superlative to legal before the manager ever sees it.

---

## 3. Target Users

Designed for growing companies of 100 to 2,000 people.

| Persona | Core Need | Main Fear |
|---|---|---|
| Creator (marketer, sales rep, agency writer) | Fast feedback with proof; fixes that keep my message | Vague rejections |
| Brand Manager | Catch issues before publishing; stop repeat mistakes | Becoming the manual bottleneck |
| Authorised Reviewer (legal, product, compliance) | Only items needing expert eyes, with evidence attached | Approving something unsupported |
| Knowledge Owner / Admin | One place to keep facts current | Stale or leaked material |
| Leadership | Proof that risk is falling | A public brand incident |

---

## 4. Product Goals

### 4.1 MVP Goals (40-Hour Sprint)
1. Catch problems BEFORE publication, not after.
2. Base every judgement on the organisation's OWN approved material.
3. Explain each issue with a fix that KEEPS THE WRITER'S PURPOSE.
4. Route uncertain or risky items to the RIGHT PERSON with evidence ready.
5. Keep confidential material INSIDE THE ORGANISATION; disclose AI use clearly.
6. Show where the GUIDELINES THEMSELVES are the problem, so mistakes stop repeating.

### 4.2 Design Tensions and Positions

| Tension | Our Position |
|---|---|
| Speed vs control | Automate only what can be proven exactly; route everything unproven to a person with evidence |
| Catching more vs being trusted | Prefer fewer, sourced findings over many guesses — a tool that cries wolf gets ignored |
| AI help vs confidentiality | Local-first design; redaction preview before any external call; rules-only mode available |
| Strict rules vs creative freedom | Suggestions are opt-in; overrides need a written reason; repeated overrides signal an unclear rule |

---

## 5. Core Features (MVP)

### 5.1 The Three Tests Every Draft Must Pass

| Test | Question | Checked Against |
|---|---|---|
| Truth | Is every claim consistent with approved guidelines, facts, and the brand's own published history? | Uploaded guidelines, fact sheets, claim evidence, past approved content |
| Risk | How could this be misread or quoted against us? | Hostile-reader pre-mortem; confidential-term watchlist |
| Intent | Do suggested fixes still say what the creator meant? | Creator's stated purpose, audience, and must-say points |

### 5.2 The Evidence Card — Nothing Flagged Without All Three Parts

| Part | Shows |
|---|---|
| Draft | The exact sentence, highlighted inline |
| Proof | Matching passage from uploaded source or past content (file name, page, version, expiry date) |
| Verdict | Supported / Contradicted / Outdated / Not Found / Unclear + confidence level |

### 5.3 Feature Table

| Capability | What It Does | Phase |
|---|---|---|
| Knowledge Base | Upload PDF/DOCX/MD guidelines, facts, terminology, past content; owner, version, expiry on every item | MVP |
| Content Review | Text, DOCX, PDF; findings mapped to character span in document | MVP |
| Detection | Terminology, facts, claims, visual usage, accessibility checks | MVP |
| Evidence Cards and Suggestions | Why flagged, which source, suggested fix; accept/edit/dismiss | MVP |
| Review Workflow | Roles, comments, approvals, assignments, revision history with diffs | MVP |
| Claim Shelf-Life | Expiry dates on facts; 30-day owner warnings; Outdated verdict | MVP |
| Brand Passport | SHA-256 hash + checks run + rules version + approvers + AI-use flag; tamper-detectable | MVP |
| Pre-mortem | Highest-risk line from 4 viewpoints (regulator, journalist, competitor, screen-reader) | MVP |
| Redaction Preview and Zero-Egress Mode | Confidential terms replaced with placeholders before any external call; rules-only mode | MVP |
| Insights Dashboard | Repeated mistakes, unclear rules, time to approval, Guideline Debugger | MVP |
| Agent Gate API | External AI tools get a Preflight verdict before publishing | Phase 2 |
| Rule Simulator | Test a guideline change on the last 100 drafts before enabling it | Phase 2 |
| Voice Fingerprint | Tone-drift metre learned from approved posts | Phase 2 |

### 5.4 Ten Unique Differentiating Features

| # | Feature | What It Does |
|---|---|---|
| 1 | Evidence-bound findings | A finding must cite a passage in the org's own uploads; no source = Not Found; human asked |
| 2 | Self-contradiction check | Compares draft against everything the brand already published, not just the rulebook |
| 3 | Claim Shelf-Life | Every approved fact has owner + expiry; owners warned 30 days ahead; expired facts = Outdated |
| 4 | Intent Lock with meaning check | Creator states purpose + must-say points; every fix shows what was kept, changed, or dropped |
| 5 | Hostile-reader pre-mortem | Shows the single line most likely to be quoted against the brand, with viewpoint and reason |
| 6 | Rulings become knowledge | Reviewer decisions saved as approved facts/rules; same question auto-resolved in future reviews |
| 7 | Guideline Debugger | Highlights rules often overridden or disputed; suggests clearer wording |
| 8 | Brand Passport | Each approved asset: SHA-256 hash, checks run, rules version, approvers, AI-use flag; tamper-detectable |
| 9 | Redaction preview and zero-egress mode | Confidential terms replaced before any external AI call; user sees preview |
| 10 | Confidential-term tripwire | Blocks drafts mentioning embargoed names before announcement date |

---

## 6. Automation vs Human Decision Matrix

| Situation | System Does | Who Acts |
|---|---|---|
| Claim matches an approved fact exactly | Marks Supported; logs event | Nobody |
| Exact rule broken (banned term, low contrast, no alt text) | Flags with rule and suggested fix | Creator |
| Draft contradicts a source (confidence >= 0.85) | Shows both passages and a correction | Creator, then manager |
| Source expired, or two sources disagree | Does NOT guess; asks the owner | Knowledge owner |
| No proof found | Shown as a question, never a violation | Right reviewer |
| Low confidence or risky topic (legal, health, finance, comparisons) | Packs evidence and queues it | Authorised reviewer |
| Reviewer rules on an item | Records reason; offers to save as approved fact or rule | Owner confirms |

---

## 7. Success Metrics and Definition of Done

### 7.1 Definition of Done (MVP)
- User can upload sources, submit a draft with intent form, and get findings that each cite a source passage.
- Returns-policy contradiction, unsupported superlative, and expired fact all caught in the demo.
- Creator, manager, and reviewer roles can comment, approve, and see version history.
- UI shows a clear notice whenever AI or an outside service was used.
- Tool works with the model switched off (rules-only mode).
- Recall, precision, and citation rate measured on seeded test set and numbers shown at the demo.

### 7.2 Quantitative Targets

| Metric | Target |
|---|---|
| Recall of planted issues | >= 80% |
| Citation rate (findings with a source) | >= 95% |
| False-positive rate | <= 20% |
| Confidence calibration | 90% confidence = ~90% correct |
| Time to review a one-page draft | < 30 seconds |

---

## 8. Scope Boundaries

### In Scope (40-Hour MVP)
- Upload and define guidelines, facts, terminology; owner, version, expiry
- Text, DOCX, and PDF review; findings mapped to character spans
- Rules checks, claim matching, contradiction against past content
- Evidence cards, intent lock, and suggested fixes
- Roles, comments, approvals, version history with diffs
- Claim Shelf-Life, Guideline Debugger (basic), Brand Passport, pre-mortem
- Redaction preview, audit log, AI-use disclosure, rules-only mode
- Basic image checks: alt text, contrast, colour palette

### Out of Scope
- PPTX and advanced image review (logo template matching — stretch)
- Slack / Teams / Google Docs / CMS plug-ins
- Agent Gate API, Rule Simulator (Phase 2)
- Voice Fingerprint, multilingual consistency (Phase 2)
- Trust Report PDF export (Phase 2)
- Auto-publishing (non-goal)
- Training models on customer content (non-goal)

---

## 9. Three Planned Phase 2 Improvements (15 pts)

### Agent Gate API
Value: Any external AI tool or agency must obtain a Preflight result before publishing.
No AI-generated content can bypass brand review, even when produced by third-party tools.
Technical readiness: Route stub already committed in backend/src/routes/gate.js.

### Rule Simulator
Value: Brand managers test a guideline change by replaying it against the last 100 approved drafts
before enabling it. Guidelines become testable assets rather than edicts.
Technical readiness: Insights data model already captures per-draft finding records for batch re-run.

### Voice Fingerprint
Value: System learns the brand's tone from approved posts and shows a tone-drift metre on new drafts.
Adds longitudinal style consistency checking beyond individual rule violations.
Technical readiness: sentence-transformers infrastructure from retrieval is directly reusable.

---

## 10. Competitive Differentiation

| Typical Approach | Usually Good At | Usual Gap | What Preflight Adds |
|---|---|---|---|
| Style and grammar checkers | Spelling, tone, readability | Don't know if a claim is true or current | Claim checking against approved facts with expiry dates |
| Brand portals and asset libraries | Storing logos, templates, and rules | Rules not automatically checked on each draft | Per-draft review with source-linked findings |
| General AI chat used as reviewer | Fluent suggestions | May invent issues; no source; no audit trail; data leaves company | Evidence-bound output; redaction; audit log; human routing |

What makes Preflight unique in one sentence:
Every finding must cite a passage from the company's own uploads, past approved content is indexed for
contradiction checks, every approved fact has an expiry date and an owner, and every human ruling
becomes machine-reusable knowledge.

---

*Document version: 2.0 | Hackathon: Codex 48 | 40-Hour Sprint*
