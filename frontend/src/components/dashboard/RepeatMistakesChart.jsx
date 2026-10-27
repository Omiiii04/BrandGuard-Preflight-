import { useState } from 'react';
import './RepeatMistakesChart.css';

export default function RepeatMistakesChart({ mistakes = [], loading = false }) {
  const [expandedIndex, setExpandedIndex] = useState(null);

  const topMistakes = mistakes.slice(0, 5);
  const maxCount = Math.max(...topMistakes.map((m) => m.count || 0), 1);

  if (loading) {
    return (
      <div className="rmc-container" aria-busy="true">
        <div className="rmc-skeleton-line" />
        <div className="rmc-skeleton-line" />
        <div className="rmc-skeleton-line" />
      </div>
    );
  }

  if (topMistakes.length === 0) {
    return (
      <div className="rmc-empty">
        <p className="rmc-empty-text">No recurring compliance mistakes detected.</p>
        <span className="rmc-empty-sub">Draft submissions are currently adhering to brand guidelines.</span>
      </div>
    );
  }

  return (
    <div className="rmc-container" role="region" aria-label="Top 5 repeat compliance mistakes chart">
      <div className="rmc-list">
        {topMistakes.map((item, index) => {
          const count = item.count || 0;
          const percentage = Math.round((count / maxCount) * 100);
          const isExpanded = expandedIndex === index;

          return (
            <div key={item.category || index} className="rmc-item">
              <div className="rmc-item-header">
                <span className="rmc-category">{item.category}</span>
                <div className="rmc-stats">
                  <span className="rmc-count badge badge-status-in-review">
                    {count} {count === 1 ? 'flag' : 'flags'}
                  </span>
                  {item.topExample && (
                    <button
                      type="button"
                      className="rmc-example-toggle"
                      onClick={() => setExpandedIndex(isExpanded ? null : index)}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Hide' : 'Show'} example for ${item.category}`}
                    >
                      {isExpanded ? 'Hide example' : 'View example'}
                    </button>
                  )}
                </div>
              </div>

              <div className="rmc-bar-track" aria-hidden="true">
                <div
                  className="rmc-bar-fill"
                  style={{ width: `${Math.max(percentage, 8)}%` }}
                />
              </div>

              {isExpanded && item.topExample && (
                <div className="rmc-example-box" role="note">
                  <span className="rmc-example-label">Top Example:</span>
                  <blockquote className="rmc-example-quote">"{item.topExample}"</blockquote>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
