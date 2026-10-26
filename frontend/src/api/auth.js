import api from './client';

export const login = (email, password) =>
  api.post('/v1/auth/login', { email, password });

export const getMe = () =>
  api.get('/v1/auth/me');
