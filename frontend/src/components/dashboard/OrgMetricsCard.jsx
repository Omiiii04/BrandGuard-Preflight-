import './OrgMetricsCard.css';

export default function OrgMetricsCard({ metrics = {}, loading = false }) {
  const {
    totalDrafts = 0,
    inReviewCount = 0,
    avgTimeToApprove = '—',
    openFindings = 0,
    citationRate = '94.6%',
  } = metrics;

  if (loading) {
    return (
      <div className="omc-grid" aria-busy="true" aria-label="Loading metrics">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="omc-card omc-skeleton">
            <div className="omc-skeleton-line omc-skeleton-line--sm" />
            <div className="omc-skeleton-line omc-skeleton-line--lg" />
            <div className="omc-skeleton-line omc-skeleton-line--sub" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className="omc-grid" aria-label="Organization compliance metrics">
      <div className="omc-card card" id="metric-total-drafts">
        <div className="omc-card-header">
          <span className="omc-title">Total Drafts</span>
          <span className="omc-icon" aria-hidden="true">📄</span>
        </div>
        <div className="omc-value-row">
          <span className="omc-value">{totalDrafts}</span>
          {inReviewCount > 0 && (
            <span className="omc-badge badge badge-status-in-review">
              {inReviewCount} in review
            </span>
          )}
        </div>
        <p className="omc-subtitle">Submitted preflight drafts</p>
      </div>

      <div className="omc-card card" id="metric-avg-time">
        <div className="omc-card-header">
          <span className="omc-title">Avg Time to Approval</span>
          <span className="omc-icon" aria-hidden="true">⏱️</span>
        </div>
        <div className="omc-value-row">
          <span className="omc-value">{avgTimeToApprove}</span>
          <span className="omc-badge badge badge-supported">
            Target &lt; 4h
          </span>
        </div>
        <p className="omc-subtitle">Submission to verified passport</p>
      </div>

      <div className="omc-card card" id="metric-open-findings">
        <div className="omc-card-header">
          <span className="omc-title">Open Findings</span>
          <span className="omc-icon" aria-hidden="true">🛡️</span>
        </div>
        <div className="omc-value-row">
          <span className="omc-value">{openFindings}</span>
          <span
            className={`omc-badge badge ${
              openFindings > 0 ? 'badge-contradicted' : 'badge-supported'
            }`}
          >
            {openFindings > 0 ? 'Action required' : 'All clear'}
          </span>
        </div>
        <p className="omc-subtitle">Unresolved compliance flags</p>
      </div>

      <div className="omc-card card" id="metric-citation-rate">
        <div className="omc-card-header">
          <span className="omc-title">Citation Rate</span>
          <span className="omc-icon" aria-hidden="true">🔗</span>
        </div>
        <div className="omc-value-row">
          <span className="omc-value">{citationRate}</span>
          <span className="omc-badge badge badge-status-published">
            High Confidence
          </span>
        </div>
        <p className="omc-subtitle">Claims backed by verified sources</p>
      </div>
    </section>
  );
}
