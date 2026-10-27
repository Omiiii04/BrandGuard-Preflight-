import api from './client';

export const getVersions = (draftId) =>
  api.get(`/v1/drafts/${draftId}/versions`);

export const getPassport = (passportId) =>
  api.get(`/v1/passports/${passportId}`);

export const getPassportByDraft = (draftId) =>
  api.get(`/v1/drafts/${draftId}/passport`);
