const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://192.168.70.250:8000';

export const apiFetch = (path, options = {}) =>
  fetch(`${API_BASE_URL}${path}`, { credentials: 'include', ...options });

export { API_BASE_URL };
