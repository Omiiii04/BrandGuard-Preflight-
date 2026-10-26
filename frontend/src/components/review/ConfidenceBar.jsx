import './ConfidenceBar.css';

export default function ConfidenceBar({ confidence }) {
  const pct = Math.round(confidence * 100);

  let colorClass = 'cb-fill--low';
  if (pct >= 80) colorClass = 'cb-fill--high';
  else if (pct >= 60) colorClass = 'cb-fill--mid';

  return (
    <div className="cb-wrapper" title={`Confidence: ${pct}%`}>
      <div className="cb-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Confidence ${pct}%`}>
        <div className={`cb-fill ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="cb-label">{pct}%</span>
    </div>
  );
}
