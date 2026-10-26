import { useState, useEffect } from 'react';
import AppLayout from '../components/layout/AppLayout';
import SourceList from '../components/knowledge/SourceList';
import SourceUploader from '../components/knowledge/SourceUploader';
import { getSources } from '../api/sources';
import './KnowledgeBasePage.css';

export default function KnowledgeBasePage() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [selected, setSelected] = useState(null);
  const [showUploader, setShowUploader] = useState(false);

  async function loadSources() {
    setLoading(true);
    setFetchError('');
    try {
      const { data } = await getSources();
      setSources(Array.isArray(data) ? data : (data?.data || []));
    } catch {
      setFetchError('Failed to load sources. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSources(); }, []);

  function handleSelect(source) {
    setSelected((prev) => prev?._id === source._id ? null : source);
  }

  function handleUploaded() {
    loadSources();
  }

  return (
    <AppLayout pageTitle="Knowledge Base">
      <div className="kb-toolbar">
        <span className="kb-count">
          {!loading && `${sources.length} source${sources.length !== 1 ? 's' : ''}`}
        </span>
        <button
          id="kb-add-source"
          className="btn btn-primary"
          onClick={() => setShowUploader(true)}
        >
          + Add source
        </button>
      </div>

      {fetchError && (
        <div className="kb-error" role="alert">
          {fetchError}
          <button className="btn btn-secondary" onClick={loadSources} style={{ marginLeft: 12 }}>
            Retry
          </button>
        </div>
      )}

      <div className="kb-layout">
        <div className="kb-list-col">
          <SourceList
            sources={sources}
            loading={loading}
            selectedId={selected?._id}
            onSelect={handleSelect}
          />
        </div>

        <aside className="kb-detail-col card">
          {selected ? (
            <div className="kb-detail">
              <h2 className="kb-detail-title">{selected.fileName}</h2>

              <dl className="kb-detail-meta">
                <dt>Type</dt>
                <dd>{selected.type}</dd>
                <dt>Version</dt>
                <dd>{selected.version || '—'}</dd>
                <dt>Owner</dt>
                <dd>{selected.ownerName || '—'}</dd>
                <dt>Effective</dt>
                <dd>{selected.effectiveDate ? new Date(selected.effectiveDate).toLocaleDateString() : '—'}</dd>
                <dt>Expires</dt>
                <dd>{selected.expiryDate ? new Date(selected.expiryDate).toLocaleDateString() : '—'}</dd>
                <dt>Status</dt>
                <dd><span className="badge badge-status-checked">{selected.status}</span></dd>
              </dl>
            </div>
          ) : (
            <div className="empty-state">
              <p>Select a source to see its details.</p>
            </div>
          )}
        </aside>
      </div>

      {showUploader && (
        <SourceUploader
          onUploaded={handleUploaded}
          onClose={() => setShowUploader(false)}
        />
      )}
    </AppLayout>
  );
}
