# UI/UX Specification
## BrandGuard Preflight — Codex 48 Hackathon (40-Hour Sprint)

> Version: 2.0 | Date: 26 October 2026
> Owner: Falguni Sharma (Frontend)
> Standards: WCAG 2.2 Level AA | React + Vite | Vanilla CSS

---

## 0. Judging Criteria Alignment

| Criterion | Points | UI/UX Contribution |
|---|---|---|
| Working core workflow | 30 | All 7 screens defined; every step of the Priya demo story has a corresponding screen |
| Technical depth and reliability | 25 | EvidenceCard shows proofPassageId, confidence bar, NLI verdict, meaning check |
| Progress from Round 1 | 20 | EvidenceCard, ComparisonView, TamperCheck, MeaningCheck all new vs Round 1 |
| Three planned improvements | 15 | Agent Gate, Rule Simulator, Voice Fingerprint each have UI placeholders in the design |
| Usability | 10 | Judges must be able to use the product without guidance — every screen is self-explanatory |

---

## 1. Design Principles

| Principle | Application |
|---|---|
| Evidence first | Every flagged item shows proof before action; no finding without a source citation |
| Human in control | AI results are suggestions, not decisions; accept/edit/dismiss always available |
| Learn through feedback | Finding cards teach the creator about the rule, not just flag a violation |
| Trustworthy transparency | AI-use notice always visible; confidence always shown; checked-against-sources statement always present |
| Accessible by default | WCAG 2.2 AA; keyboard navigation; screen-reader compatible |
| Self-explanatory | A judge who has never seen the product before should understand what each screen does within 10 seconds |

---

## 2. Design System

### 2.1 Colour Tokens (CSS Custom Properties in index.css)

| Token | Value | Usage |
|---|---|---|
| --color-bg-primary | #0F1117 | Page background |
| --color-bg-surface | #1A1D27 | Cards, panels, modals |
| --color-bg-elevated | #22263A | Dropdowns, tooltips, hover states |
| --color-text-primary | #F1F3FA | Body text |
| --color-text-secondary | #9BA3C0 | Labels, metadata, timestamps |
| --color-text-muted | #5C6480 | Placeholder, disabled |
| --color-accent-blue | #4A90E2 | Primary actions, links |
| --color-accent-blue-hover | #6AAEF8 | Hover states on primary actions |
| --color-verdict-supported | #2DD4A3 | Supported verdict badge + highlight |
| --color-verdict-contradicted | #F45B69 | Contradicted verdict badge + highlight |
| --color-verdict-outdated | #F5A623 | Outdated verdict badge + highlight |
| --color-verdict-notfound | #9BA3C0 | Not Found verdict badge |
| --color-verdict-unclear | #C77DFF | Unclear verdict badge |
| --color-highlight-draft | rgba(244,91,105,0.25) | Flagged text highlight in draft viewer |
| --color-highlight-proof | rgba(45,212,163,0.20) | Matching text highlight in proof panel |
| --color-border | #2E3350 | Card and input borders |
| --color-border-focus | #4A90E2 | Focus ring colour (2px solid) |
| --color-success | #2DD4A3 | Success toast, accept badge |
| --color-warning | #F5A623 | Warning toast, expiry badge |
| --color-danger | #F45B69 | Error toast, blocked badge |

All colour pairs meet 4.5:1 minimum contrast ratio for normal text against their background.

### 2.2 Typography (Google Font: Inter + JetBrains Mono)

| Token | Family | Size | Weight | Usage |
|---|---|---|---|---|
| --font-display | Inter, sans-serif | 28px | 700 | Page titles (h1) |
| --font-heading-lg | Inter, sans-serif | 20px | 600 | Section headings (h2) |
| --font-heading-sm | Inter, sans-serif | 16px | 600 | Card headings (h3) |
| --font-body | Inter, sans-serif | 14px | 400 | Body text |
| --font-body-sm | Inter, sans-serif | 13px | 400 | Labels, metadata, timestamps |
| --font-mono | JetBrains Mono, monospace | 13px | 400 | Content diff, code, SHA-256 hashes |

### 2.3 Spacing Scale
4px base grid: 4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px

### 2.4 Border Radius
4px (inputs, badges) | 8px (cards) | 12px (modals, panels)

### 2.5 Shadows
--shadow-card: 0 2px 12px rgba(0,0,0,0.3)
--shadow-modal: 0 8px 40px rgba(0,0,0,0.6)

