import './ImageChecksPanel.css';

export default function ImageChecksPanel({ imageChecks = [] }) {
  if (!imageChecks || imageChecks.length === 0) return null;

  return (
    <div className="icp-wrapper card" role="region" aria-label="Visual and Image Compliance Checks">
      <div className="icp-header">
        <span className="icp-icon" aria-hidden="true">🎨</span>
        <div>
          <h3 className="icp-title">Visual &amp; Image Compliance</h3>
          <p className="icp-subtitle">Brand palette verification, WCAG contrast ratio, and accessibility</p>
        </div>
      </div>

      <div className="icp-list">
        {imageChecks.map((check, idx) => {
          const isPassed = check.passed !== false;
          return (
            <div key={idx} className={`icp-item ${isPassed ? 'icp-item--passed' : 'icp-item--failed'}`}>
              <div className="icp-item-left">
                <span className={`badge ${isPassed ? 'badge-supported' : 'badge-contradicted'}`}>
                  {isPassed ? 'Pass' : 'Fail'}
                </span>
                <span className="icp-type">
                  {check.checkType === 'palette'
                    ? 'Brand Palette Match'
                    : check.checkType === 'contrast'
                    ? `WCAG ${check.wcagLevel || 'AA'} Contrast`
                    : 'Alt-Text Verification'}
                </span>
              </div>
              <p className="icp-details">{check.details}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
