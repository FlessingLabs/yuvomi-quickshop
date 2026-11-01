import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogClient, CatalogError } from '../../module/lib/catalog-api.js';

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body } = await handler(url, init, calls.length);
    return { ok: status < 400, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('writes fetch a CSRF token first and send it as header', async () => {
  const f = fakeFetch((url) => (url.endsWith('/csrf')
    ? { body: { data: { token: 'tok' } } }
    : { status: 201, body: { data: { id: 1, name: 'Milch' } } }));
  const c = createCatalogClient({ fetchImpl: f });
  const item = await c.create({ name: 'Milch' });
  assert.equal(item.id, 1);
  assert.equal(f.calls[0].url, '/api/extensions/flessinglabs-quickshop/csrf');
  assert.equal(f.calls[1].init.headers['X-QuickShop-CSRF'], 'tok');
  assert.equal(f.calls[1].init.credentials, 'same-origin');
});

test('a rejected CSRF token is renewed once', async () => {
  let n = 0;
  const f = fakeFetch((url) => {
    if (url.endsWith('/csrf')) return { body: { data: { token: `t${++n}` } } };
    return n < 2 ? { status: 403, body: { reason: 'csrf_invalid' } } : { body: { data: { id: 1, deleted: true } } };
  });
  const c = createCatalogClient({ fetchImpl: f });
  assert.deepEqual(await c.remove(1), { id: 1, deleted: true });
});

test('errors carry status and reason; network failure is "unreachable"', async () => {
  const c = createCatalogClient({ fetchImpl: fakeFetch(() => ({ status: 409, body: { error: 'exists', reason: 'item_exists' } })) });
  await assert.rejects(c.list(), (e) => e instanceof CatalogError && e.status === 409 && e.reason === 'item_exists');

  const down = createCatalogClient({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(down.list(), { reason: 'unreachable' });

  const proxy = createCatalogClient({ fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } }) });
  await assert.rejects(proxy.list(), { reason: 'unreachable' });
});
