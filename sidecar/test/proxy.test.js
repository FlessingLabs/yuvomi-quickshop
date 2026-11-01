import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openStore } from '../src/store.js';
import { createServer, PREFIX } from '../src/server.js';
import { createPassThrough } from '../src/proxy.js';

let yuvomi;
let front;
let base;

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

before(async () => {
  // Yuvomi-Attrappe: spiegelt, was ankommt.
  yuvomi = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    res.writeHead(req.url === '/missing' ? 404 : 200, {
      'content-type': 'application/json',
      'set-cookie': ['yuvomi.sid=abc; Path=/; HttpOnly', 'csrf-token=xyz; Path=/'],
    });
    res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() }));
  });
  const yPort = await listen(yuvomi);
  front = createServer({
    store: openStore(':memory:'),
    resolveAuth: async () => null,
    passThrough: createPassThrough(`http://127.0.0.1:${yPort}`, { log: { error() {} } }),
    log: { error() {} },
  });
  base = `http://127.0.0.1:${await listen(front)}`;
});

after(() => {
  front.close();
  yuvomi.close();
});

test('everything outside the prefix reaches Yuvomi unchanged', async () => {
  const res = await fetch(`${base}/api/v1/shopping/1/items?x=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'yuvomi.sid=abc', 'x-csrf-token': 't' },
    body: '{"name":"Milch"}',
  });
  assert.equal(res.status, 200);
  const seen = await res.json();
  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, '/api/v1/shopping/1/items?x=1');
  assert.equal(seen.body, '{"name":"Milch"}');
  assert.equal(seen.headers.cookie, 'yuvomi.sid=abc');
  assert.equal(seen.headers['x-csrf-token'], 't');
  assert.equal(seen.headers.host, new URL(base).host, 'browser host is kept');
  assert.equal(seen.headers['x-forwarded-proto'], 'http');
  assert.match(seen.headers['x-forwarded-for'], /127\.0\.0\.1/);
  assert.deepEqual(res.headers.getSetCookie(), ['yuvomi.sid=abc; Path=/; HttpOnly', 'csrf-token=xyz; Path=/']);
});

test('status codes from Yuvomi are passed through', async () => {
  assert.equal((await fetch(`${base}/missing`)).status, 404);
});

test('the own prefix is answered by QuickShop, not Yuvomi', async () => {
  const res = await fetch(`${base}${PREFIX}/health`);
  assert.deepEqual(await res.json(), { data: { ok: true } });
  const items = await fetch(`${base}${PREFIX}/items`);
  assert.equal(items.status, 401, 'no session -> QuickShop answers 401 itself');
});

test('an unreachable Yuvomi gives 502, not a hang', async () => {
  const dead = createServer({
    store: openStore(':memory:'),
    resolveAuth: async () => null,
    passThrough: createPassThrough('http://127.0.0.1:1', { log: { error() {} } }),
  });
  const port = await listen(dead);
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 502);
  dead.close();
});
