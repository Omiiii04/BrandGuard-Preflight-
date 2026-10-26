# BrandGuard Preflight — Comprehensive UI & Portal Specification
## Role-Based Portals, Layout Anatomy, and Visual Architecture

> **Document Version:** 2.0  
> **Target Application:** BrandGuard Preflight  
> **Design Framework:** WCAG 2.2 Level AA | Dark Mode First (`#0F1117`) | React + Vanilla CSS  
> **Target Audience:** Frontend Engineers, Product Designers, QA, and Hackathon Reviewers  

---

## 1. Executive Overview & Design Philosophy

BrandGuard Preflight is an AI-assisted brand governance platform ensuring content truth, consistency, and compliance before publication. The user interface is built on five unwavering product design principles:

1. **Evidence First**: Every flagged claim displays verified source citations, exact passage quotes, confidence ratings, and expiry timestamps before any human action is taken.
2. **Human in the Loop**: AI provides evidentiary suggestions, never unilateral decrees. Creators and Managers retain granular control to accept, edit, or dismiss with auditable rationale.
3. **Intent-Lock Preservation**: Remediation protects the creator's voice by checking that Core Must-Say points are kept, necessary revisions are marked, and no required messaging is dropped.
4. **Trustworthy Transparency**: Persistent AI-usage disclaimers, clear model confidence bars, and tamper-evident SHA-256 Brand Passports are surfaced on relevant views.
5. **Role-Tailored Productivity**: Every user role (Creator, Manager, Knowledge Owner, Admin, Auditor) sees an optimized workspace tailored to their exact workflow permissions without cognitive clutter.

---

## 2. Authentication & Role-Based Access Control (RBAC) Matrix

### 2.1 Role Definitions

| Role Identifier | Display Label | Primary Responsibilities |
|---|---|---|
| `creator` / `editor` | **Content Creator** | Authors drafts, defines messaging intent, triggers Preflight scans, resolves AI findings, submits for manager review. |
| `manager` / `brand_manager` | **Brand Manager / Reviewer** | Reviews resolved drafts, audits overrides, evaluates Pre-Mortem risks, approves/rejects drafts, issues Brand Passports. |
| `owner` / `knowledge_owner` | **Knowledge Base Owner** | Ingests brand guidelines, maintains company fact registry, monitors claim shelf-life and source expiration dates. |
| `admin` | **System Administrator** | Full tenant lifecycle control, user provisioning, global redaction term tripwires, audit log inspection. |
| `viewer` | **Auditor / Compliance Viewer**| Read-only access to published drafts, SHA-256 Brand Passports, cryptographic tamper verifications, and audit trails. |

---

### 2.2 Comprehensive Role Permission Matrix

| Feature / UI View | Creator | Manager | Knowledge Owner | Admin | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|
| **Login & Auth Flow** | Yes | Yes | Yes | Yes | Yes |
| **Creator Dashboard (My Drafts)** | Yes (Full) | Read | Read | Yes (Full) | Read |
| **Executive / Manager Dashboard** | Hidden | Yes (Full) | Read | Yes (Full) | Read |
| **New Draft Submission (`/drafts/new`)** | Yes | Hidden | Hidden | Yes | Hidden |
| **Preflight Review (`/drafts/:id/review`)** | Yes (Fix/Edit) | Yes (Inspect) | Read-only | Yes (Full) | Read-only |
| **Workflow & Sign-off (`/drafts/:id/workflow`)** | View & Comment | Approve / Reject / Override | View & Comment | Full Sign-off | View-only |
| **Knowledge Base (`/knowledge-base`)** | Read-only | Read-only | Manage & Ingest | Full Control | Read-only |
| **Fact Sheet & Terminology Editor** | Suggest only | Read-only | CRUD Fact Sheets | Full Control | Read-only |
| **Brand Passport (`/passports/:id`)** | View Passport | Issue & Verify | View & Verify | Full Control | Verify Only |
| **System Audit Logs & Redaction** | Hidden | Summary View | Hidden | Full Access | Export Log |

---

## 3. Global Layout Architecture

Every authenticated screen adheres to a cohesive, accessible structural frame:

