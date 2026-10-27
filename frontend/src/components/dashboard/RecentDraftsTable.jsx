import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import './RecentDraftsTable.css';

const STATUS_CONFIG = {
  draft:       { label: 'Draft',       className: 'badge-status-draft' },
  'in-review': { label: 'In Review',   className: 'badge-status-in-review' },
  in_review:   { label: 'In Review',   className: 'badge-status-in-review' },
  checked:     { label: 'Checked',     className: 'badge-status-checked' },
  approved:    { label: 'Approved',    className: 'badge-status-approved' },
  published:   { label: 'Published',   className: 'badge-status-published' },
  blocked:     { label: 'Blocked',     className: 'badge-status-blocked' },
};

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export default function RecentDraftsTable({ drafts = [], loading = false }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredDrafts = useMemo(() => {
    return drafts.filter((draft) => {
      const status = (draft.status || 'draft').toLowerCase();
      const normalizedStatus = status.replace('_', '-');
      const matchesFilter =
        statusFilter === 'all' ||
        normalizedStatus === statusFilter ||
        status === statusFilter;

      const title = (draft.title || draft.fileName || 'Untitled Draft').toLowerCase();
      const owner = (draft.owner?.name || draft.owner?.email || draft.createdBy || '').toLowerCase();
      const matchesSearch =
        !searchQuery.trim() ||
        title.includes(searchQuery.toLowerCase()) ||
        owner.includes(searchQuery.toLowerCase());

      return matchesFilter && matchesSearch;
    });
  }, [drafts, statusFilter, searchQuery]);

  return (
    <div className="rdt-container card" id="recent-drafts-section">
      <div className="rdt-header">
        <div className="rdt-header-left">
          <h2 className="rdt-title">Recent Drafts</h2>
          <span className="rdt-count">({filteredDrafts.length})</span>
        </div>

        <div className="rdt-controls">
          <input
            type="search"
            className="form-input rdt-search"
            placeholder="Search by title or author..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search drafts"
          />

          <div className="rdt-filters" role="group" aria-label="Filter drafts by status">
            {['all', 'in-review', 'approved', 'draft', 'blocked'].map((st) => (
              <button
                key={st}
                type="button"
                className={`rdt-filter-btn ${statusFilter === st ? 'rdt-filter-btn--active' : ''}`}
                onClick={() => setStatusFilter(st)}
              >
                {st === 'all' ? 'All' : st.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rdt-loading" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <p>Loading drafts...</p>
        </div>
      ) : filteredDrafts.length === 0 ? (
        <div className="rdt-empty">
          <span className="rdt-empty-icon" aria-hidden="true">📭</span>
          <p className="rdt-empty-text">
            {searchQuery || statusFilter !== 'all'
              ? 'No drafts match the selected filter.'
              : 'No preflight drafts yet.'}
          </p>
          <Link to="/drafts/new" className="btn btn-primary btn-sm rdt-empty-cta">
            Submit New Draft
          </Link>
        </div>
      ) : (
        <div className="rdt-table-wrapper">
          <table className="rdt-table" aria-label="Recent drafts table">
            <thead>
              <tr>
                <th scope="col">Title &amp; Format</th>
                <th scope="col">Status</th>
                <th scope="col">Author</th>
                <th scope="col">Last Updated</th>
                <th scope="col" className="rdt-th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDrafts.map((draft) => {
                const statusKey = (draft.status || 'draft').toLowerCase().replace('_', '-');
                const badge = STATUS_CONFIG[statusKey] || STATUS_CONFIG.draft;
                const draftId = draft._id || draft.id;
                const title = draft.title || draft.fileName || 'Untitled Draft';
                const format = draft.format || 'text';
                const owner = draft.owner?.name || draft.owner?.email || draft.createdBy || 'Creator';
                const isApproved = statusKey === 'approved';

                return (
                  <tr key={draftId} className="rdt-row">
                    <td className="rdt-cell-title">
                      <div className="rdt-title-group">
                        <Link
                          to={`/drafts/${draftId}/review`}
                          className="rdt-title-link"
                          title="Open Draft Review"
                        >
                          {title}
                        </Link>
                        <span className="badge badge-format rdt-format-badge">
                          {format.toUpperCase()}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="rdt-cell-owner">{owner}</td>
                    <td className="rdt-cell-date">{formatDate(draft.updatedAt || draft.createdAt)}</td>
                    <td className="rdt-cell-actions">
                      <div className="rdt-action-links">
                        <Link
                          to={`/drafts/${draftId}/review`}
                          className="btn btn-secondary btn-sm rdt-btn-review"
                          aria-label={`Review ${title}`}
                        >
                          Review
                        </Link>
                        <Link
                          to={`/drafts/${draftId}/workflow`}
                          className="btn btn-secondary btn-sm rdt-btn-workflow"
                          aria-label={`Workflow for ${title}`}
                        >
                          Workflow
                        </Link>
                        {isApproved && (
                          <Link
                            to={`/passports/${draft.passportId || draftId}`}
                            className="btn btn-sm rdt-btn-passport"
                            aria-label={`View Brand Passport for ${title}`}
                          >
                            Passport
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