### 2.6 Status Badge Colours
| Status | Colour |
|---|---|
| Draft | #9BA3C0 (grey) |
| Checked | #4A90E2 (blue) |
| In Review | #F5A623 (amber) |
| Approved | #2DD4A3 (green) |
| Published | #00CED1 (teal) |
| Blocked | #F45B69 (red) |

---

## 3. Screen Inventory

| Screen | File | Primary User | Key Goal |
|---|---|---|---|
| Login | LoginPage.jsx | All | Authenticate and reach correct role view |
| Dashboard | DashboardPage.jsx | Manager, Leadership | See org health, recent drafts, insights |
| Knowledge Base | KnowledgeBasePage.jsx | Admin, Knowledge Owner | Upload and manage sources, facts, terminology |
| Submit Draft | DraftSubmitPage.jsx | Creator | Upload draft, fill in intent form |
| Review | ReviewPage.jsx | Creator | See findings, read evidence, accept/edit/dismiss |
| Workflow | WorkflowPage.jsx | Creator, Manager, Reviewer | Comment, approve, view versions |
| Passport | PassportPage.jsx | Manager, Compliance | Verify approved asset record |

---

## 4. Screen Specifications

### 4.1 Login Screen

Layout: Centred card on full-page gradient background.
Elements:
- Logotype: "BrandGuard Preflight" with tagline "Brand compliance, with proof."
- Email + Password fields with visible floating labels
- Login button (primary CTA, disabled until both fields filled)
- Register link
Accessibility: autofocus on email field; form submission on Enter; ARIA labels on all inputs; error state announced via aria-live.

---

### 4.2 Dashboard Screen

Layout: Left navigation sidebar (240px) + main content area.
Navigation items: Dashboard | Knowledge Base | New Draft | My Drafts | Insights | Passport Lookup
Role-aware: creator sees My Drafts; manager sees All Drafts; owner sees Knowledge Base first.

Main content sections:
1. Org Metrics Bar (4 cards): Total Drafts Reviewed | Issues Found | Issues Resolved | Avg Time to Approval
2. Recent Drafts Table: Draft title | Author | Status badge | Last updated | Action (View / Continue Review)
3. Insights Panel (right sidebar, 300px): Top 5 Repeated Mistake Types (horizontal bar chart) | Top 3 High-Override Rules (Guideline Debugger preview)

---

### 4.3 Knowledge Base Screen

Layout: Two-column grid (source list 60% + detail panel 40%).

Source List:
- Each SourceCard shows: file name | type badge | owner | version | expiry date | status badge
- Expiry warning: amber badge when within 30 days; red badge when expired
- Filter bar: by type (guideline / fact-sheet / glossary / past-content), status, owner

Upload Form (modal on Add Source button):
- File picker: PDF, DOCX, MD (max 10 MB)
- Fields: Source type (dropdown) | Owner (user picker) | Version (text) | Effective date | Expiry date
- Progress indicator: Uploading > Scanning > Parsing > Embedding > Ready

Fact Editor (inline form):
- Statement | Value | Evidence link (passage picker) | Owner | Expiry date | Supersedes (optional)

Terminology Editor (table):
- Term | Status (approved / banned) | Notes | Owner

---

### 4.4 Submit Draft Screen

Layout: Two-panel side-by-side.

Left panel (Content Input, 50%):
- Tab toggle: Upload File | Paste Text
- Upload zone: drag-and-drop or click; accepts PDF, DOCX, TXT; shows file name + size on selection
- Text paste: multi-line editor with word count and character count

Right panel (Intent Form, 50%):
- Purpose (text field required, e.g. "Promote new returns policy")
- Target Audience (text field required, e.g. "Existing customers")
- Must-Say Points (tag input, minimum 1 required, e.g. "free returns", "30-day window")
- What should NOT be changed (text field optional)

CTA: "Run Preflight Check" button — disabled until content input + at least 1 must-say point entered.
On click: POST /v1/drafts then POST /v1/drafts/:id/review; redirect to ReviewPage with loading state.

---

### 4.5 Review Screen — Core Screen (Judges: This Is Where the Main Value Is Visible)

Layout: Three-column.

Column 1 — Draft Viewer (35% width):
- Full draft text rendered with inline span highlights
- Highlight colours by verdict: red (Contradicted) | amber (Outdated) | grey (Not Found / Unclear) | green (Supported)
- Clicking a highlight scrolls to the corresponding evidence card in Column 2

