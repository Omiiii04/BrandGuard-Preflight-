const MAP = {
  Supported:    'badge-supported',
  Contradicted: 'badge-contradicted',
  Outdated:     'badge-outdated',
  'Not Found':  'badge-notfound',
  Unclear:      'badge-unclear',
};

export default function VerdictBadge({ verdict }) {
  return (
    <span className={`badge ${MAP[verdict] ?? 'badge-notfound'}`}>
      {verdict}
    </span>
  );
}
