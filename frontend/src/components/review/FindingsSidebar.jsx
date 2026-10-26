import EvidenceCard from './EvidenceCard';
import './FindingsSidebar.css';

export default function FindingsSidebar({ findings, loading, onAction }) {
  if (loading) {
    return (
      <div className="loading-state fs-loading">
        <span className="spinner" aria-hidden="true" />
        <span>Analysing draft…</span>
      </div>
    );
  }

  if (!findings?.length) {
    return (
      <div className="empty-state fs-empty">
        <p>No findings to display.</p>
      </div>
    );
  }

  return (
    <div className="fs-list" role="list" aria-label="Findings">
      {findings.map((finding) => (
        <div key={finding._id} role="listitem">
          <EvidenceCard finding={finding} onAction={onAction} />
        </div>
      ))}
    </div>
  );
}
