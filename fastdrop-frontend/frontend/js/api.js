// FastDrop API client.
// Change API_BASE if the backend runs on a different host/port.
const API_BASE = window.FASTDROP_API_BASE || 'http://localhost:4000/api';

async function apiRequest(path, { method = 'GET', body, isForm = false } = {}) {
  const opts = {
    method,
    credentials: 'include',
    headers: {},
  };
  if (body !== undefined) {
    if (isForm) {
      opts.body = body; // FormData - browser sets content-type
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, opts);
  } catch (err) {
    throw new Error('تعذر الاتصال بالسيرفر. تأكد أن الـ Backend يعمل على ' + API_BASE);
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* no body */
  }
  if (!res.ok) {
    const message = (data && data.error) || `خطأ (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

const api = {
  get: (path) => apiRequest(path),
  post: (path, body) => apiRequest(path, { method: 'POST', body }),
  patch: (path, body) => apiRequest(path, { method: 'PATCH', body }),
  del: (path) => apiRequest(path, { method: 'DELETE' }),
  upload: (path, formData) => apiRequest(path, { method: 'POST', body: formData, isForm: true }),
};

function uploadedUrl(path) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return API_BASE.replace(/\/api$/, '') + path;
}
