import './DiffView.css';

export default function DiffView({ version }) {
  if (!version) return null;

  const lines = version.diff ?? [];

  return (
    <div className="dv2-wrapper">
      <div className="dv2-heading">
        Diff — v{version.version}
        <span className="dv2-author">by {version.authorName}</span>
      </div>
      {lines.length === 0 ? (
        <p className="dv2-empty">No diff available for this version.</p>
      ) : (
        <div
          className="dv2-diff"
          role="region"
          aria-label={`Line-by-line diff for version ${version.version}`}
        >
          {lines.map((line, i) => (
            <div key={i} className={`dv2-line dv2-line--${line.type}`}>
              <span className="dv2-marker" aria-hidden="true">
                {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : '\u00a0'}
              </span>
              <span className="dv2-text">{line.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
