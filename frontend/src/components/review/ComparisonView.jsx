import './ComparisonView.css';

export default function ComparisonView({ finding, onClose }) {
  if (!finding) return null;

  return (
    <div className="cv-backdrop" role="dialog" aria-modal="true" aria-label="Comparison view">
      <div className="cv-modal card">
        <div className="cv-header">
          <h2 className="cv-title">Comparison — {finding.type}</h2>
          <button className="btn btn-secondary cv-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="cv-columns">
          <div className="cv-col">
            <span className="cv-col-label">Draft</span>
            <blockquote className="cv-quote cv-quote--draft">
              "{finding.draftContext}"
            </blockquote>
          </div>

          <div className="cv-divider" aria-hidden="true" />

          <div className="cv-col">
            <span className="cv-col-label">Source</span>
            {finding.proof ? (
              <>
                <div className="cv-source-meta">
                  <span className="cv-filename">{finding.proof.fileName}</span>
                  {finding.proof.page && (
                    <span className="cv-detail">page {finding.proof.page}</span>
                  )}
                </div>
                <blockquote className="cv-quote cv-quote--source">
                  "{finding.proof.passage}"
                </blockquote>
              </>
            ) : (
              <p className="cv-no-source">No matching source passage found.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