```
+---------------------------------------------------------------------------------------------------+
|  SIDEBAR / NAVBAR (Fixed Left: 240px - 260px)  |  HEADER / TOPBAR (Fixed Top: 64px)               |
|                                                |  [Breadcrumbs] [Status] [Org Context] [Actions]  |
|  - Brand Logo (BG Shield) + Org Name           +--------------------------------------------------+
|  - Role-gated Navigation List                  |  MAIN CONTENT VIEWPORT                           |
|  - User Profile Card & Role Badge              |  (Dynamic per route & role)                      |
|  - Global Logout CTA                           |                                                  |
|                                                |                                                  |
|                                                +--------------------------------------------------+
|                                                |  FOOTER / STICKY ACTION TRAY (48px - 64px)       |
|                                                |  [AI Notice] [Audited Status] [Sticky Action CTAs]|
+---------------------------------------------------------------------------------------------------+
```

---

## 4. Navbar / Sidebar Content Breakdown

The primary navigation resides in a fixed left-hand rail (`width: 250px`, background: `--color-bg-surface: #1A1D27`, border-right: `1px solid #2E3350`).

### 4.1 Navbar Structural Sections

```
+-----------------------------------------------+
| [BG] BrandGuard Preflight   (v2.0)            |  <-- Brand Header
| Org: Acme Global Marketing                    |  <-- Tenant Indicator
+-----------------------------------------------+
| PRIMARY WORKSPACE                             |  <-- Group Label
|  [+] New Draft              (Creator/Admin)   |
|  [ ] My Drafts              (Creator)         |
|  [=] All Submissions        (Manager/Admin)   |
|  [*] Executive Dashboard    (Manager/Admin)   |
|                                               |
| KNOWLEDGE & GOVERNANCE                        |  <-- Group Label
|  [@] Guidelines & Sources   (Owner/Admin/Mgr) |
|  [#] Verified Facts         (Owner/Admin)     |
|  [!] Terminology Rules      (Owner/Admin)     |
|                                               |
| COMPLIANCE & VERIFICATION                     |  <-- Group Label
|  [#] Brand Passports        (All Auth)        |
|  [%] Audit Trail & History  (Admin/Manager)   |
|  [^] Guideline Debugger     (Manager/Admin)   |
+-----------------------------------------------+
| USER PROFILE FOOTER                           |  <-- Anchor Bottom
|  [Avatar] Priya Sharma                        |
|  Role: CREATOR [Pill Badge]                   |
|  [Log Out]                                    |
+-----------------------------------------------+
```

### 4.2 Navbar Elements by Role

#### 1. Creator Navbar
* **Brand Header**: BrandGuard logo mark + active organization name pill.
* **Workspace Links**:
  * **New Draft (`/drafts/new`)**: Highlighted primary action item with dynamic plus icon.
  * **My Drafts (`/drafts`)**: Filtered list showing personal drafts, preflight statuses, and revision requests.
* **Compliance Links**:
  * **Knowledge Guidelines (`/knowledge-base`)**: Read-only reference to approved sources.
  * **Passports (`/passports`)**: Public repository of approved content hashes.
* **User Card**: User avatar, creator badge (`#9BA3C0`), and logout button.

#### 2. Brand Manager / Reviewer Navbar
* **Brand Header**: BrandGuard logo mark + tenant switcher.
* **Workspace Links**:
  * **Triage Dashboard (`/dashboard`)**: Team-wide queue of pending reviews and high-risk flags.
  * **All Drafts (`/drafts`)**: Global submission log with status filters (`In Review`, `Approved`, `Blocked`).
  * **Rule Insights (`/dashboard#insights`)**: Guideline Debugger and repeated mistake analytics.
* **Compliance Links**:
  * **Brand Passports (`/passports`)**: Direct access to sign, verify, and export passports.
  * **Knowledge Base (`/knowledge-base`)**: Source guidelines inspection.
* **User Card**: Manager badge (`#F5A623`), user credentials, session state, and logout.

#### 3. Knowledge Owner Navbar
* **Workspace Links**:
  * **Knowledge Base (`/knowledge-base`)**: Upload portal for PDFs, DOCXs, and Markdown policies.
  * **Fact Sheet Registry (`/knowledge-base/facts`)**: Live claims repository with owner and shelf-life tracking.
  * **Terminology Tripwires (`/knowledge-base/terms`)**: Banned, approved, and embargoed terms dictionary.
* **Monitoring Links**:
  * **Shelf-Life Alert Desk**: Sources expiring in $\le 30$ days.
* **User Card**: Knowledge Owner badge (`#4A90E2`), user details, and logout.

#### 4. Admin Navbar
* Displays all links across Creator, Manager, and Knowledge Owner tiers.
* Adds **System Audit Logs**, **Org Redaction Settings**, and **Tenant Provisioning**.
* User Card: Admin badge (`#F45B69`), security settings, and logout.

