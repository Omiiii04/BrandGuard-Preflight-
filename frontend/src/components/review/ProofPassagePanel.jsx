import './ProofPassagePanel.css';

export default function ProofPassagePanel({ proof }) {
  if (!proof) return null;

  const expiry = proof.expiryDate
    ? new Date(proof.expiryDate).toLocaleDateString()
    : null;

  return (
    <div className="ppp-wrapper">
      <div className="ppp-meta">
        <span className="ppp-filename">{proof.fileName}</span>
        {proof.page && <span className="ppp-detail">page {proof.page}</span>}
        {proof.version && <span className="ppp-detail">v{proof.version}</span>}
        {expiry && <span className="ppp-detail">expires {expiry}</span>}
        {proof.ownerName && <span className="ppp-detail">owner: {proof.ownerName}</span>}
      </div>
      <blockquote className="ppp-passage">"{proof.passage}"</blockquote>
    </div>
  );
}
