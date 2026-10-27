import { useState } from 'react';
import RepeatMistakesChart from './RepeatMistakesChart';
import GuidelineDebuggerList from './GuidelineDebuggerList';
import './InsightsPanel.css';

export default function InsightsPanel({
  mistakes = [],
  rules = [],
  loading = false,
  onNotify,
}) {
  const [activeTab, setActiveTab] = useState('mistakes');

  function handleApproveRewording(ruleId, _rewording) {
    onNotify?.(`Guideline updated for "${ruleId}". Rewording has been published.`, 'success');
  }

  const highOverrideCount = rules.filter((r) => (r.overrideRate ?? 0) >= 0.5).length;

  return (
    <div className="ip-container card" id="insights-panel-section">
      <div className="ip-header">
        <div className="ip-header-left">
          <h2 className="ip-title">Governance &amp; Insights</h2>
          <p className="ip-subtitle">
            Systemic mistake telemetry &amp; guideline optimization
          </p>
        </div>

        <div className="ip-tab-group" role="tablist" aria-label="Insights tabs">
          <button
            type="button"
            role="tab"
            id="tab-repeat-mistakes"
            aria-selected={activeTab === 'mistakes'}
            aria-controls="panel-repeat-mistakes"
            className={`ip-tab-btn ${activeTab === 'mistakes' ? 'ip-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('mistakes')}
          >
            Repeat Mistakes ({Math.min(mistakes.length, 5)})
          </button>

          <button
            type="button"
            role="tab"
            id="tab-guideline-debugger"
            aria-selected={activeTab === 'debugger'}
            aria-controls="panel-guideline-debugger"
            className={`ip-tab-btn ${activeTab === 'debugger' ? 'ip-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('debugger')}
          >
            Guideline Debugger
            {highOverrideCount > 0 && (
              <span className="ip-tab-badge">{highOverrideCount}</span>
            )}
          </button>
        </div>
      </div>

      <div className="ip-body">
        {activeTab === 'mistakes' ? (
          <div
            id="panel-repeat-mistakes"
            role="tabpanel"
            aria-labelledby="tab-repeat-mistakes"
          >
            <div className="ip-section-desc">
              <span className="ip-info-icon" aria-hidden="true">📊</span>
              <span>Top 5 compliance issue categories recurring across drafts.</span>
            </div>
            <RepeatMistakesChart mistakes={mistakes} loading={loading} />
          </div>
        ) : (
          <div
            id="panel-guideline-debugger"
            role="tabpanel"
            aria-labelledby="tab-guideline-debugger"
          >
            <div className="ip-section-desc">
              <span className="ip-info-icon" aria-hidden="true">🔍</span>
              <span>
                Rules flagged with frequent overrides (&gt;50%) indicate confusing or overly strict wording.
              </span>
            </div>
            <GuidelineDebuggerList
              rules={rules}
              loading={loading}
              onApproveRewording={handleApproveRewording}
            />
          </div>
        )}
      </div>
    </div>
  );
}
