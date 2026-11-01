/**
 * QuickShop - HTTP-Dienst unter /api/extensions/flessinglabs-quickshop
 *
 * Der Pfad ist durch Yuvomi vorgegeben (capabilities.api.prefix). Jede
 * schreibende Anfrage muss vier Pruefungen bestehen (MODULES.md):
 *   1. gueltige Yuvomi-Session (auth.js)
 *   2. Origin passt zum oeffentlichen Host
 *   3. eigenes Double-Submit-CSRF-Paar (Cookie + Header)
 *   4. Recht `ext:flessinglabs-quickshop` = write
 *
 * Bewusst ohne Framework und ohne npm-Abhaengigkeiten: sieben Routen, und
 * jede Abhaengigkeit waere eine weitere, die ein Haushalt aktuell halten muss.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { MODULE_ID, readCookie } from './auth.js';

export const PREFIX = `/api/extensions/${MODULE_ID}`;
export const CSRF_COOKIE = 'quickshop-csrf';
export const CSRF_HEADER = 'x-quickshop-csrf';
const MAX_BODY = 16 * 1024;

class HttpError extends Error {
  constructor(status, message, reason) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

function send(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function sendError(res, err) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  const body = { error: status >= 500 && !err.reason ? 'Internal server error.' : err.message, code: status };
  if (err.reason) body.reason = err.reason;
  send(res, status, body);
}

async function readJson(req) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json.', 'unsupported_media_type');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request body too large.', 'body_too_large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return body;
  } catch {
    throw new HttpError(400, 'Body must be a JSON object.', 'invalid_json');
  }
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

/**
 * Die Origins, die als "dieselbe Seite" gelten. Mit PUBLIC_ORIGIN fest
 * eingestellt; sonst aus dem Host, den der Proxy weiterreicht - der Browser
 * hat genau diesen Host aufgerufen, und ein fremder Origin passt nicht dazu.
 */
function expectedOrigins(req, publicOrigins) {
  if (publicOrigins.length) return publicOrigins;
  const host = req.headers['x-forwarded-host']?.split(',')[0].trim() || req.headers.host;
  if (!host) return [];
  const proto = req.headers['x-forwarded-proto']?.split(',')[0].trim() || 'http';
  return [`${proto}://${host}`];
}

function isSecure(req) {
  return (req.headers['x-forwarded-proto']?.split(',')[0].trim() || '') === 'https';
}

function parseId(raw) {
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) throw new HttpError(404, 'Item not found.', 'item_not_found');
  return Number(raw);
}

export function createApp({ store, resolveAuth, publicOrigins = [], log = console }) {
  const origins = publicOrigins.map((o) => o.replace(/\/+$/, ''));

  async function requireUser(req, need) {
    const user = await resolveAuth(req);
    if (!user) throw new HttpError(401, 'Authentication required.', 'unauthenticated');
    if (user.access === 'none') throw new HttpError(403, 'No access to QuickShop.', 'forbidden');
    if (need === 'write' && user.access !== 'write') throw new HttpError(403, 'QuickShop is read-only for you.', 'read_only');
    return user;
  }

  function requireSameOriginAndCsrf(req) {
    const origin = req.headers.origin;
    if (!origin || !expectedOrigins(req, origins).includes(origin)) {
      throw new HttpError(403, 'Origin not allowed.', 'origin_mismatch');
    }
    const cookie = readCookie(req.headers.cookie, CSRF_COOKIE);
    const header = req.headers[CSRF_HEADER];
    if (!cookie || !header || !safeEqual(cookie, header)) {
      throw new HttpError(403, 'Invalid CSRF token.', 'csrf_invalid');
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    let pathname = url.pathname;
    if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) {
      throw new HttpError(404, 'Not found.', 'not_found');
    }
    pathname = pathname.slice(PREFIX.length).replace(/\/+$/, '') || '/';
    const method = req.method;

    if (pathname === '/health' && method === 'GET') return send(res, 200, { data: { ok: true } });

    if (pathname === '/me' && method === 'GET') {
      const user = await requireUser(req, 'read');
      return send(res, 200, { data: { user_id: user.userId, access: user.access } });
    }

    if (pathname === '/csrf' && method === 'GET') {
      await requireUser(req, 'read');
      const token = crypto.randomBytes(32).toString('base64url');
      const cookie = [
        `${CSRF_COOKIE}=${token}`, `Path=${PREFIX}`, 'HttpOnly', 'SameSite=Strict',
        ...(isSecure(req) ? ['Secure'] : []),
      ].join('; ');
      return send(res, 200, { data: { token } }, { 'set-cookie': cookie });
    }

    if (pathname === '/items') {
      if (method === 'GET') {
        await requireUser(req, 'read');
        return send(res, 200, { data: store.list({ q: url.searchParams.get('q') ?? '' }) });
      }
      if (method === 'POST') {
        requireSameOriginAndCsrf(req);
        const user = await requireUser(req, 'write');
        const body = await readJson(req);
        return send(res, 201, { data: store.create(body, { userId: user.userId }) });
      }
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed');
    }

    const m = pathname.match(/^\/items\/([^/]+)$/);
    if (m) {
      if (method === 'GET') {
        await requireUser(req, 'read');
        const item = store.get(parseId(m[1]));
        if (!item) throw new HttpError(404, 'Item not found.', 'item_not_found');
        return send(res, 200, { data: item });
      }
      if (method === 'PATCH') {
        requireSameOriginAndCsrf(req);
        await requireUser(req, 'write');
        const id = parseId(m[1]);
        const body = await readJson(req);
        const item = store.update(id, body);
        if (!item) throw new HttpError(404, 'Item not found.', 'item_not_found');
        return send(res, 200, { data: item });
      }
      if (method === 'DELETE') {
        requireSameOriginAndCsrf(req);
        await requireUser(req, 'write');
        const id = parseId(m[1]);
        if (!store.remove(id)) throw new HttpError(404, 'Item not found.', 'item_not_found');
        return send(res, 200, { data: { id, deleted: true } });
      }
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed');
    }

    throw new HttpError(404, 'Not found.', 'not_found');
  }

  return function app(req, res) {
    handle(req, res).catch((err) => {
      if (!err.status || err.status >= 500) log.error(`[quickshop] ${req.method} ${req.url}:`, err);
      if (!res.headersSent) sendError(res, err);
      else res.destroy();
    });
  };
}

export function createServer(options) {
  return http.createServer(createApp(options));
}