---

## 5. Header / TopBar Content Breakdown

The Header (`TopBar.jsx`) spans the top of the viewport (`height: 64px`, background: `#1A1D27`, border-bottom: `1px solid #2E3350`).

### 5.1 Header Layout Architecture

```
+---------------------------------------------------------------------------------------------------+
| [Breadcrumb: Drafts > Returns Policy v2 > Review]  |  [Search / Search ID]  |  [Tenant]  [Alerts] |
| Page Title: "Returns Policy Q4 Launch"              |  [Status: IN REVIEW]  |  [Org: Nike EMEA]  |
+---------------------------------------------------------------------------------------------------+
```

### 5.2 Header Content Elements

1. **Contextual Breadcrumbs & Dynamic Title**:
   * Hierarchical trail (e.g., `Home / Drafts / Summer Promo / Preflight Review`).
   * Primary title rendered in `Inter Bold, 20px`, accompanied by version indicator (e.g., `v3`).
2. **Dynamic Status Badges**:
   * Color-coded status chip reflecting workflow state:
     * `Draft` (`#9BA3C0`)
     * `Checking / Preflight Running` (`#4A90E2` with animated pulse)
     * `In Review` (`#F5A623`)
     * `Approved` (`#2DD4A3`)
     * `Published` (`#00CED1`)
     * `Blocked / Embargoed` (`#F45B69`)
3. **Draft Triage Metric Chips (Review & Workflow Pages)**:
   * Quick-glance counters in the header:
     * `4 Contradictions` (Red badge)
     * `2 Outdated Claims` (Amber badge)
     * `1 Supported Claim` (Green badge)
     * `1 Pending Escalation` (Purple badge)
4. **Tenant Context & Global Search**:
   * Organization label displaying tenant isolation scope (`Nike EMEA`).
   * Universal ID query input for instant lookup of Draft IDs or SHA-256 Passport hashes.
5. **Notification / Shelf-Life Indicator**:
   * Bell icon with counter alerting managers to overdue reviews and knowledge owners to 30-day claim expirations.

---

## 6. Footer Content Breakdown

The platform utilizes a dual-tier footer model: a global structural footer and screen-specific sticky action trays.

### 6.1 Global Structural Footer
* **AI Disclosure & Transparency Notice**:
  * Visible on all review, draft, and passport screens:
    > *"This system operates under Human-in-the-Loop AI governance. Findings are strictly bounded by your uploaded company source documents. Final approvals are governed by authorized human reviewers."*
* **Security & Cryptography Fingerprint**:
  * Micro-text displaying: `Encrypted TLS 1.3 | SHA-256 Immutable Audit Log | Tenant Isolated: org_92812`.
* **Standard Links**: System Status, OpenAPI 3.1 Documentation, WCAG 2.2 AA Accessibility Statement.

### 6.2 Sticky Action Trays (Workflow & Review Views)

When reviewing drafts or participating in workflow approvals, a high-priority sticky action tray anchors to the bottom of the viewport (`height: 64px`, background: `rgba(26, 29, 39, 0.95)`, backdrop-filter: `blur(8px)`, border-top: `1px solid #2E3350`).

```
+---------------------------------------------------------------------------------------------------+
| [AI Disclaimer: Source-Bounded]    |  Resolved: 3/4 Findings  |  [Request Changes]  [APPROVE DRAFT] |
+---------------------------------------------------------------------------------------------------+
```

#### Sticky Tray by Role:
* **Creator View**:
  * Progress: `X of Y findings resolved`.
  * CTA: `Submit for Manager Approval` (Enabled only when 0 unhandled critical findings remain).
* **Manager View**:
  * Quick-actions: `Request Changes` (Amber), `Override & Approve` (Opens justification modal), and `Sign & Issue Brand Passport` (Emerald green).
* **Auditor View**:
  * CTAs: `Verify Passport Integrity` and `Download Signed Certificate (.JSON / .PDF)`.

---

## 7. Role-Specific Portal Walkthroughs

---

### 7.1 Creator Portal (`/drafts/new` & `/drafts/:id/review`)

The Creator Portal is designed to guide writers, copywriters, and agency partners from raw copy to brand-compliant perfection without fear of arbitrary rejection.

