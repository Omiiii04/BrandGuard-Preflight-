import './DraftViewer.css';

const VERDICT_CLASS = {
  Contradicted: 'dv-span--contradicted',
  Outdated:     'dv-span--outdated',
  'Not Found':  'dv-span--notfound',
  Unclear:      'dv-span--unclear',
  Supported:    'dv-span--supported',
};

function buildSegments(text, findings) {
  if (!findings?.length || !text) return [{ text, highlight: null }];

  const marks = [];
  findings.forEach((f) => {
    if (!f.draftSpan) return;
    const idx = text.indexOf(f.draftSpan);
    if (idx === -1) return;
    marks.push({ start: idx, end: idx + f.draftSpan.length, finding: f });
  });

  if (!marks.length) return [{ text, highlight: null }];

  marks.sort((a, b) => a.start - b.start);

  const segments = [];
  let cursor = 0;
  for (const m of marks) {
    if (m.start > cursor) {
      segments.push({ text: text.slice(cursor, m.start), highlight: null });
    }
    segments.push({ text: text.slice(m.start, m.end), highlight: m.finding });
    cursor = m.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlight: null });
  }
  return segments;
}

export default function DraftViewer({ content, findings, onHighlightClick }) {
  const segments = buildSegments(content, findings);

  return (
    <div className="dv-wrapper" aria-label="Draft text with highlights">
      <p className="dv-text">
        {segments.map((seg, i) =>
          seg.highlight ? (
            <mark
              key={i}
              className={`dv-span ${VERDICT_CLASS[seg.highlight.verdict] ?? 'dv-span--notfound'}`}
              onClick={() => onHighlightClick?.(seg.highlight)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onHighlightClick?.(seg.highlight)}
              aria-label={`Finding: ${seg.highlight.verdict} — ${seg.text}`}
              title={seg.highlight.verdict}
            >
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </p>
    </div>
  );
}
