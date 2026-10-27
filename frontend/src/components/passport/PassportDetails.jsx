import { useState } from 'react';
import './PassportDetails.css';

export default function PassportDetails({ passport }) {
  const [copied, setCopied] = useState(false);

  async function copyHash() {
    await navigator.clipboard.writeText(passport.contentHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="pd-wrapper">
      <div className="pd-section">
        <div className="pd-row">
          <span className="pd-label">Asset</span>
          <span className="pd-value">{passport.assetName}</span>
        </div>
        <div className="pd-row">
          <span className="pd-label">Draft ID</span>
          <span className="pd-value pd-mono">{passport.draftId}</span>
        </div>
        <div className="pd-row">
          <span className="pd-label">Created</span>
          <span className="pd-value">
            {new Date(passport.createdAt).toLocaleString()}
          </span>
        </div>
        <div className="pd-row">
          <span className="pd-label">Rules version</span>
          <span className="pd-value">{passport.rulesVersion}</span>
        </div>
        <div className="pd-row">
          <span className="pd-label">AI used</span>
          <span className={`badge ${passport.aiUsed ? 'badge-outdated' : 'badge-status-approved'}`}>
            {passport.aiUsed ? 'Yes' : 'No'}
          </span>
        </div>
      </div>

      <div className="pd-section">
        <span className="pd-section-label">Content hash (SHA-256)</span>
        <div className="pd-hash-row">
          <code className="pd-hash">{passport.contentHash}</code>
          <button
            type="button"
            id="pd-copy-hash"
            className="btn btn-secondary pd-copy"
            onClick={copyHash}
            aria-label="Copy content hash"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="pd-section">
        <span className="pd-section-label">Checks run</span>
        <ul className="pd-checks">
          {(passport.checksRun ?? []).map((check) => (
            <li key={check} className="pd-check-item">
              <span className="pd-check-icon" aria-hidden="true">✓</span>
              {check}
            </li>
          ))}
        </ul>
      </div>

      <div className="pd-section">
        <span className="pd-section-label">Approvers</span>
        <ul className="pd-approvers">
          {(passport.approvers ?? []).map((a) => (
            <li key={a._id ?? a.name} className="pd-approver">
              <span className="pd-approver-name">{a.name}</span>
              <span className="badge badge-status-approved">{a.role}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
