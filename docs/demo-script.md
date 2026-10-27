# 8-Minute End-to-End Demo Script: BrandGuard Preflight

## Overview
This script walks through the complete end-to-end hackathon demo story across all three roles (Creator, Reviewer, Manager).
Total Target Duration: 8 Minutes

---

## Story Characters & Roles
- **Priya Sharma** (Creator): Content author drafting marketing copy for Stellara Brands.
- **BrandGuard Preflight ML & Engine**: Automated claim extraction, exact rules checker, NLI entailment, meaning preservation check, and pre-mortem analysis.
- **Priya Mehta / Marcus Vance** (Manager / Legal Approver): Reviewing diffs, approving verified content, and minting the Brand Passport.

---

## Demo Step-by-Step Breakdown

### 1. Act I — The Problem & Ground Truth (0:00 - 1:30)
- **Action**: Log in as Priya (`priya@stellara.com`).
- **Screen**: Knowledge Base (`/knowledge-base`).
- **Narration**:
  - Point out active uploaded brand sources: `Stellara_Returns_Policy_v4.pdf` (Version 4.0, Effective Q1 2026, 30-day window).
  - Show source metadata: Owner (Compliance & Legal), Version, Expiry Date, and Status badges.
  - Highlight that prior legacy policies referenced a 14-day window that has since expired.

### 2. Act II — Draft Submission & Intent Lock (1:30 - 2:45)
- **Action**: Navigate to New Draft (`/drafts/new`).
- **Form Inputs**:
  - **Content**: Paste or upload campaign copy:
    > "Stellara Brands offers the best returns policy in the market, giving customers total peace of mind. Our 14-day return window is designed to be fair and hassle-free. Returns are processed free of charge with no hidden fees."
  - **Purpose**: "Customer email announcement"
  - **Audience**: "Existing & prospective retail customers"
  - **Must-Say Points**: "peace of mind", "fair and hassle-free"
- **Action**: Click **Run Preflight Check**.
- **Observation**:
  - Submission triggers SHA-256 content hashing and AuditLog event `draft_submitted`.
  - Content passes through Redaction Gateway.
  - Review runs asynchronously with animated progress indicator.

### 3. Act III — Evidence Cards & Meaning Preservation (2:45 - 4:45)
- **Screen**: Review Page (`/drafts/:id/review`).
- **Narration**:
  - Show the **TopBar AI-Use Notice** badge (`AI-assisted review`) disclosing LM execution.
  - Point out the 3 seeded findings flagged with evidence:
    1. **Contradicted Temporal Claim**: "14-day return window" flagged against `Stellara_Returns_Policy_v4.pdf` (Page 5: "As of Q1 2026 the standard return window is 30 days").
    2. **Unqualified Superlative**: "best returns policy in the market" flagged with confidence 0.94 against Page 3 ("No comparison to competitor policies has been independently validated").
    3. **Pre-Mortem Panel**: Highlights regulatory risk line from regulator & consumer viewpoints.
  - **Action**: Inspect the Suggested Fix:
    > "We offer a 30-day returns policy, giving customers total peace of mind."
  - **Meaning Check**:
    - Kept: `peace of mind` (green badge)
    - Changed: `14-day → 30-day` (amber badge)
    - Dropped: None (all must-say constraints preserved)
  - **Action**: Click **Accept Fix**.
  - **Result**: Draft updates instantly and version increment is tracked.

### 4. Act IV — Workflow, Diffs & Manager Approval (4:45 - 6:15)
- **Screen**: Workflow Timeline & Comments (`/drafts/:id/workflow`).
- **Narration**:
  - Switch to Manager view.
  - Inspect Version Timeline: v1 (Initial Draft) vs v2 (Accepted 30-Day Fix).
  - Open **DiffView**: Green additions (`+ 30-day returns policy`) and red deletions (`- 14-day return window`).
  - Demonstrate threaded comment log between Creator and Manager.
  - Click **Approve Draft**.

### 5. Act V — Brand Passport & Cryptographic Integrity (6:15 - 7:15)
- **Screen**: Brand Passport (`/passports/:id`).
- **Narration**:
  - Point out immutable Passport Details:
    - SHA-256 Hash of approved final copy
    - Full list of checks executed (banned terms, superlatives, NLI entailment, shelf-life, watch-list)
    - Approver signatures with role timestamps
    - AI Used indicator
  - Demonstrate **TamperCheck**:
    - Recomputes SHA-256 in browser via Web Crypto API against current content.
    - Result: `Verified` (green badge).
    - If even a single character is tampered with, hash diverges immediately to `Tampered` (red alert).

### 6. Act VI — Governance Dashboard & Guideline Debugger (7:15 - 8:00)
- **Screen**: Governance Dashboard (`/dashboard`).
- **Narration**:
  - Show real-time KPI metrics: Total Drafts, Avg Approval Time, Open Findings, and 94.6% Source Citation Rate.
  - Review Recent Drafts table with status filters and direct workflow shortcuts.
  - Switch to **Insights Panel**:
    - **Top Repeat Mistakes**: Bar chart revealing frequent superlative and temporal contradictions across the org.
    - **Guideline Debugger**: Demonstrates rule `rule.superlative.unqualified` with 67% override rate, diagnoses guideline ambiguity, and provides one-click "Approve Rewording" action.

---

## Fallback Screen Checklist
In case of network latency during the live pitch:
- Screen 1: Knowledge Base with verified sources
- Screen 2: Preflight Review Page showing the 3 Evidence Cards
- Screen 3: Suggested Fix with Meaning Check badges (Kept/Changed/Dropped)
- Screen 4: Version Timeline with green/red line diffs
- Screen 5: Brand Passport showing Verified cryptographic SHA-256 hash
- Screen 6: Governance Dashboard showing Guideline Debugger
