import { useState } from 'react';
import OverrideReasonModal from './OverrideReasonModal';
import './ApprovalControls.css';

export default function ApprovalControls({ role, draftStatus, onApprove, onRequestChanges, onOverride }) {
  const [showOverride, setShowOverride] = useState(false);

  const isManager = role === 'manager' || role === 'admin';
  const isCreator = role === 'creator';
  const isApproved = draftStatus === 'approved';

  if (isCreator) {
    return (
      <div className="ac-bar">
        <div className="ac-creator-status">
          {isApproved ? (
            <span className="badge badge-status-approved">Approved</span>
          ) : (
            <span className="badge badge-status-inreview">Awaiting approval</span>
          )}
          <span className="ac-creator-note">You cannot approve your own draft.</span>
        </div>
      </div>
    );
  }

  if (!isManager) return null;

  async function handleOverride(reason) {
    await onOverride?.(reason);
    setShowOverride(false);
  }

  return (
    <>
      <div className="ac-bar">
        <span className="ac-label">Review decision</span>
        <div className="ac-actions">
          <button
            type="button"
            id="ac-approve"
            className="btn btn-success"
            onClick={onApprove}
            disabled={isApproved}
          >
            Approve
          </button>
          <button
            type="button"
            id="ac-request-changes"
            className="btn btn-secondary ac-amber"
            onClick={onRequestChanges}
            disabled={isApproved}
          >
            Request Changes
          </button>
          <button
            type="button"
            id="ac-override"
            className="btn btn-danger"
            onClick={() => setShowOverride(true)}
          >
            Override Finding
          </button>
        </div>
      </div>

      {showOverride && (
        <OverrideReasonModal
          onConfirm={handleOverride}
          onClose={() => setShowOverride(false)}
        />
      )}
    </>
  );
}
