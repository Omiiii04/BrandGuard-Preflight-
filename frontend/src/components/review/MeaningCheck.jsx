import './MeaningCheck.css';

export default function MeaningCheck({ meaningCheck }) {
  if (!meaningCheck) return null;
  const { kept = [], changed = [], dropped = [] } = meaningCheck;

  return (
    <div className="mc-wrapper">
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
          <span className="mc-items mc-none">nothing from must-say list</span>
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
