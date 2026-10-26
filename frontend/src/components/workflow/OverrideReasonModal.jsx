import { useState } from 'react';
import './OverrideReasonModal.css';

export default function OverrideReasonModal({ onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason.trim() || submitting) return;
    setSubmitting(true);
    await onConfirm?.(reason.trim());
    setSubmitting(false);
  }

  return (
    <div className="orm-backdrop" role="dialog" aria-modal="true" aria-label="Override finding">
      <div className="orm-modal card">
        <h2 className="orm-title">Override Finding</h2>
        <p className="orm-desc">
          Overriding a finding requires a written justification. This action will be logged.
        </p>
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="override-reason">
              Reason <span aria-hidden="true">*</span>
            </label>
            <textarea
              id="override-reason"
              className="form-input orm-textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="Explain why this finding is being overridden…"
              required
              aria-required="true"
            />
          </div>
          <div className="orm-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              id="override-confirm"
              className="btn btn-danger"
              disabled={!reason.trim() || submitting}
              aria-busy={submitting}
            >
              {submitting ? <><span className="spinner" aria-hidden="true" /> Submitting…</> : 'Confirm Override'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