```
+---------------------------------------------------------------------------------------------------+
| TOPBAR: "Returns Policy Announcement" | Status: PREFLIGHT REVIEW | 2 Findings Open                |
+---------------------------------------------------------------------------------------------------+
| COLUMN 1: DRAFT VIEWER (35%)      | COLUMN 2: EVIDENCE CARD (45%)   | COLUMN 3: PRE-MORTEM (20%)   |
|                                   |                                 |                              |
| "We guarantee free returns        | Finding 1 of 2: Contradiction   | HIGHEST RISK LINE:           |
| [within 60 days] on all orders... | [CONTRADICTED]  Confidence: 94% | "60-day return window"       |
|                                   | ------------------------------- |                              |
|                                   | DRAFT SAYS:                     | VIEWPOINTS:                  |
|                                   | "within 60 days"                | [Regulator] False advert.    |
|                                   | ------------------------------- | [Journalist] Misleading PR   |
|                                   | PROVED BY SOURCE:               | [Customer] Frustration      |
|                                   | Returns_Guide_2026.pdf (p.4)    |                              |
|                                   | "Returns window is 30 days."    |                              |
|                                   | ------------------------------- |                              |
|                                   | SUGGESTED FIX (Intent Locked):  |                              |
|                                   | [within 30 days]                |                              |
|                                   | ------------------------------- |                              |
|                                   | [ACCEPT FIX] [EDIT] [DISMISS]   |                              |
+---------------------------------------------------------------------------------------------------+
| FOOTER: AI-Use Notice | Auto-save active | [Submit to Manager Workflow ->]                        |
+---------------------------------------------------------------------------------------------------+
```

#### Visible Elements in Creator Portal:
1. **Submit Draft Screen (`/drafts/new`)**:
   * **Left Panel**: Dual-mode input selector (Upload File drag-and-drop supporting PDF/DOCX/MD vs. Paste Raw Content with dynamic word counter).
   * **Right Panel (Intent Lock Form)**:
     * *Draft Purpose*: Required single-line input (e.g., "Customer retention email for returns").
     * *Target Audience*: Multi-select or text input (e.g., "EU Customers, Retail Tier").
     * *Must-Say Core Claims*: Chip input where creator defines non-negotiable points (e.g., "Free shipping", "Sustainable packaging").
     * *Non-Negotiable Styling*: Directives for what AI must NOT rephrase.
   * **Action CTA**: Primary button `Run Preflight Check`.
2. **Review Screen (`/drafts/:id/review`)**:
   * **Three-Column Evidence Interface**:
     * *Column 1 (Interactive Draft Viewer)*: Full draft text with inline color-coded highlight spans linked to finding IDs. Clicking any highlight smoothly scrolls Column 2 to the active finding.
     * *Column 2 (EvidenceCard Stack)*:
       * Header: Finding category badge, NLI verdict badge (`Contradicted`, `Outdated`, `Supported`, `Not Found`, `Unclear`), and calibrated confidence bar (`94%`).
       * Cited Proof Panel: Displaying Source File Name, Page Number, Owner Name, and Expiry Date with exact matching text highlighted in cyan (`rgba(45,212,163,0.20)`).
       * Intent Lock Delta: Meaning check matrix showing what is Kept, what is Changed, and verifying no Must-Say points are Dropped.
       * Action Controls: `Accept Fix` (one-click patch), `Custom Edit`, `Dismiss Finding` (triggers mandatory rationale prompt), `Ask Owner` (escalates to Knowledge Owner).
     * *Column 3 (Pre-Mortem Risk Matrix)*:
       * Pre-emptive vulnerability inspection across 4 archetypes: **Regulator**, **Journalist**, **Competitor**, and **Screen-Reader Accessibility**.
3. **Workflow State**:
   * Creator can see the review conversation timeline, view diffs between revisions, and address Manager change requests.
   * **Creator Guardrail**: The creator's UI explicitly disables self-approval.

---

### 7.2 Manager & Reviewer Portal (`/dashboard` & `/drafts/:id/workflow`)

The Manager Portal optimizes decision velocity, compliance auditing, and team accountability.

