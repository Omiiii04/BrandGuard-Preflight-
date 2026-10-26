import './PreMortemPanel.css';

const VIEWPOINTS = ['Regulator', 'Journalist', 'Competitor', 'Screen-Reader'];

const DEFAULT_REASONS = {
  Regulator: 'Unverified comparative claim may breach advertising standards.',
  Journalist: 'Unsupported superlative is headline-worthy.',
  Competitor: 'Could trigger a counter-claim or legal challenge.',
  'Screen-Reader': 'Highlighted claim has no accessible context for assistive technology.',
};

export default function PreMortemPanel({ riskiestSpan, viewpoints }) {
  const vps = viewpoints ?? VIEWPOINTS.map((v) => ({
    viewpoint: v,
    reason: DEFAULT_REASONS[v],
  }));

  return (
    <div className="pmp-wrapper">
      {riskiestSpan && (
        <blockquote className="pmp-quote">"{riskiestSpan}"</blockquote>
      )}
      <div className="pmp-viewpoints">
        {vps.map(({ viewpoint, reason }) => (
          <div key={viewpoint} className="pmp-item">
            <span className="badge badge-status-draft pmp-badge">{viewpoint}</span>
            <span className="pmp-reason">{reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
