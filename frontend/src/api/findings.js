import api from './client';

export const getFindings = (draftId) =>
  api.get(`/v1/drafts/${draftId}/findings`);

export const getDraft = (draftId) =>
  api.get(`/v1/drafts/${draftId}`);

export const patchFinding = (findingId, payload) =>
  api.patch(`/v1/findings/${findingId}`, payload);
