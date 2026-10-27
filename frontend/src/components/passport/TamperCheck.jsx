import { useState } from 'react';
import './TamperCheck.css';

async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function TamperCheck({ storedHash, currentContent }) {
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);

  async function verify() {
    setChecking(true);
    setStatus(null);
    try {
      const computed = await sha256(currentContent ?? '');
      setStatus(computed === storedHash ? 'verified' : 'tampered');
    } catch {
      setStatus('error');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="tc-wrapper">
      <button
        type="button"
        id="tc-verify"
        className="btn btn-secondary tc-btn"
        onClick={verify}
        disabled={checking}
        aria-busy={checking}
      >
        {checking ? (
          <><span className="spinner" aria-hidden="true" /> Verifying…</>
        ) : 'Verify Integrity'}
      </button>

      {status === 'verified' && (
        <div className="tc-result tc-result--verified" role="status">
          <span className="tc-icon" aria-hidden="true">✓</span>
          <div>
            <strong>Verified</strong>
            <p>Content has not been modified since approval.</p>
          </div>
        </div>
      )}

      {status === 'tampered' && (
        <div className="tc-result tc-result--tampered" role="alert">
          <span className="tc-icon" aria-hidden="true">✕</span>
          <div>
            <strong>Tampered</strong>
            <p>Content differs from the approved version.</p>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="tc-result tc-result--tampered" role="alert">
          <span className="tc-icon" aria-hidden="true">!</span>
          <div>
            <strong>Error</strong>
            <p>Could not compute hash. Please try again.</p>
          </div>
        </div>
      )}
    </div>
  );
}
