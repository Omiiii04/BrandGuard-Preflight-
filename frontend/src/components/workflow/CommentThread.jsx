import './CommentThread.css';

const ROLE_BADGE = {
  manager:  'badge-status-checked',
  admin:    'badge-status-approved',
  creator:  'badge-status-draft',
  owner:    'badge-outdated',
  reviewer: 'badge-status-inreview',
};

function initials(name = '') {
  return name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2);
}

export default function CommentThread({ comments }) {
  if (!comments?.length) {
    return (
      <div className="ct-empty">
        <p>No comments yet.</p>
      </div>
    );
  }

  return (
    <div className="ct-list" role="list" aria-label="Comment thread">
      {comments.map((c) => {
        const isApproval = c.type === 'approved';
        const isChangeReq = c.type === 'changes-requested';

        return (
          <div
            key={c._id}
            role="listitem"
            className={`ct-item${isApproval ? ' ct-item--approved' : ''}${isChangeReq ? ' ct-item--changes' : ''}`}
          >
            <div className="ct-avatar" aria-hidden="true">
              {initials(c.authorName)}
            </div>
            <div className="ct-body">
              <div className="ct-meta">
                <span className="ct-author">{c.authorName}</span>
                <span className={`badge ${ROLE_BADGE[c.authorRole] ?? 'badge-status-draft'}`}>
                  {c.authorRole}
                </span>
                <time className="ct-time" dateTime={c.createdAt}>
                  {new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
              <p className="ct-text">
                {isApproval && <span className="ct-checkmark" aria-hidden="true">✓ </span>}
                {c.text}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
