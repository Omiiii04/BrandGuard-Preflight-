import { useState } from 'react';
import VerdictBadge from './VerdictBadge';
import ConfidenceBar from './ConfidenceBar';
import ProofPassagePanel from './ProofPassagePanel';
import MeaningCheck from './MeaningCheck';
import './EvidenceCard.css';

const SECTIONS = ['DRAFT', 'PROOF', 'WHY FLAGGED', 'SUGGESTED FIX', 'MEANING CHECK'];

export default function EvidenceCard({ finding, onAction }) {
  const [editedFix, setEditedFix] = useState(finding.suggestedFix || '');
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function act(action) {
    onAction?.({ findingId: finding._id, action, editedFix });
    if (action === 'dismiss') setDismissed(true);
  }

  return (
    <article
      className="ec-card card"
      id={`finding-${finding._id}`}
      aria-label={`Finding ${finding.index} of ${finding.total}: ${finding.type}`}
    >
      <header className="ec-header">
        <span className="ec-counter">
          Finding {finding.index} of {finding.total}: {finding.type}
        </span>
        <div className="ec-verdict-row">
          <VerdictBadge verdict={finding.verdict} />
          <ConfidenceBar confidence={finding.confidence} />
        </div>
      </header>

      <div className="ec-divider" />

      <section className="ec-section">
        <span className="ec-section-label">{SECTIONS[0]}</span>
        <blockquote className="ec-draft-quote">
          "{finding.draftContext}"
          {finding.draftSpan && (
            <mark className={`ec-span ec-span--${finding.verdict.toLowerCase().replace(' ', '-')}`}>
              {' '}{finding.draftSpan}
            </mark>
          )}
        </blockquote>
      </section>

      <div className="ec-divider" />

      <section className="ec-section">
        <span className="ec-section-label">{SECTIONS[1]}</span>
        <ProofPassagePanel proof={finding.proof} />
      </section>

      <div className="ec-divider" />

      <section className="ec-section">
        <span className="ec-section-label">{SECTIONS[2]}</span>
        <p className="ec-reason">{finding.reason}</p>
      </section>

      {finding.verdict !== 'Supported' && (
        <>
          <div className="ec-divider" />
          <section className="ec-section">
            <span className="ec-section-label">{SECTIONS[3]}</span>
            <textarea
              className="form-input ec-fix-textarea"
              value={editedFix}
              onChange={(e) => setEditedFix(e.target.value)}
              rows={3}
              aria-label="Suggested fix — editable"
              placeholder="No suggestion available"
            />
          </section>

          <div className="ec-divider" />
          <section className="ec-section">
            <span className="ec-section-label">{SECTIONS[4]}</span>
            <MeaningCheck meaningCheck={finding.meaningCheck} />
          </section>
        </>
      )}

      <div className="ec-divider" />

      <footer className="ec-actions">
        {finding.verdict !== 'Supported' && (
          <>
            <button
              type="button"
              id={`ec-accept-${finding._id}`}
              className="btn btn-success"
              onClick={() => act('accept')}
            >
              Accept Fix
            </button>
            <button
              type="button"
              id={`ec-edit-${finding._id}`}
              className="btn btn-secondary"
              onClick={() => act('edit')}
            >
              Edit
            </button>
          </>
        )}
        <button
          type="button"
          id={`ec-dismiss-${finding._id}`}
          className="btn btn-secondary"
          onClick={() => act('dismiss')}
        >
          Dismiss
        </button>
        <button
          type="button"
          id={`ec-ask-${finding._id}`}
          className="btn btn-secondary"
          onClick={() => act('ask-owner')}
        >
          Ask Owner
        </button>
      </footer>
    </article>
  );
}
