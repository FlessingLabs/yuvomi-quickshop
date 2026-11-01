/**
 * QuickShop - Identitaet und Rechte
 *
 * Der Browser ist kein vertrauenswuerdiger Aufrufer (MODULES.md, "Modules With A
 * Backend Service"): Wer jemand ist und was er darf, sagt allein Yuvomi auf
 * GET /api/v1/auth/me, gefragt mit dem Session-Cookie der Anfrage. Eine
 * Benutzer-Id oder Rolle aus dem Anfragekoerper wird nie gelesen.
 *
 * Die Antwort wird kurz zwischengespeichert, je Session-Cookie: Yuvomi begrenzt
 * /api/ auf 300 Anfragen je Minute und IP, und ohne Cache verbraucht der
 * Sidecar dieses Budget fuer alle Mitglieder zugleich. Wenige Sekunden reichen
 * und sind kurz genug, dass eine Abmeldung gleich wirkt.
 */

import crypto from 'node:crypto';

export const MODULE_ID = 'flessinglabs-quickshop';
export const PERMISSION_KEY = `ext:${MODULE_ID}`;

/** Liest ein Cookie aus dem Cookie-Header; null, wenn es fehlt. */
export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

/**
 * Zugriffsstufe aus der /auth/me-Antwort: 'none' | 'read' | 'write'.
 *
 * Fehlt der Schluessel, ist das Modul in Yuvomi nicht (mehr) registriert -
 * deaktiviert oder entfernt. Das ist 'none', nicht der Standard 'write': ein
 * abgeschaltetes Modul soll auch ueber seinen Dienst nichts mehr schreiben.
 */
export function accessLevel(me) {
  const level = me?.permissions?.modules?.[PERMISSION_KEY];
  return level === 'read' || level === 'write' ? level : 'none';
}

export function createAuthResolver({ yuvomiUrl, sessionCookie = 'yuvomi.sid', cacheMs = 5000, fetchImpl = fetch, now = Date.now }) {
  const cache = new Map();

  function prune(t) {
    if (cache.size < 500) return;
    for (const [k, v] of cache) if (v.expires <= t) cache.delete(k);
  }

  /**
   * @returns {Promise<{ userId: number, access: 'none'|'read'|'write' } | null>}
   *          null heisst: nicht angemeldet.
   */
  return async function resolve(req) {
    const sid = readCookie(req.headers.cookie, sessionCookie);
    if (!sid) return null;

    const key = crypto.createHash('sha256').update(sid).digest('hex');
    const t = now();
    const hit = cache.get(key);
    if (hit && hit.expires > t) return hit.value;

    const headers = { cookie: `${sessionCookie}=${sid}`, accept: 'application/json' };
    // Die Adresse des Mitglieds weiterreichen: steht Yuvomi mit TRUST_PROXY
    // hinter demselben Proxy, zaehlt das Ratenlimit dann je Mitglied.
    if (req.headers['x-forwarded-for']) headers['x-forwarded-for'] = req.headers['x-forwarded-for'];

    const res = await fetchImpl(new URL('/api/v1/auth/me', yuvomiUrl), { headers, redirect: 'manual' });
    let value = null;
    if (res.ok) {
      const me = await res.json();
      const userId = me?.user?.id;
      if (Number.isInteger(userId)) value = { userId, access: accessLevel(me) };
    } else if (res.status !== 401 && res.status !== 403) {
      const err = new Error(`Yuvomi /auth/me answered ${res.status}`);
      err.status = 502;
      err.reason = 'yuvomi_unavailable';
      throw err;
    }

    prune(t);
    cache.set(key, { value, expires: t + cacheMs });
    return value;
  };
}
