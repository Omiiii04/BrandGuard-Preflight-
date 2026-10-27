import api from './client';

export const getRuleInsights = () =>
  api.get('/v1/insights/rules');

export const getMistakeInsights = () =>
  api.get('/v1/insights/mistakes');

export const getTimeToApproval = () =>
  api.get('/v1/insights/time-to-approval');