```
+---------------------------------------------------------------------------------------------------+
| TOPBAR: Brand Manager Portal | Org: Nike Global | Quick Filter: [Pending Approval (5)]             |
+---------------------------------------------------------------------------------------------------+
| EXECUTIVE METRICS BAR                                                                             |
| [ Total Reviewed: 142 ] [ Open Flags: 8 ] [ Overrides: 3 ] [ Avg Time-to-Sign: 1.4h ]            |
+---------------------------------------------------------------------------------------------------+
| PENDING APPROVAL QUEUE (Table)                       | REPEATED MISTAKES & INSIGHTS (Panel)       |
| Title            Author   Risk Level  Findings  Act  | 1. Outdated Pricing (42% of flags)         |
| Summer Promo     Priya    [HIGH-RED]  2 Open    [Rev]| 2. Expired Return Window (28% of flags)    |
| Q3 Earnings      Alex     [LOW-GRN]   0 Open    [App]| 3. Unapproved Superlatives (15%)           |
| Sustainability   Marcus   [MED-AMB]   1 Open    [Rev]| ------------------------------------------ |
|                                                      | GUIDELINE DEBUGGER PREVIEW:                |
|                                                      | Rule "Free 60-day" overridden 14 times.    |
|                                                      | [Propose Rule Update in Knowledge Base]    |
+---------------------------------------------------------------------------------------------------+
| FOOTER: Compliance Ledger Active | Session Secured                                                |
+---------------------------------------------------------------------------------------------------+
```

#### Visible Elements in Manager Portal:
1. **Executive Dashboard (`/dashboard`)**:
   * **Metrics Bar**: 4 dynamic metric tiles showing Total Drafts Processed, Total Brand Hazards Neutralized, Active Overrides, and Mean Approval Velocity.
   * **Submissions Triage Grid**:
     * Columns: Draft Title, Creator Name, Target Audience, Risk Verdict, Finding Resolution Ratio, Submitted Date, and Quick Actions.
     * Filterable by: Urgency, Risk tier, Content Format, and Department.
   * **Guideline Debugger Panel (Right Sidebar)**:
     * Surfaces rules with abnormally high override rates ($\ge 30\%$), alerting managers that the guideline itself is likely obsolete or impractical.
2. **Workflow & Sign-off View (`/drafts/:id/workflow`)**:
   * **Interactive Version Timeline**:
     * Visual branch timeline: `v1 (Initial)` $\to$ `v2 (Remediated)` $\to$ `v3 (Final)`.
     * Clicking any version renders a split-screen **DiffView** (deletions in red, additions in green).
   * **Audit & Comment Stream**:
     * Chronological thread with role badges (`Manager`, `Creator`, `Legal`).
     * Change requests rendered with amber alert borders.
   * **Manager Decision Bar**:
     * `Approve Draft`: Generates Brand Passport SHA-256 and transitions status to `Approved`.
     * `Request Changes`: Prompts modal for targeted creator feedback.
     * `Override Finding`: Requires a mandatory justification recorded into the immutable append-only audit log.

---

### 7.3 Knowledge Owner Portal (`/knowledge-base`)

The Knowledge Owner Portal manages the ground-truth sources that feed the vector store and fact-checking engines.

```
+---------------------------------------------------------------------------------------------------+
| TOPBAR: Knowledge Base & Truth Registry | [ + Ingest New Source ] [ + Add Single Fact ]            |
+---------------------------------------------------------------------------------------------------+
| FILTER BAR: [All Types v] [Status: Active / Expiring v] [Owner: All v]   [Search Guidelines...]   |
+---------------------------------------------------------------------------------------------------+
| SOURCE CARDS (Grid 60%)                             | FACT REGISTRY & TERMINOLOGY (Panel 40%)     |
| [PDF] Global_Brand_Guidelines_2026.pdf              | VERIFIED TRUTH CLAIMS                       |
| Owner: Legal Team | Expiry: 12 Nov 2026 [30-Day Warn| - Return Window: 30 days (Source: Return.pdf)|
| Chunks: 184 | Status: ACTIVE [Re-index]             | - Student Discount: 15% (Source: Promo.pdf) |
| --------------------------------------------------- | ------------------------------------------- |
| [MD] Voice_And_Tone_Rules.md                        | BANNED / EMBARGOED TERMINOLOGY              |
| Owner: Brand Lead | Expiry: Never                   | - "Cheapest" -> BANNED (Use "Best Value")   |
| Status: ACTIVE [Edit]                               | - "Project Titan" -> EMBARGOED TRIPWIRE     |
+---------------------------------------------------------------------------------------------------+
| FOOTER: MinIO Object Storage Connected | Background Shelf-Life Cron: Active (Daily 00:00 UTC)     |
+---------------------------------------------------------------------------------------------------+
```

#### Visible Elements in Knowledge Owner Portal:
1. **Source Ingestion Manager**:
   * Multi-file uploader with automatic MIME allow-listing (PDF, DOCX, MD) and 10MB size limit enforcement.
   * Metadata assignment form: Source Title, Effective Date, Mandatory Expiration Date, Document Owner, and Classification Tier.
   * Real-time Ingestion Stepper: `Uploading -> Antivirus Scan -> Text Extraction -> Vector Embedding -> Active`.
