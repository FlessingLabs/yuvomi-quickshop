import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openStore } from '../src/store.js';
import { createAuthResolver, PERMISSION_KEY } from '../src/auth.js';
import { createServer, PREFIX } from '../src/server.js';

// Eine Yuvomi-Attrappe: /api/v1/auth/me nach Session-Cookie.
const SESSIONS = {
  writer: { user: { id: 1 }, permissions: { modules: { [PERMISSION_KEY]: 'write', shopping: 'write' } } },
  reader: { user: { id: 2 }, permissions: { modules: { [PERMISSION_KEY]: 'read' } } },
  blocked: { user: { id: 3 }, permissions: { modules: { [PERMISSION_KEY]: 'none' } } },
  disabled: { user: { id: 4 }, permissions: { modules: { shopping: 'write' } } },
};
let meCalls = 0;
let yuvomi;
let sidecar;
let base;
let origin;

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

before(async () => {
  yuvomi = http.createServer((req, res) => {
    meCalls++;
    const sid = /yuvomi\.sid=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (req.url !== '/api/v1/auth/me' || !SESSIONS[sid]) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end('{"error":"no"}');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(SESSIONS[sid]));
  });
  const yPort = await listen(yuvomi);

  const store = openStore(':memory:');
  const resolveAuth = createAuthResolver({ yuvomiUrl: `http://127.0.0.1:${yPort}`, cacheMs: 60_000 });
  sidecar = createServer({ store, resolveAuth, log: { error() {} } });
  const port = await listen(sidecar);
  base = `http://127.0.0.1:${port}${PREFIX}`;
  origin = `http://127.0.0.1:${port}`;
});

after(() => {
  sidecar.close();
  yuvomi.close();
});

async function call(path, { session = 'writer', method = 'GET', body, csrf, headers = {} } = {}) {
  const h = { ...(method !== 'GET' ? { origin } : {}), ...headers };
  const cookies = [];
  if (session) cookies.push(`yuvomi.sid=${session}`);
  if (csrf) {
    cookies.push(`quickshop-csrf=${csrf}`);
    h['x-quickshop-csrf'] = csrf;
  }
  if (cookies.length) h.cookie = cookies.join('; ');
  for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

async function csrfFor(session = 'writer') {
  const r = await call('/csrf', { session });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /quickshop-csrf=.+; Path=\/api\/extensions\/flessinglabs-quickshop; HttpOnly; SameSite=Strict/);
  return r.body.data.token;
}

test('health needs no session', async () => {
  const r = await call('/health', { session: null });
  assert.equal(r.status, 200);
});

test('no session -> 401', async () => {
  const r = await call('/items', { session: null });
  assert.equal(r.status, 401);
  assert.equal(r.body.reason, 'unauthenticated');
});

test('unknown session -> 401', async () => {
  assert.equal((await call('/items', { session: 'nobody' })).status, 401);
});

test('permission none and missing permission (module disabled) -> 403', async () => {
  assert.equal((await call('/items', { session: 'blocked' })).status, 403);
  assert.equal((await call('/items', { session: 'disabled' })).status, 403);
});

test('/me reports the access level', async () => {
  assert.deepEqual((await call('/me')).body.data, { user_id: 1, access: 'write' });
  assert.deepEqual((await call('/me', { session: 'reader' })).body.data, { user_id: 2, access: 'read' });
});

test('full CRUD round trip', async () => {
  const csrf = await csrfFor();
  const created = await call('/items', { method: 'POST', csrf, body: { name: 'Milch', default_quantity: 2, price_cents: 119, created_by: 999 } });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.name, 'Milch');
  assert.equal(created.body.data.created_by, 1, 'user id comes from Yuvomi, never from the body');
  const id = created.body.data.id;

  const dup = await call('/items', { method: 'POST', csrf, body: { name: 'milch' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.reason, 'item_exists');

  const listed = await call('/items?q=mil');
  assert.equal(listed.body.data.length, 1);

  const patched = await call(`/items/${id}`, { method: 'PATCH', csrf, body: { default_quantity: 3 } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.default_quantity, 3);
  assert.equal(patched.body.data.price_cents, 119);

  assert.equal((await call(`/items/${id}`)).body.data.default_quantity, 3);

  const removed = await call(`/items/${id}`, { method: 'DELETE', csrf });
  assert.deepEqual(removed.body.data, { id, deleted: true });
  assert.equal((await call(`/items/${id}`, { method: 'DELETE', csrf })).status, 404);
});

test('validation errors are 400 with a reason', async () => {
  const csrf = await csrfFor();
  const r = await call('/items', { method: 'POST', csrf, body: { name: '' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.reason, 'name_required');
  assert.equal((await call('/items/abc', { method: 'PATCH', csrf, body: {} })).status, 404);
});

test('reader may read but not write', async () => {
  const csrf = await csrfFor('reader');
  assert.equal((await call('/items', { session: 'reader' })).status, 200);
  const r = await call('/items', { session: 'reader', method: 'POST', csrf, body: { name: 'X' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.reason, 'read_only');
});

test('writes without CSRF pair are refused', async () => {
  const noToken = await call('/items', { method: 'POST', body: { name: 'X' } });
  assert.equal(noToken.status, 403);
  assert.equal(noToken.body.reason, 'csrf_invalid');

  const r = await fetch(`${base}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie: 'yuvomi.sid=writer; quickshop-csrf=aaa', 'x-quickshop-csrf': 'bbb' },
    body: '{"name":"X"}',
  });
  assert.equal(r.status, 403);
});

test('writes from a foreign origin are refused', async () => {
  const csrf = await csrfFor();
  const r = await call('/items', { method: 'POST', csrf, body: { name: 'X' }, headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.reason, 'origin_mismatch');
  const none = await call('/items', { method: 'POST', csrf, body: { name: 'X' }, headers: { origin: undefined } });
  assert.equal(none.status, 403);
});

test('writes need a JSON body', async () => {
  const csrf = await csrfFor();
  const r = await fetch(`${base}/items`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin, cookie: `yuvomi.sid=writer; quickshop-csrf=${csrf}`, 'x-quickshop-csrf': csrf },
    body: 'name=X',
  });
  assert.equal(r.status, 415);
});

test('paths outside the prefix are 404', async () => {
  const r = await fetch(base.replace(PREFIX, '/api/v1/tasks'));
  assert.equal(r.status, 404);
});

test('auth answers are cached per session', async () => {
  const before = meCalls;
  await call('/items');
  await call('/items');
  assert.equal(meCalls, before, 'writer was already resolved earlier in this file');
});
