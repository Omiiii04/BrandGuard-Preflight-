import { useState } from 'react';
import './CommentInput.css';

export default function CommentInput({ onSubmit, disabled }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    await onSubmit?.(text.trim());
    setText('');
    setSubmitting(false);
  }

  return (
    <form className="ci-form" onSubmit={handleSubmit} noValidate>
      <textarea
        id="comment-input"
        className="form-input ci-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment…"
        rows={3}
        disabled={disabled || submitting}
        aria-label="Comment text"
      />
      <button
        type="submit"
        id="comment-submit"
        className="btn btn-primary ci-submit"
        disabled={!text.trim() || submitting || disabled}
        aria-busy={submitting}
      >
        {submitting ? <><span className="spinner" aria-hidden="true" /> Posting…</> : 'Post'}
      </button>
    </form>
  );
}
