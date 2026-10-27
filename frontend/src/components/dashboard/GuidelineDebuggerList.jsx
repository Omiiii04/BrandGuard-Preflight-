import { useState } from 'react';
import './GuidelineDebuggerList.css';

const DEFAULT_REWORDINGS = {
  'rule.superlative.unqualified':
    'Claims must avoid unverified superlatives (e.g., "best", "fastest"). State verified benchmarks, certifications, or exact specifications instead.',
  'rule.date.outdated':
    'Return and shipping policy references must cite current active policy terms (30 days from delivery date) rather than legacy 14-day documentation.',
  'rule.cost.claim':
    'All free delivery or zero-cost promotional offers must specify conditions and minimum order criteria explicitly.',
  'rule.contradiction':
    'Ensure product availability and returns eligibility match current published support guidelines.',
};

export default function GuidelineDebuggerList({
  rules = [],
  loading = false,
  onApproveRewording,
}) {
  const [filterHighOnly, setFilterHighOnly] = useState(false);
  const [approvedRules, setApprovedRules] = useState(new Set());

  const displayedRules = filterHighOnly
    ? rules.filter((r) => (r.overrideRate ?? 0) >= 0.5)
    : rules;

  function handleApprove(ruleId, rewording) {
    setApprovedRules((prev) => new Set([...prev, ruleId]));
    onApproveRewording?.(ruleId, rewording);
  }

  if (loading) {
    return (
      <div className="gdl-loading" aria-busy="true">
        <div className="gdl-skeleton-card" />
        <div className="gdl-skeleton-card" />
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="gdl-empty">
        <p className="gdl-empty-text">No compliance rules analyzed yet.</p>
        <span className="gdl-empty-sub">Once reviews are completed, guideline override telemetry will appear here.</span>
      </div>
    );
  }

  return (
    <div className="gdl-container" role="region" aria-label="Guideline Debugger rule list">
      <div className="gdl-controls">
        <div className="gdl-filter-tabs">
          <button
            type="button"
            className={`gdl-tab ${!filterHighOnly ? 'gdl-tab--active' : ''}`}
            onClick={() => setFilterHighOnly(false)}
          >
            All Rules ({rules.length})
          </button>
          <button
            type="button"
            className={`gdl-tab ${filterHighOnly ? 'gdl-tab--active' : ''}`}
            onClick={() => setFilterHighOnly(true)}
          >
            High Override (&ge; 50%) ({rules.filter((r) => (r.overrideRate ?? 0) >= 0.5).length})
          </button>
        </div>
      </div>

      <div className="gdl-list">
        {displayedRules.map((rule) => {
          const ruleId = rule.ruleId || rule.rule;
          const rate = rule.overrideRate != null ? Math.round(rule.overrideRate * 100) : 0;
          const isHighOverride = rate >= 50;
          const suggestedRewording =
            rule.suggestedRewording ||
            DEFAULT_REWORDINGS[ruleId] ||
            'Refine guideline with clear allowable vocabulary and explicit exclusion criteria.';
          const isApproved = approvedRules.has(ruleId);

          return (
            <div
              key={ruleId}
              className={`gdl-card ${isHighOverride ? 'gdl-card--high-override' : ''}`}
              id={`rule-${ruleId.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
            >
              <div className="gdl-card-header">
                <div className="gdl-card-title-group">
                  <span className="gdl-rule-id">{ruleId}</span>
                  <h3 className="gdl-rule-desc">{rule.description}</h3>
                </div>

                <div className="gdl-metrics-badge">
                  <span
                    className={`badge ${
                      isHighOverride ? 'badge-contradicted' : 'badge-status-in-review'
                    }`}
                  >
                    {rate}% Overridden
                  </span>
                  <span className="gdl-meta-text">
                    ({rule.overrideCount || 0} / {rule.flagsCount || rule.totalTriggered || 0} overrides)
                  </span>
                </div>
              </div>

              {isHighOverride && (
                <div className="gdl-diagnosis-alert">
                  <span className="gdl-diagnosis-icon" aria-hidden="true">⚠️</span>
                  <span>
                    Frequent overrides suggest creators find this guideline ambiguous or over-restrictive.
                  </span>
                </div>
              )}

              <div className="gdl-rewording-section">
                <div className="gdl-rewording-header">
                  <span className="gdl-rewording-label">AI Suggested Rewording</span>
                  <button
                    type="button"
                    className={`btn btn-sm ${
                      isApproved ? 'btn-secondary gdl-btn-approved' : 'btn-primary'
                    }`}
                    onClick={() => handleApprove(ruleId, suggestedRewording)}
                    disabled={isApproved}
                    aria-label={`Approve rewording for ${ruleId}`}
                  >
                    {isApproved ? '✓ Rewording Approved' : 'Approve Rewording'}
                  </button>
                </div>
                <blockquote className="gdl-rewording-text">
                  "{suggestedRewording}"
                </blockquote>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
