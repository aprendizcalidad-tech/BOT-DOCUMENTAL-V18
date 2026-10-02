let backendUrl = '';
let appToken = '';

export function setCloudConfig({backendUrl: url = '', appToken: token = ''} = {}) {
  backendUrl = String(url || '').trim().replace(/\/+$/, '');
  appToken = String(token || '').trim();
}

export function getCloudConfig() {
  return { backendUrl, hasAppToken: !!appToken };
}

function endpoint(path) {
  if (!backendUrl) throw new Error('Configura la URL del backend Cloudflare Worker.');
  if (!/^https:\/\//i.test(backendUrl) && !/^http:\/\/localhost(?::\d+)?$/i.test(backendUrl)) {
    throw new Error('La URL del backend debe usar HTTPS.');
  }
  return backendUrl + (path.startsWith('/') ? path : '/' + path);
}

async function parseError(response) {
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try {
      const data = await response.json();
      return data?.error?.message || data?.error || data?.message || `Backend ${response.status}`;
    } catch {}
  }
  const text = await response.text().catch(() => '');
  return text.slice(0, 500) || `Backend ${response.status}`;
}

function headers(extra = {}) {
  const h = new Headers(extra);
  if (appToken) h.set('X-App-Token', appToken);
  return h;
}

async function request(path, options = {}, retries = 4) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(endpoint(path), {
        ...options,
        headers: headers(options.headers || {}),
        signal: options.signal || AbortSignal.timeout(3_600_000)
      });
      if (response.ok) return response;
      const message = await parseError(response);
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === retries) {
        const error = new Error(message);
        error.noRetry = true;
        throw error;
      }
      last = new Error(message);
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      const waitMs = Math.max(retryAfter * 1000, Math.min(30_000, 1_500 * 2 ** attempt));
      await new Promise(resolve => setTimeout(resolve, waitMs));
    } catch (error) {
      if (error?.noRetry || error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
      last = error;
      if (attempt === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(20_000, 1_000 * 2 ** attempt)));
    }
  }
  throw last || new Error('No se pudo contactar el backend.');
}

export async function cloudJSON(path, body, options = {}) {
  const response = await request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? options.headers : {'Content-Type':'application/json', ...(options.headers || {})},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options.signal
  }, options.retries ?? 4);
  const data = await response.json();
  if (data?.ok === false) throw new Error(data.error || 'Error del backend.');
  return data;
}

export async function cloudRaw(path, body, extraHeaders = {}, options = {}) {
  return await request(path, {
    method: 'POST',
    headers: extraHeaders,
    body,
    signal: options.signal
  }, options.retries ?? 4);
}
 
