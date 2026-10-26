import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout';
import CommentThread from '../components/workflow/CommentThread';
import CommentInput from '../components/workflow/CommentInput';
import ApprovalControls from '../components/workflow/ApprovalControls';
import { getComments, postComment, approveDraft, requestChanges, overrideFinding } from '../api/workflow';
import { useAuth } from '../context/AuthContext';
import './WorkflowPage.css';

const MOCK_COMMENTS = [
  {
    _id: 'c1',
    authorName: 'Priya Mehta',
    authorRole: 'manager',
    text: 'The superlative claim needs to be removed before I can approve.',
    type: 'changes-requested',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    _id: 'c2',
    authorName: 'Rohan Das',
    authorRole: 'creator',
    text: 'Updated the copy — removed "best returns policy" and corrected the 14-day window.',
    type: 'comment',
    createdAt: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    _id: 'c3',
    authorName: 'Priya Mehta',
    authorRole: 'manager',
    text: 'Priya Mehta approved this draft.',
    type: 'approved',
    createdAt: new Date(Date.now() - 900000).toISOString(),
  },
];

const MOCK_VERSIONS = [
  { _id: 'v1', version: 1, status: 'draft', authorName: 'Rohan Das', createdAt: new Date(Date.now() - 7200000).toISOString(), diff: null },
  { _id: 'v2', version: 2, status: 'in-review', authorName: 'Rohan Das', createdAt: new Date(Date.now() - 3600000).toISOString(), diff: [
    { type: 'removed', text: 'We offer the best returns policy in India, giving customers peace of mind.' },
    { type: 'added',   text: 'We offer a 30-day returns policy, giving customers peace of mind.' },
    { type: 'removed', text: 'Our 14-day return window is designed to be fair and hassle-free.' },
    { type: 'added',   text: 'Our 30-day return window is designed to be fair and hassle-free.' },
    { type: 'unchanged', text: 'Returns are processed free of charge with no hidden fees.' },
  ]},
  { _id: 'v3', version: 3, status: 'approved', authorName: 'Priya Mehta', createdAt: new Date(Date.now() - 900000).toISOString(), diff: null },
];

const STATUS_BADGE = {
  draft:      'badge-status-draft',
  'in-review': 'badge-status-inreview',
  approved:   'badge-status-approved',
  blocked:    'badge-status-blocked',
};

const USE_MOCK = import.meta.env.VITE_USE_MOCK_FINDINGS === 'true';

export default function WorkflowPage() {
  const { draftId } = useParams();
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [versions] = useState(MOCK_VERSIONS);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [draftStatus, setDraftStatus] = useState('in-review');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const loadComments = useCallback(async () => {
    setLoading(true);
    try {
      if (USE_MOCK) {
        await new Promise((r) => setTimeout(r, 400));
        setComments(MOCK_COMMENTS);
      } else {
        const { data } = await getComments(draftId);
        setComments(Array.isArray(data) ? data : (data?.data || []));
      }
    } catch {
      showToast('Failed to load comments.', 'error');
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => { loadComments(); }, [loadComments]);

  async function handleComment(text) {
    try {
      if (USE_MOCK) {
        const newComment = {
          _id: `c-${Date.now()}`,
          authorName: user?.name ?? 'You',
          authorRole: user?.role ?? 'creator',
          text,
          type: 'comment',
          createdAt: new Date().toISOString(),
        };
        setComments((prev) => [...prev, newComment]);
      } else {
        await postComment(draftId, { text });
        await loadComments();
      }
      showToast('Comment posted.', 'success');
    } catch {
      showToast('Failed to post comment.', 'error');
    }
  }

  async function handleApprove() {
    try {
      if (!USE_MOCK) await approveDraft(draftId);
      setDraftStatus('approved');
      showToast('Draft approved.', 'success');
    } catch {
      showToast('Approval failed.', 'error');
    }
  }

  async function handleRequestChanges() {
    try {
      if (!USE_MOCK) await requestChanges(draftId, { reason: 'Changes requested.' });
      setDraftStatus('draft');
      showToast('Changes requested.', 'success');
    } catch {
      showToast('Action failed.', 'error');
    }
  }

  async function handleOverride(reason) {
    try {
      if (!USE_MOCK) await overrideFinding(draftId, { reason });
      showToast('Override logged.', 'success');
    } catch {
      showToast('Override failed.', 'error');
    }
  }

  return (
    <AppLayout pageTitle="Workflow">
      <div className="wp-layout">
        <div className="wp-main">
          <section className="wp-timeline-section">
            <h2 className="wp-section-heading">Version Timeline</h2>
            <div className="wp-timeline" role="list" aria-label="Version history">
              {versions.map((v, i) => (
                <div key={v._id} className="wp-timeline-item" role="listitem">
                  <button
                    type="button"
                    className={`wp-version-btn${selectedVersion?._id === v._id ? ' wp-version-btn--active' : ''}`}
                    onClick={() => setSelectedVersion(selectedVersion?._id === v._id ? null : v)}
                    aria-pressed={selectedVersion?._id === v._id}
                  >
                    <span className="wp-version-label">v{v.version}</span>
                    <span className={`badge ${STATUS_BADGE[v.status] ?? 'badge-status-draft'}`}>
                      {v.status}
                    </span>
                    <span className="wp-version-author">{v.authorName}</span>
                    <time className="wp-version-time" dateTime={v.createdAt}>
                      {new Date(v.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </button>
                  {i < versions.length - 1 && (
                    <div className="wp-timeline-arrow" aria-hidden="true">›</div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {selectedVersion?.diff && (
            <section className="wp-diff-section card">
              <h2 className="wp-section-heading">
                Diff — v{selectedVersion.version}
              </h2>
              <div className="wp-diff" role="region" aria-label="Line-by-line diff">
                {selectedVersion.diff.map((line, i) => (
                  <div
                    key={i}
                    className={`wp-diff-line wp-diff-line--${line.type}`}
                  >
                    <span className="wp-diff-marker" aria-hidden="true">
                      {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
                    </span>
                    <span className="wp-diff-text">{line.text}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="wp-comments-col card" aria-label="Comment thread">
          <h2 className="wp-section-heading">Comments</h2>
          {loading ? (
            <div className="loading-state">
              <span className="spinner" aria-hidden="true" />
            </div>
          ) : (
            <CommentThread comments={comments} />
          )}
          <div className="wp-comment-input">
            <CommentInput onSubmit={handleComment} />
          </div>
        </aside>
      </div>

      <ApprovalControls
        role={user?.role}
        draftStatus={draftStatus}
        onApprove={handleApprove}
        onRequestChanges={handleRequestChanges}
        onOverride={handleOverride}
      />

      {toast && (
        <div
          className={`toast toast-${toast.type} wp-toast`}
          role="status"
          aria-live="polite"
        >
          {toast.msg}
        </div>
      )}
    </AppLayout>
  );
}
