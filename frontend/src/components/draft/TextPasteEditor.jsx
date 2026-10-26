import './TextPasteEditor.css';

const MAX_CHARS = 50000;

export default function TextPasteEditor({ value, onChange }) {
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const chars = value.length;
  const overLimit = chars > MAX_CHARS;

  return (
    <div className="tpe-wrapper">
      <textarea
        id="draft-text-editor"
        className={`form-input tpe-editor${overLimit ? ' error' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste your draft content here…"
        aria-label="Draft text content"
        aria-describedby="tpe-counts"
        aria-invalid={overLimit}
        maxLength={MAX_CHARS + 1}
      />
      <div id="tpe-counts" className={`tpe-counts${overLimit ? ' tpe-counts--over' : ''}`}>
        <span>{words} word{words !== 1 ? 's' : ''}</span>
        <span
          className={overLimit ? 'tpe-over-limit' : ''}
          aria-live={overLimit ? 'assertive' : 'off'}
        >
          {chars.toLocaleString()} / {MAX_CHARS.toLocaleString()} chars
        </span>
      </div>
    </div>
  );
}
