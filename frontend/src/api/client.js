const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://192.168.70.250:8000';

// CSRF 토큰: 앱 시작 시 /api/csrf/ 에서 받고, 로그인 응답으로 갱신한다.
let csrfToken = null;
export const setCsrfToken = (token) => { if (token) csrfToken = token; };

export const loadCsrfToken = () =>
  fetch(`${API_BASE_URL}/api/csrf/`, { credentials: 'include' })
    .then(res => res.json())
    .then(data => setCsrfToken(data.csrf_token))
    .catch(() => {});

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export const apiFetch = (path, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (!SAFE_METHODS.includes(method) && csrfToken) headers['X-CSRFToken'] = csrfToken;
  return fetch(`${API_BASE_URL}${path}`, { credentials: 'include', ...options, headers });
};

// JSON 응답을 돌려주고, 실패하면 서버가 보낸 오류 문구로 Error를 던진다.
export const apiJson = async (path, options = {}) => {
  const res = await apiFetch(path, options);
  let data = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) {
    const fallback = res.status === 403
      ? '보안 토큰이 만료되었습니다. 새로고침 후 다시 시도해 주세요.'
      : `서버 오류 (${res.status})`;
    throw new Error(data?.error || fallback);
  }
  return data;
};

export const jsonBody = (method, payload) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

export { API_BASE_URL };
