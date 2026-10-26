import './SuggestedFix.css';

export default function SuggestedFix({ value, onChange }) {
  return (
    <div className="sf-wrapper">
      <textarea
        className="form-input sf-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        aria-label="Suggested fix — editable"
        placeholder="No suggestion available"
      />
      {value && (
        <div className="sf-hint">
          Edit the text above before accepting, or accept as-is.
        </div>
      )}
    </div>
  );
}
