import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout';
import FileUploadZone from '../components/draft/FileUploadZone';
import TextPasteEditor from '../components/draft/TextPasteEditor';
import IntentForm from '../components/draft/IntentForm';
import { createDraft, submitDraftForReview } from '../api/drafts';
import './DraftSubmitPage.css';

const defaultIntent = {
  purpose: '',
  audience: '',
  mustSay: [],
  constraints: '',
};

export default function DraftSubmitPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('upload');
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [intent, setIntent] = useState(defaultIntent);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const hasContent = tab === 'upload' ? !!file : text.trim().length > 0;
  const canSubmit = hasContent && intent.mustSay.length > 0 && !submitting;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitError('');
    setSubmitting(true);

    try {
      const formData = new FormData();

      if (tab === 'upload' && file) {
        formData.append('file', file);
      } else {
        const blob = new Blob([text], { type: 'text/plain' });
        formData.append('file', blob, 'draft.txt');
      }

      formData.append('purpose', intent.purpose);
      formData.append('audience', intent.audience);
      intent.mustSay.forEach((point) => formData.append('mustSay[]', point));
      if (intent.constraints) formData.append('constraints', intent.constraints);

      const { data: draft } = await createDraft(formData);
      await submitDraftForReview(draft._id);
      navigate(`/drafts/${draft._id}/review`);
    } catch {
      setSubmitError('Submission failed. Please check your connection and try again.');
      setSubmitting(false);
    }
  }

  return (
    <AppLayout pageTitle="New Draft">
      <form className="ds-form" onSubmit={handleSubmit} noValidate>
        <div className="ds-panels">
          <section className="ds-panel card" aria-label="Content input">
            <div className="ds-panel-header">
              <h2 className="ds-panel-title">Content</h2>
              <div className="ds-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  id="tab-upload"
                  aria-selected={tab === 'upload'}
                  aria-controls="panel-upload"
                  className={`ds-tab${tab === 'upload' ? ' ds-tab--active' : ''}`}
                  onClick={() => setTab('upload')}
                >
                  Upload file
                </button>
                <button
                  type="button"
                  role="tab"
                  id="tab-paste"
                  aria-selected={tab === 'paste'}
                  aria-controls="panel-paste"
                  className={`ds-tab${tab === 'paste' ? ' ds-tab--active' : ''}`}
                  onClick={() => setTab('paste')}
                >
                  Paste text
                </button>
              </div>
            </div>

            <div
              id="panel-upload"
              role="tabpanel"
              aria-labelledby="tab-upload"
              hidden={tab !== 'upload'}
              className="ds-panel-body"
            >
              <FileUploadZone file={file} onFile={setFile} />
            </div>

            <div
              id="panel-paste"
              role="tabpanel"
              aria-labelledby="tab-paste"
              hidden={tab !== 'paste'}
              className="ds-panel-body"
            >
              <TextPasteEditor value={text} onChange={setText} />
            </div>
          </section>

          <section className="ds-panel card" aria-label="Draft intent">
            <div className="ds-panel-header">
              <h2 className="ds-panel-title">Intent</h2>
            </div>
            <div className="ds-panel-body">
              <IntentForm values={intent} onChange={setIntent} />
            </div>
          </section>
        </div>

        {submitError && (
          <p className="form-error ds-error" role="alert">{submitError}</p>
        )}

        <div className="ds-footer">
          <div className="ds-footer-hints">
            {!hasContent && (
              <span className="ds-hint">Add content to enable submission</span>
            )}
            {hasContent && intent.mustSay.length === 0 && (
              <span className="ds-hint">Add at least one must-say point</span>
            )}
          </div>
          <button
            type="submit"
            id="ds-submit"
            className="btn btn-primary ds-submit-btn"
            disabled={!canSubmit}
            aria-busy={submitting}
          >
            {submitting ? (
              <><span className="spinner" aria-hidden="true" /> Submitting…</>
            ) : 'Run Preflight Check'}
          </button>
        </div>
      </form>
    </AppLayout>
  );
}