2. **Claim Shelf-Life Alert System**:
   * Visual warning badges on documents expiring in $\le 30$ days.
   * Quick `Renew / Supersede Source` action modal linking updated files to existing chunks.
3. **Fact Registry Editor**:
   * Direct CRUD interface for atomic company facts (Entity, Attribute, Value, Citation link, Verification Owner).
4. **Terminology Tripwire Matrix**:
   * Table of approved brand terms, forbidden competitor mentions, and embargoed project names that instantly trip preflight blocks.

---

### 7.4 Executive & Auditor Portal (`/passports` & `/passports/:id`)

The Auditor Portal gives compliance officers, regulators, and client stakeholders cryptographic proof of content authenticity.

```
+---------------------------------------------------------------------------------------------------+
| TOPBAR: Brand Passport Cryptographic Verification Desk | Search Hash: [ 3a8f19... ]               |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|                        OFFICIAL BRAND COMPLIANCE PASSPORT                                         |
|                        Draft ID: df_881920-a92 | Status: VERIFIED                                 |
|                                                                                                   |
|  Asset Name:      Nike Holiday 2026 Returns Policy Launch                                         |
|  Approved Date:   26 October 2026 - 18:42:01 UTC                                                  |
|  Sign-off Entity: Elena Rostova (Brand Governance Lead)                                           |
|                                                                                                   |
|  CRYPTOGRAPHIC CONTENT HASH (SHA-256):                                                            |
|  [ e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ] [Copy Hash]               |
|                                                                                                   |
|  GOVERNANCE CHECKS CERTIFIED:                                                                     |
|  [v] Source Contradiction Check (Zero discrepancies)                                              |
|  [v] Claim Shelf-Life Validation (All citations valid > 90 days)                                  |
|  [v] Redaction & Embargo Tripwire (Clean scan)                                                    |
|  [v] Intent Preservation Lock (100% must-say points retained)                                     |
|  [v] Human Review Sign-off (Authenticated via Org PKI)                                            |
|                                                                                                   |
|  AI ASSISTANCE DISCLOSURE:                                                                        |
|  [ AI Used: Yes | Model: BrandGuard Preflight v2.0 | Temperature: 0.0 ]                           |
|                                                                                                   |
|  -----------------------------------------------------------------------------------------------  |
|  [ > VERIFY LIVE CONTENT INTEGRITY < ]                [ Download Tamper-Proof Certificate (.PDF) ] |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
```

#### Visible Elements in Auditor Portal:
1. **Passport Certificate Card**:
   * Clean, high-contrast certificate layout with branded watermark background.
   * Displays asset title, author, final approver, approval timestamp, and organization signature.
2. **SHA-256 Content Hash Block**:
   * Rendered in `JetBrains Mono, 13px` with one-click clipboard copy and QR code verification link.
3. **Live Tamper-Check Utility**:
   * Live comparison engine: Paste published URL or live text $\to$ re-calculates SHA-256 digest $\to$ compares against stored passport hash.
   * Visual output:
     * **Green Match Badge**: *"Verified Authentic. Content matches signed preflight approval."*
     * **Red Tamper Alert**: *"Warning: Tamper Detected. Live content differs from signed approval."*

---

## 8. Screen-by-Screen Anatomical Specifications

### 8.1 Login Screen (`/login`)

```
+--------------------------------------------------------------------+
|                         [BG SHIELD LOGO]                           |
|                      BrandGuard Preflight                          |
|                  "Brand compliance, with proof."                   |
|                                                                    |
|  Workplace Email                                                   |
|  [ priya@acme.com                                                ] |
|                                                                    |
|  Password / Magic Token                                            |
|  [ **********************************                            ] |
|                                                                    |
|  Organization Domain                                               |
|  [ acme-global                                                   ] |
|                                                                    |
|  [           LOG IN TO WORKSPACE           ]                       |
|                                                                    |
|  Demo Quick Logins:                                                |
|  [Priya (Creator)]   [Elena (Manager)]   [Marcus (Owner)]          |
+--------------------------------------------------------------------+
```

* **Navbar**: Hidden.
* **Header**: Hidden.
* **Body**: Centered responsive modal container (`max-width: 440px`), dark elevation surface (`#1A1D27`), subtle 1px border (`#2E3350`), and soft glow shadow.
* **Footer**: Copyright, Security compliance badges, and quick role switcher buttons for hackathon demonstration.

