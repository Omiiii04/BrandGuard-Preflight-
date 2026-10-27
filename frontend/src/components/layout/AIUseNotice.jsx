import './AIUseNotice.css';

export default function AIUseNotice() {
  return (
    <div className="ai-notice" role="note" aria-label="AI use disclosure">
      <span className="ai-notice-icon" aria-hidden="true">⚡</span>
      AI-assisted review
    </div>
  );
}
