import api from './client';

export const createDraft = (formData) =>
  api.post('/v1/drafts', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

export const submitDraftForReview = (draftId) =>
  api.post(`/v1/drafts/${draftId}/review`);
