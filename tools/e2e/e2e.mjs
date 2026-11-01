// Abnahmelauf gegen ein ECHTES Yuvomi hinter dem Dev-Proxy.
// Aufruf: node e2e.mjs <proxyPort> <moduleDir> [phase]
//   phase "setup"   : Admin anlegen, Modul pruefen, Katalog fuellen, Einkaufsliste bespielen
//   phase "persist" : nach Sidecar-Neustart pruefen, dass der Katalog noch da ist
import assert from 'node:assert/strict';
import path from 'node:path';

const [, , proxyPort, moduleDir, phase = 'setup'] = process.argv;
const ORIGIN = `http://127.0.0.1:${proxyPort}`;
const { addToShoppingList } = await import(path.join(moduleDir, 'lib/add-to-list.js'));
const { createCatalogClient } = await import(path.join(moduleDir, 'lib/catalog-api.js'));

const jar = new Map();
function remember(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function raw(url, init = {}) {
  const res = await fetch(ORIGIN + url, {
    ...init,
    headers: { ...(init.headers || {}), cookie: cookieHeader(), origin: ORIGIN },
    redirect: 'manual',
  });
  remember(res);
  return res;
}

// Yuvomi-API wie /api.js: /api/v1-Prefix, CSRF-Header, wirft bei !ok mit .status
async function yv(method, p, body) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = jar.get('csrf-token') ?? '';
  const res = await raw(`/api/v1${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(data)}`), { status: res.status, data });
  return data;
}
const api = {
  get: (p) => yv('GET', p),
  post: (p, b) => yv('POST', p, b),
  patch: (p, b) => yv('PATCH', p, b),
  delete: (p) => yv('DELETE', p),
};
const catalog = createCatalogClient({
  fetchImpl: async (url, init) => {
    const res = await raw(url, init);
    return res;
  },
});

async function login() {
  const res = await raw('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'quickshop-test-pw' }),
  });
  assert.equal(res.status, 200, `login: ${await res.text()}`);
  await api.get('/auth/me'); // setzt csrf-token
}

if (phase === 'setup') {
  const setup = await raw('/api/v1/auth/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', display_name: 'Admin', password: 'quickshop-test-pw', language: 'de' }),
  });
  console.log('setup', setup.status);
  await login();

  // 1. Modul geladen?
  const mods = await api.get('/modules?admin=1');
  const mine = mods.data.find((m) => m.id === 'flessinglabs-quickshop');
  assert.ok(mine, 'module listed');
  console.log('module:', JSON.stringify({ id: mine.id, enabled: mine.enabled, status: mine.status, error: mine.error ?? null, version: mine.version }));
  assert.ok(!mine.error, `module error: ${mine.error}`);
  const asset = await raw('/api/v1/modules/assets/flessinglabs-quickshop/index.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  for (const f of ['lib/add-to-list.js', 'lib/catalog-api.js', 'lib/price.js', 'style.css']) {
    assert.equal((await raw(`/api/v1/modules/assets/flessinglabs-quickshop/${f}`)).status, 200, f);
  }
  const me = await api.get('/auth/me');
  console.log('permission ext:', me.permissions.modules['ext:flessinglabs-quickshop'], 'shopping:', me.permissions.modules.shopping);

  // 2. Katalog
  assert.deepEqual(await catalog.me(), { user_id: me.user.id, access: 'write' });
  const milk = await catalog.create({ name: 'Milch', default_quantity: 2, price_cents: 119 });
  const bread = await catalog.create({ name: 'Vollkornbrot' });
  const edited = await catalog.update(bread.id, { default_quantity: 1, price_cents: 349, name: 'Vollkornbrot' });
  assert.equal(edited.price_cents, 349);
  const temp = await catalog.create({ name: 'Wegwerfartikel' });
  await catalog.remove(temp.id);
  console.log('catalog:', (await catalog.list()).map((i) => `${i.name}×${i.default_quantity}`).join(', '));

  // 3. Einkaufsliste (echte Yuvomi-API)
  let lists = (await api.get('/shopping')).data;
  if (!lists.length) lists = [(await api.post('/shopping', { name: 'Wocheneinkauf' })).data];
  const listId = lists.find((l) => l.accepts_new_items)?.id ?? lists[0].id;
  console.log('lists:', lists.map((l) => `${l.id}:${l.name}`).join(', '), '-> using', listId);

  const r1 = await addToShoppingList(api, listId, milk);
  const r2 = await addToShoppingList(api, listId, bread);
  const r3 = await addToShoppingList(api, listId, milk);
  console.log('actions:', r1.action, r2.action, r3.action);
  assert.deepEqual([r1.action, r2.action, r3.action], ['added', 'added', 'increased']);
  let items = (await api.get(`/shopping/${listId}/items`)).data;
  const milkRows = items.filter((i) => i.name === 'Milch');
  assert.equal(milkRows.length, 1, 'no duplicate row');
  assert.equal(milkRows[0].quantity, '4');

  // abhaken -> erneut hinzufuegen -> wieder offen mit Standardanzahl
  await api.patch(`/shopping/items/${milkRows[0].id}`, { is_checked: true });
  const r4 = await addToShoppingList(api, listId, milk);
  assert.equal(r4.action, 'reopened');
  items = (await api.get(`/shopping/${listId}/items`)).data;
  assert.equal(items.find((i) => i.name === 'Milch').quantity, '2');
  assert.equal(items.find((i) => i.name === 'Milch').is_checked, 0);

  // Rueckgaengig
  await r4.undo();
  items = (await api.get(`/shopping/${listId}/items`)).data;
  assert.equal(items.find((i) => i.name === 'Milch').is_checked, 1);
  assert.equal(items.find((i) => i.name === 'Milch').quantity, '4');

  // Freitextmenge bleibt unangetastet
  await api.patch(`/shopping/items/${items.find((i) => i.name === 'Vollkornbrot').id}`, { quantity: '1 Laib' });
  assert.equal((await addToShoppingList(api, listId, bread)).action, 'already');

  // Katalog unveraendert
  assert.deepEqual(await catalog.list(), [milk, edited].sort((a, b) => a.name.localeCompare(b.name)));
  console.log('list now:', (await api.get(`/shopping/${listId}/items`)).data.map((i) => `${i.name}[${i.quantity}${i.is_checked ? ',✓' : ''}]`).join(', '));

  // 4. Andere Module unberuehrt
  for (const p of ['/tasks', '/calendar?start=2026-11-01&end=2026-11-30', '/notes', '/pantry', '/dashboard']) {
    const res = await raw(`/api/v1${p}`);
    console.log('core', p, res.status);
    assert.ok(res.status < 400, p);
  }
  console.log('E2E setup phase OK');
}

if (phase === 'persist') {
  await login();
  const names = (await catalog.list()).map((i) => i.name);
  console.log('after sidecar restart:', names.join(', '));
  assert.deepEqual(names, ['Milch', 'Vollkornbrot']);
  console.log('E2E persist phase OK');
}

if (phase === 'denied') {
  await login();
  try {
    await catalog.list();
    assert.fail('expected 403');
  } catch (err) {
    console.log('disabled module ->', err.status, err.reason);
    assert.equal(err.status, 403);
  }
  console.log('E2E denied phase OK');
}