---

### 8.2 Dashboard Screen (`/dashboard`)

* **Navbar**: Full persistent navigation bar with role-tailored links.
* **Header**:
  * Title: `Workspace Dashboard`.
  * Right: Org Badge + Notification Bell + User Profile Chip.
* **Main Content Area**:
  * **Top Metrics Row**: 4 cards displaying Total Drafts, Open Flags, Mean Review Time, and Overrides.
  * **Center Grid (70% width)**: Tabbed table of drafts (`All Submissions`, `Awaiting My Review`, `Approved`). Columns: Asset Title, Author, Verdict Pill, Last Modified, and Actions.
  * **Insights Panel (30% width)**: Repeated Mistakes breakdown chart and Guideline Debugger warnings.
* **Footer**: Global compliance notice.

---

### 8.3 Draft Submission Screen (`/drafts/new`)

* **Navbar**: Active item: `New Draft`.
* **Header**: Title: `Submit Content for Preflight`.
* **Main Content Area**:
  * **Split Workspace**:
    * *Left Pane (50%)*: Content source selection (`Upload File` drop-zone or `Paste Text` editor with live word and character counters).
    * *Right Pane (50%)*: Intent Lock Configuration form (Audience, Goal, Mandatory Claims list, Negative Constraints).
* **Footer Action Bar**: Fixed bottom bar featuring `Run Preflight Check` CTA (with animated loading spinner during ingestion and ML execution).

---

### 8.4 Preflight Review Screen (`/drafts/:id/review`)

* **Navbar**: Minimized icon-mode or full drawer.
* **Header**: Draft name, current version badge, finding counts (`4 open`, `1 resolved`), and quick comparison toggles.
* **Main Content Area (3-Column Asymmetric Grid)**:
  * *Column 1 (35%)*: Draft Viewer with synchronized sentence highlight marks.
  * *Column 2 (45%)*: Vertical scroll container of `EvidenceCard` components.
  * *Column 3 (20%)*: Pre-Mortem assessment card with regulator, journalist, competitor, and accessibility insights.
* **Footer**: AI transparency banner + Sticky button to progress to `/workflow`.

---

### 8.5 Workflow & Sign-Off Screen (`/drafts/:id/workflow`)

* **Navbar**: Standard navigation rail.
* **Header**: Draft title, version dropdown (`v1`, `v2`, `v3`), and author information.
* **Main Content Area**:
  * *Top Section*: Interactive Horizontal Version Timeline.
  * *Left/Center Section (65%)*: Visual DiffViewer displaying additions (green background) and deletions (red strikethrough).
  * *Right Section (35%)*: Role-badged Comment and Revision thread.
* **Footer Tray**: Role-gated sticky bar:
  * For Creator: Read-only status and revision submission.
  * For Manager: `Request Changes`, `Override Finding`, `Approve & Sign Passport`.

---

### 8.6 Knowledge Base Screen (`/knowledge-base`)

* **Navbar**: Active item: `Knowledge Base`.
* **Header**: Page Title, Search input, and primary button `+ Add Source`.
* **Main Content Area**:
  * Filter controls (File type, Owner, Expiration timeframe).
  * Source list cards showing file type icons (PDF/DOCX/MD), page counts, owner badge, status pill (`Active`, `Expiring in 14 days`, `Expired`), and chunk count.
  * Side drawer for Fact Sheet and Terminology editors.
* **Footer**: MinIO and Vector Store operational health status.

---

### 8.7 Brand Passport Screen (`/passports/:id`)

* **Navbar**: Active item: `Brand Passports`.
* **Header**: Passport ID, Verification status indicator, and Export actions.
* **Main Content Area**: Centered, print-ready digital passport certificate containing metadata, SHA-256 hash, certified checks list, and interactive tamper verification tool.
* **Footer**: Cryptographic signing timestamp and immutable ledger reference.

---

## 9. Design System Tokens & Component Styling

All visual elements strictly adhere to the project's CSS design system tokens:

