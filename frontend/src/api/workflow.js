import api from './client';

export const getComments = (draftId) =>
  api.get(`/v1/drafts/${draftId}/comments`);

export const postComment = (draftId, payload) =>
  api.post(`/v1/drafts/${draftId}/comments`, payload);

export const approveDraft = (draftId) =>
  api.post(`/v1/drafts/${draftId}/approve`);

export const requestChanges = (draftId, payload) =>
  api.post(`/v1/drafts/${draftId}/request-changes`, payload);

export const overrideFinding = (draftId, payload) =>
  api.post(`/v1/drafts/${draftId}/override`, payload);