Column 2 — Evidence Cards (45% width):
- Stacked vertically; one card per finding
- Card anatomy (from top to bottom):

  Finding N of M: [Type Label]
  [VERDICT BADGE]  Confidence: [XX%]
  ─────────────────────────────────
  DRAFT
  "[exact quoted sentence from draft]"
  ─────────────────────────────────
  PROOF
  [Source file name], page [N], expires [date] (owner: [name])
  "[matching passage text from source]"
  ─────────────────────────────────
  WHY FLAGGED
  [Human-readable explanation of why this was flagged]
  ─────────────────────────────────
  SUGGESTED FIX
  [Editable text area pre-filled by ML]
  ─────────────────────────────────
  MEANING CHECK
  Kept:    [item 1], [item 2]
  Changed: [item] (original > revised)
  Dropped: (nothing from must-say list) OR [dropped item]
  ─────────────────────────────────
  [Accept Fix]  [Edit]  [Dismiss]  [Ask Owner]

Column 3 — Pre-Mortem Panel (20% width):
- Single card: "Highest Risk Line"
- Riskiest sentence + viewpoint label (Regulator / Journalist / Competitor / Screen-Reader) + reason
- Expand link: "View full pre-mortem" shows all 4 viewpoints in a modal

AI-Use Notice Banner (bottom of screen, always visible when AI was used):
"This review used AI assistance. Findings are checked against your uploaded sources only.
Final decisions are made by you."

---

### 4.6 Workflow Screen

Layout: Main area + right comments panel.

Version Timeline (top of main area):
- Horizontal timeline: v1 > v2 > v3 with status badges, author names, and timestamps
- Click any version > DiffView opens below showing line-by-line diff (deleted in red, added in green)

Comment Thread (right panel, 320px):
- Each comment: avatar | author name | role badge | timestamp | comment text
- Request Changes comments: amber left border
- Approved events: green left border with approver name and checkmark

Approval Controls (sticky bottom bar, role-gated):
- Manager/Reviewer sees: Approve (green) | Request Changes (amber) | Override Finding (requires written reason; logged)
- Creator sees: approval status; any change requests; cannot approve own draft

---

### 4.7 Passport Screen

Layout: Single centred card (max-width 720px).

Sections (from top to bottom):
1. Asset name + draft ID
2. Passport created date + approvers list (each with role badge)
3. Content hash (SHA-256, displayed in JetBrains Mono, copyable)
4. Checks run (bulleted list with green checkmarks)
5. Rules version
6. AI Used: Yes / No badge
7. Verify Integrity button: re-hashes current content and compares to stored hash
   - If match: Verified badge (green) + "Content has not been modified since approval."
   - If mismatch: Tampered badge (red) + "Content differs from the approved version."

---

## 5. Interaction Patterns

### 5.1 Finding Accept Flow
1. Creator clicks Accept Fix.
2. Draft text in Column 1 updates inline to show the accepted fix.
3. Evidence card collapses with an Accepted green checkmark badge.
4. Finding count in header decrements.
5. UI auto-scrolls to the next open finding.
6. API: PATCH /v1/findings/:id {status: accepted} + new DraftVersion created.

### 5.2 Finding Dismiss Flow
1. Creator clicks Dismiss.
2. Modal appears: "Please state your reason for dismissing this finding" (text area, required).
3. Submit button disabled until reason is entered.
4. On submit: reason recorded in AuditLog; card collapses with Dismissed grey badge.

### 5.3 Escalate to Reviewer Flow
1. Creator clicks Ask Owner (for Not Found findings) OR system auto-routes high-risk finding.
2. Finding shows Waiting on Reviewer amber badge.
3. Reviewer sees finding in their queue with full evidence card + comment thread.
4. Reviewer rules: decision saved; optionally promoted to approved fact (POST /v1/facts).

### 5.4 Source Expiry Warning
1. 30 days before expiry: knowledge owner sees amber badge on SourceCard in Knowledge Base.
2. At review time: any finding against an expired source shows verdict Outdated with notice:
   "This source expired on [date]. Please contact [owner] to update it."

### 5.5 Override Flow
1. Manager clicks Override Finding.
2. OverrideReasonModal: required text area. Submit blocked if empty.
3. On submit: reason stored in Comment with action = override; AuditLog event: finding_overridden.
4. Override reason is visible to all users in the comment thread.

