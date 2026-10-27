import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout';
import PassportDetails from '../components/passport/PassportDetails';
import TamperCheck from '../components/passport/TamperCheck';
import { getPassportByDraft, getVersions } from '../api/passport';
import './PassportPage.css';

const MOCK_PASSPORT = {
  _id: 'pp-mock-1',
  assetName: 'Campaign Draft — Oct 2025',
  draftId: 'draft-mock-1',
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  rulesVersion: '2.4.1',
  aiUsed: true,
  contentHash: 'a3f8b2c1d9e47f6b8a0c2d5e9f1b3a7c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4',
  checksRun: [
    'Banned term detection',
    'Unqualified superlative check',
    'NLI entailment against uploaded sources',
    'Claim shelf-life verification',
    'Alt-text absence check',
    'Entity watch-list scan',
  ],
  approvers: [
    { name: 'Priya Mehta', role: 'manager' },
  ],
};

const USE_MOCK = import.meta.env.VITE_USE_MOCK_FINDINGS === 'true';

export default function PassportPage() {
  const { draftId } = useParams();
  const [passport, setPassport] = useState(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setFetchError('');
      try {
        if (USE_MOCK) {
          await new Promise((r) => setTimeout(r, 500));
          setPassport(MOCK_PASSPORT);
          setContent('We offer a 30-day returns policy, giving customers peace of mind. Our 30-day return window is designed to be fair and hassle-free. Returns are processed free of charge with no hidden fees.');
        } else {
          const [ppRes, vRes] = await Promise.all([
            getPassportByDraft(draftId),
            getVersions(draftId),
          ]);
          setPassport(ppRes.data);
          const latest = vRes.data?.[vRes.data.length - 1];
          setContent(latest?.content ?? '');
        }
      } catch {
        setFetchError('Failed to load passport. Please refresh.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [draftId]);

  return (
    <AppLayout pageTitle="Brand Passport">
      {fetchError && (
        <div className="pp-error" role="alert">{fetchError}</div>
      )}

      {loading ? (
        <div className="loading-state pp-loading">
          <span className="spinner" aria-hidden="true" />
          <span>Loading passport…</span>
        </div>
      ) : (
        <div className="pp-card card">
          <PassportDetails passport={passport} />

          <div className="pp-divider" />

          <section className="pp-tamper-section">
            <h2 className="pp-section-heading">Integrity Check</h2>
            <TamperCheck
              storedHash={passport?.contentHash}
              currentContent={content}
            />
          </section>
        </div>
      )}
    </AppLayout>
  );
}
