/**
 * mockFindings.js — Stellara Brands returns-policy scenario
 *
 * Mirrors the exact shape that the ML pipeline produces for the
 * integration test (draft → claim → passage → NLI → finding).
 * The UI EvidenceCard renders directly from this data when USE_MOCK=true.
 */

export const MOCK_FINDINGS = [
  {
    _id: 'f1',
    index: 1,
    total: 3,
    type: 'violation',
    ruleId: 'rule.superlative.unqualified',
    verdict: 'Contradicted',
    confidence: 0.94,
    draftSpan: 'best returns policy in the market',
    draftContext:
      'Stellara Brands offers the best returns policy in the market, giving customers total peace of mind.',
    proof: {
      fileName: 'Stellara_Returns_Policy_v4.pdf',
      page: 3,
      version: '4.0',
      expiryDate: '2027-06-30',
      ownerName: 'Compliance and Legal',
      passage:
        'Customers may return eligible items within 30 days of the delivery date. ' +
        'No comparison to competitor return policies has been independently validated. ' +
        'The policy does not guarantee superiority over any other retailer.',
    },
    reason:
      'The uploaded source explicitly states that no comparison to competitor policies ' +
      'has been validated and does not support a "best" superlative claim. ' +
      'The phrase "best returns policy in the market" is directly contradicted by the policy document.',
    suggestedFix: 'We offer a 30-day returns policy, giving customers total peace of mind.',
    meaningCheck: {
      kept: ['peace of mind'],
      changed: ['"best returns policy in the market" → "30-day returns policy"'],
      dropped: [],
    },
    status: 'open',
  },
  {
    _id: 'f2',
    index: 2,
    total: 3,
    type: 'violation',
    ruleId: 'rule.date.outdated',
    verdict: 'Outdated',
    confidence: 0.89,
    draftSpan: '14-day return window',
    draftContext:
      'Our 14-day return window is designed to be fair and hassle-free.',
    proof: {
      fileName: 'Stellara_Returns_Policy_v4.pdf',
      page: 5,
      version: '4.0',
      expiryDate: '2027-06-30',
      ownerName: 'Compliance and Legal',
      passage:
        'As of Q1 2026 the standard return window is 30 days. ' +
        'Prior policy documents referencing a 14-day window are superseded.',
    },
    reason:
      'The draft states a 14-day window. The uploaded source (v4.0, Q1 2026) confirms ' +
      'this was updated to 30 days. The claim contains superseded / outdated information.',
    suggestedFix: 'Our 30-day return window is designed to be fair and hassle-free.',
    meaningCheck: {
      kept: ['hassle-free', 'fair'],
      changed: ['14-day → 30-day'],
      dropped: [],
    },
    status: 'open',
  },
  {
    _id: 'f3',
    index: 3,
    total: 3,
    type: 'violation',
    ruleId: 'rule.cost.claim',
    verdict: 'Supported',
    confidence: 0.97,
    draftSpan: 'free of charge with no hidden fees',
    draftContext:
      'Returns are processed free of charge with no hidden fees.',
    proof: {
      fileName: 'Stellara_Returns_Policy_v4.pdf',
      page: 3,
      version: '4.0',
      expiryDate: '2027-06-30',
      ownerName: 'Compliance and Legal',
      passage:
        'Customers may return eligible items within 30 days of the delivery date. ' +
        'No comparison to competitor return policies has been independently validated. ' +
        'The policy does not guarantee superiority over any other retailer.',
    },
    reason:
      'The claim "free of charge with no hidden fees" is directly supported by the ' +
      'uploaded Stellara returns policy (v4.0). No action required.',
    suggestedFix: '',
    meaningCheck: {
      kept: ['free of charge', 'no hidden fees'],
      changed: [],
      dropped: [],
    },
    status: 'open',
  },
];

export const MOCK_DRAFT = {
  _id: 'draft-stellara-integration-001',
  fileName: 'stellara_returns_policy_draft_oct26.txt',
  title: 'Stellara Brands Returns Policy Draft – Integration Test',
  status: 'checked',
  format: 'text',
  content:
    'Stellara Brands offers the best returns policy in the market, ' +
    'giving customers total peace of mind. ' +
    'Our 14-day return window is designed to be fair and hassle-free. ' +
    'Returns are processed free of charge with no hidden fees. ' +
    'Simply contact our support team within 14 days of delivery.',
};
