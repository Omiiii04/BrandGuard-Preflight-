import './MeaningCheck.css';

export default function MeaningCheck({ meaningCheck }) {
  if (!meaningCheck || typeof meaningCheck !== 'object') return null;

  const kept = Array.isArray(meaningCheck.kept) ? meaningCheck.kept.filter(Boolean) : [];
  const changed = Array.isArray(meaningCheck.changed) ? meaningCheck.changed.filter(Boolean) : [];
  const dropped = Array.isArray(meaningCheck.dropped) ? meaningCheck.dropped.filter(Boolean) : [];

  const hasAnyItems = kept.length > 0 || changed.length > 0 || dropped.length > 0;

  if (!hasAnyItems) {
    return (
      <div className="mc-wrapper">
        <div className="mc-row">
          <span className="badge badge-status-draft mc-label">Meaning</span>
          <span className="mc-items mc-none">Core intent preserved — no must-say points altered</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mc-wrapper" role="region" aria-label="Meaning check summary">
      {kept.length > 0 && (
        <div className="mc-row">
          <span className="badge badge-supported mc-label">Kept</span>
          <span className="mc-items">{kept.join(', ')}</span>
        </div>
      )}
      {changed.length > 0 && (
        <div className="mc-row">
          <span className="badge badge-outdated mc-label">Changed</span>
          <span className="mc-items">{changed.join(', ')}</span>
        </div>
      )}
      {dropped.length === 0 ? (
        <div className="mc-row">
          <span className="badge badge-status-draft mc-label">Dropped</span>
          <span className="mc-items mc-none">Nothing dropped from must-say list</span>
        </div>
      ) : (
        <div className="mc-row">
          <span className="badge badge-contradicted mc-label">Dropped</span>
          <span className="mc-items">{dropped.join(', ')}</span>
        </div>
      )}
    </div>
  );
}
