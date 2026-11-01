/**
 * QuickShop - Client fuer den Katalogdienst (Sidecar)
 *
 * Yuvomis `/api.js` haengt `/api/v1` vor jeden Pfad und schickt Yuvomis
 * CSRF-Token - beides passt nicht zum Sidecar. Dieser Client spricht deshalb
 * selbst mit `/api/extensions/flessinglabs-quickshop`: same-origin, also mit dem
 * Session-Cookie, und mit dem eigenen CSRF-Paar des Dienstes.
 */

export const CATALOG_BASE = '/api/extensions/flessinglabs-quickshop';
export const CSRF_HEADER = 'X-QuickShop-CSRF';

export class CatalogError extends Error {
  constructor(message, status, reason = null) {
    super(message);
    this.name = 'CatalogError';
    this.status = status;
    this.reason = reason;
  }
}

export function createCatalogClient({ base = CATALOG_BASE, fetchImpl = (...a) => fetch(...a) } = {}) {
  let csrfToken = '';

  async function request(path, { method = 'GET', body, signal } = {}, retried = false) {
    const write = method !== 'GET';
    if (write && !csrfToken) await refreshCsrf(signal);

    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(write ? { [CSRF_HEADER]: csrfToken } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new CatalogError('QuickShop service unreachable.', 0, 'unreachable');
    }

    let data = null;
    try { data = await res.json(); } catch { /* z. B. 502 vom Proxy mit HTML */ }

    if (!res.ok) {
      // Token abgelaufen oder Cookie verworfen (iOS-PWA): einmal neu holen.
      if (res.status === 403 && data?.reason === 'csrf_invalid' && !retried) {
        csrfToken = '';
        return request(path, { method, body, signal }, true);
      }
      const reason = data?.reason ?? (res.status >= 502 ? 'unreachable' : null);
      throw new CatalogError(data?.error || `HTTP ${res.status}`, res.status, reason);
    }
    return data;
  }

  async function refreshCsrf(signal) {
    const res = await request('/csrf', { signal });
    csrfToken = res.data.token;
  }

  return {
    me: (opts) => request('/me', opts).then((r) => r.data),
    list: (opts) => request('/items', opts).then((r) => r.data),
    create: (item) => request('/items', { method: 'POST', body: item }).then((r) => r.data),
    update: (id, patch) => request(`/items/${id}`, { method: 'PATCH', body: patch }).then((r) => r.data),
    remove: (id) => request(`/items/${id}`, { method: 'DELETE' }).then((r) => r.data),
  };
}
