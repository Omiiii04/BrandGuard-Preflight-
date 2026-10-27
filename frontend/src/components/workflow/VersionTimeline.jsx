import './VersionTimeline.css';

const STATUS_BADGE = {
  draft:       'badge-status-draft',
  'in-review': 'badge-status-inreview',
  approved:    'badge-status-approved',
  blocked:     'badge-status-blocked',
};

export default function VersionTimeline({ versions, selectedId, onSelect }) {
  if (!versions?.length) return null;

  return (
    <div className="vt-wrapper" role="list" aria-label="Version timeline">
      {versions.map((v, i) => (
        <div key={v._id} className="vt-item" role="listitem">
          <button
            type="button"
            className={`vt-btn${selectedId === v._id ? ' vt-btn--active' : ''}`}
            onClick={() => onSelect(selectedId === v._id ? null : v)}
            aria-pressed={selectedId === v._id}
          >
            <span className="vt-version">v{v.version}</span>
            <span className={`badge ${STATUS_BADGE[v.status] ?? 'badge-status-draft'}`}>
              {v.status}
            </span>
            <span className="vt-author">{v.authorName}</span>
            <time className="vt-time" dateTime={v.createdAt}>
              {new Date(v.createdAt).toLocaleString([], {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </time>
          </button>
          {i < versions.length - 1 && (
            <span className="vt-arrow" aria-hidden="true">›</span>
          )}
        </div>
      ))}
    </div>
  );
}