---

## 6. Accessibility Requirements

| Requirement | Implementation |
|---|---|
| WCAG 2.2 Level AA contrast | Minimum 4.5:1 for normal text; 3:1 for large text; verified with axe-core |
| Keyboard navigation | All interactive elements reachable via Tab; no keyboard traps |
| Focus indicators | Visible focus ring: 2px solid var(--color-border-focus) on all focused elements |
| Screen reader labels | All inputs, buttons, and icon-only controls have ARIA labels or visible text |
| Heading hierarchy | Single h1 per page; h2 for sections; h3 for cards |
| Alt text | All images (including source thumbnails) have descriptive alt text |
| Skip link | "Skip to main content" link at top of every page (visible on focus) |
| Error states | All form validation errors announced via aria-live="assertive" regions |
| Loading states | "Loading..." aria-live announcement when content is fetching |

---

## 7. Responsive Design

Breakpoints:
- Desktop >= 1280px: 3-column layout on Review screen; full dashboard
- Tablet 768px to 1279px: 2-column; pre-mortem panel collapses to expandable tab
- Mobile < 768px: single column; evidence cards stacked; comparison view scrollable

The hackathon demo targets desktop browsers (>= 1280px). Tablet and mobile layouts degrade gracefully.

---

## 8. Error and Empty States

| State | Message | Action |
|---|---|---|
| No sources uploaded | "Upload your brand guidelines to start checking drafts." | Upload Source button |
| Review in progress | "Checking your draft against [N] sources..." with animated progress indicator | None (auto-updates via polling) |
| Review failed (ML timeout) | "We could not complete this check. Your draft is safe. Try again or use rules-only mode." | Try Again + Rules-Only Mode buttons |
| No findings | "No issues found. All checked claims match your approved sources." with list of sources checked | Submit for Approval button |
| Source expired at review time | "This source has expired. Findings using it are marked Outdated." | Notify Owner button |
| Confidential-term blocked | "This draft contains a term under embargo and cannot be sent externally." | View blocked terms (redacted preview) |
| JWT expired | "Your session has expired. Please log in again." | Redirect to LoginPage |
| Permission denied | "You do not have permission to perform this action." | Back link |

---

## 9. Component File Map

| Component | File | Screen |
|---|---|---|
| AIUseNotice | layout/AIUseNotice.jsx | All review screens |
| SourceUploader | knowledge/SourceUploader.jsx | KnowledgeBasePage |
| SourceCard | knowledge/SourceCard.jsx | KnowledgeBasePage |
| IntentForm | draft/IntentForm.jsx | DraftSubmitPage |
| DraftViewer | review/DraftViewer.jsx | ReviewPage |
| EvidenceCard | review/EvidenceCard.jsx | ReviewPage |
| ProofPassagePanel | review/ProofPassagePanel.jsx | ReviewPage (inside EvidenceCard) |
| VerdictBadge | review/VerdictBadge.jsx | ReviewPage + WorkflowPage |
| SuggestedFix | review/SuggestedFix.jsx | ReviewPage (inside EvidenceCard) |
| MeaningCheck | review/MeaningCheck.jsx | ReviewPage (inside EvidenceCard) |
| ActionButtons | review/ActionButtons.jsx | ReviewPage (inside EvidenceCard) |
| ComparisonView | review/ComparisonView.jsx | ReviewPage |
| PreMortemPanel | review/PreMortemPanel.jsx | ReviewPage |
| VersionTimeline | workflow/VersionTimeline.jsx | WorkflowPage |
| DiffView | workflow/DiffView.jsx | WorkflowPage |
| CommentThread | workflow/CommentThread.jsx | WorkflowPage |
| ApprovalControls | workflow/ApprovalControls.jsx | WorkflowPage |
| OverrideReasonModal | workflow/OverrideReasonModal.jsx | WorkflowPage |
| PassportDetails | passport/PassportDetails.jsx | PassportPage |
| TamperCheck | passport/TamperCheck.jsx | PassportPage |
| OrgMetricsCard | dashboard/OrgMetricsCard.jsx | DashboardPage |
| RepeatMistakesChart | dashboard/RepeatMistakesChart.jsx | DashboardPage |
| GuidelineDebuggerList | dashboard/GuidelineDebuggerList.jsx | DashboardPage |

---

*Document version: 2.0 | Hackathon: Codex 48 | 40-Hour Sprint*