```css
:root {
  /* Surface & Background Palette */
  --color-bg-primary: #0F1117;
  --color-bg-surface: #1A1D27;
  --color-bg-elevated: #22263A;

  /* Typography Colors */
  --color-text-primary: #F1F3FA;
  --color-text-secondary: #9BA3C0;
  --color-text-muted: #5C6480;

  /* Accent & Interactive */
  --color-accent-blue: #4A90E2;
  --color-accent-blue-hover: #6AAEF8;

  /* NLI Verdicts & Status Semantics */
  --color-verdict-supported: #2DD4A3;      /* Emerald Green */
  --color-verdict-contradicted: #F45B69;   /* Crimson Coral */
  --color-verdict-outdated: #F5A623;       /* Warning Amber */
  --color-verdict-notfound: #9BA3C0;       /* Neutral Slate */
  --color-verdict-unclear: #C77DFF;        /* Intuitive Violet */

  /* Inline Text Highlights */
  --color-highlight-draft: rgba(244, 91, 105, 0.25);
  --color-highlight-proof: rgba(45, 212, 163, 0.20);

  /* Borders & Shadows */
  --color-border: #2E3350;
  --color-border-focus: #4A90E2;
  --shadow-card: 0 2px 12px rgba(0, 0, 0, 0.3);
  --shadow-modal: 0 8px 40px rgba(0, 0, 0, 0.6);

  /* Typography Stack */
  --font-family-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-family-mono: 'JetBrains Mono', monospace;
}
```

---

## 10. Core UI Primitives & Interactive States

### 10.1 The EvidenceCard Anatomy
The EvidenceCard is the primary interactive element on the Review screen:

1. **Card Header**:
   * Left: Finding counter (`Finding 1 of 3`) + Finding Type label (`Pricing Claim`).
   * Right: `VerdictBadge` (`CONTRADICTED`) + Confidence score with visual bar (`94%`).
2. **Draft Context Box**:
   * Darkened inset panel displaying the exact sentence flagged from the creator's copy.
3. **Cited Proof Passage Box**:
   * Displaying the verified excerpt from company guidelines with Source Name, Page Number, Owner, and Expiry Date.
4. **Why Flagged Explanation**:
   * Clear natural language explanation of the divergence.
5. **Suggested Fix Box**:
   * Pre-computed, intent-locked suggested replacement with inline editing toggle.
6. **Meaning Check Indicator**:
   * Three-point breakdown: `Kept (Green)`, `Changed (Amber)`, `Dropped (Red)`.
7. **Action Button Tray**:
   * `Accept Fix` (Green primary)
   * `Edit` (Neutral ghost)
   * `Dismiss` (Neutral outline, requires reason modal)
   * `Ask Owner` (Purple auxiliary)

---

### 10.2 System Feedback & Empty States

| State Condition | Visual Feedback | Action Offered |
|---|---|---|
| **Zero Guidelines Ingested** | Empty-state graphic with message: *"Your brand memory is empty. Ingest your guidelines to enable preflight verification."* | `+ Upload Guidelines` |
| **Preflight Scan Executing** | Animated scanning line over draft text + progress stepper: *"Checking 14 claims against 3 sources..."* | Cancel Scan |
| **Zero Findings (Clean Draft)** | Emerald shield icon with message: *"Zero brand discrepancies found. All claims verified by active sources."* | `Submit for Approval` |
| **Claim Source Expired** | Amber banner on finding card: *"This citation expired on [Date]. Contact [Owner] to verify renewed terms."* | `Notify Knowledge Owner` |
| **Embargoed Term Tripwire** | Red blocked modal: *"Draft contains restricted pre-release terminology under active embargo."* | `View Redacted Preview` |

---

## 11. Accessibility & Responsive Degradation (WCAG 2.2 AA)

1. **Contrast Ratios**: Every text element satisfies a minimum 4.5:1 contrast against its immediate background. Large headings satisfy 3:1.
2. **Keyboard Navigation**:
   * `Tab` and `Shift + Tab` cycle sequentially through interactive elements without focus trapping.
   * `Enter` / `Space` activates buttons, expands accordions, and selects findings.
   * `Escape` immediately dismisses modals, comparison drawers, and dropdowns.
3. **Screen Reader Optimization**:
   * Status indicators and badges employ ARIA labels (e.g., `aria-label="Contradicted finding, 94 percent confidence"`).
   * Asynchronous scanning updates and toast messages report via `aria-live="polite"` regions.
4. **Responsive Breakpoints**:
   * **Desktop ($\ge 1280\text{px}$)**: Complete 3-column preflight review suite and full sidebar navigation.
   * **Tablet ($768\text{px} - 1279\text{px}$)**: 2-column layout; Pre-Mortem risk panel converts into an expandable drawer.
   * **Mobile ($< 768\text{px}$)**: Single-column linear layout; sidebar converts into a sliding hamburger sheet.

---

*BrandGuard Preflight — Codex 48 Hackathon | Documentation Specification*
