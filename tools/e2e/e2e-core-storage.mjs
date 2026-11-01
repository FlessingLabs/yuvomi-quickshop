#!/usr/bin/env node
/**
 * Abnahmetest QuickShop 2 gegen ein ECHTES Yuvomi mit Modulspeicher.
 *
 *   node tools/e2e/e2e-core-storage.mjs <phase> [--base URL] [--user U] [--password P]
 *
 * Phasen:
 *   setup     legt (falls noetig) den ersten Admin an und prueft den ganzen Ablauf:
 *             Modul geladen, Katalog-CRUD, Konflikt zweier Sitzungen, Rechte
 *             none/read/write, Einkaufsliste mit Doppel-Erkennung, Import, andere
 *             Bereiche unveraendert, keine Sidecar-Aufrufe.
 *   persist   nach einem Neustart: der Katalog aus `setup` ist noch da.
 *   readonly  nur lesend - fuer eine laufende Installation: Modul geladen,
 *             Katalog lesbar, keine Aenderung an irgendetwas.
 *   unsupported  gegen ein UNVERAENDERTES Yuvomi: QuickShop meldet
 *             `storage_unsupported` statt eines allgemeinen Fehlers.
 *
 * Standard: --base http://127.0.0.1:3000 --user admin --password quickshop-test-pw
 * Testdaten tragen das Praefix "E2E " und werden am Ende von `setup` geloescht,
 * ausser den zwei Artikeln, die `persist` wiederfinden soll.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = (f) => import(path.join(here, '../../module/lib', f));
const { createCatalogStore, parseImport, importItems, RECORDS } = await lib('catalog-store.js');
const { addToShoppingList } = await lib('add-to-list.js');

const args = process.argv.slice(2);
const phase = args[0] ?? 'setup';
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const BASE = opt('base', 'http://127.0.0.1:3000').replace(/\/+$/, '');
const USER = opt('user', 'admin');
const PASSWORD = opt('password', 'quickshop-test-pw');
const MODULE = 'flessinglabs-quickshop';

/** Eine Sitzung mit eigenem Cookie-Glas, verhaelt sich wie /api.js. */
function session(label) {
  const jar = new Map();
  const seen = [];
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  async function raw(p, init = {}) {
    const res = await fetch(BASE + p, { ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), cookie: cookie(), origin: BASE } });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  }
  async function call(method, p, body) {
    seen.push(`${method} ${p}`);
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = jar.get('csrf-token') ?? '';
    const res = await raw(`/api/v1${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(`${label}: ${method} ${p} -> ${res.status} ${JSON.stringify(data)}`), { status: res.status, data });
    return data;
  }
  const api = {
    get: (p) => call('GET', p), post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b), patch: (p, b) => call('PATCH', p, b), delete: (p) => call('DELETE', p),
  };
  return {
    api, raw, seen,
    async login(user, password) {
      const res = await raw('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password }) });
      assert.equal(res.status, 200, `${label}: login ${user} -> ${res.status} ${await res.text()}`);
      await api.get('/auth/me');
      return this;
    },
  };
}

async function ensureAdmin() {
  const res = await fetch(`${BASE}/api/v1/auth/setup`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, display_name: 'E2E Admin', password: PASSWORD, language: 'de' }),
  });
  console.log('setup admin:', res.status, res.status === 201 ? '(new instance)' : '(existing instance)');
}

async function checkModuleLoaded(admin) {
  const mods = await admin.api.get('/modules?admin=1');
  const m = mods.data.find((x) => x.id === MODULE);
  assert.ok(m, 'QuickShop module is installed');
  console.log('module:', JSON.stringify({ version: m.version, enabled: m.enabled, status: m.status, error: m.error ?? null }));
  assert.equal(m.status, 'enabled', `module status ${m.status}: ${m.error ?? ''}`);
  assert.ok(m.version.startsWith('2.'), `QuickShop 2.x expected, found ${m.version}`);
  assert.equal(m.capabilities?.apiPrefix ?? null, null, 'QuickShop 2 declares no sidecar prefix');
  for (const f of ['index.js', 'lib/catalog-store.js', 'lib/add-to-list.js', 'lib/price.js', 'style.css', 'locales/de.json']) {
    assert.equal((await admin.raw(`/api/v1/modules/assets/${MODULE}/${f}`)).status, 200, f);
  }
  const index = await (await admin.raw(`/api/v1/modules/assets/${MODULE}/index.js`)).text();
  assert.ok(!index.includes('/api/extensions/'), 'the page makes no sidecar requests');
}

if (phase === 'unsupported') {
  await ensureAdmin();
  const admin = await session('admin').login(USER, PASSWORD);
  await assert.rejects(createCatalogStore(admin.api).list(), { reason: 'storage_unsupported' });
  console.log('unmodified Yuvomi -> storage_unsupported: OK');
  process.exit(0);
}

if (phase === 'readonly') {
  const admin = await session('admin').login(USER, PASSWORD);
  await checkModuleLoaded(admin);
  const items = await createCatalogStore(admin.api).list();
  console.log(`catalog readable: ${items.length} items`);
  console.log(`version: ${(await admin.api.get('/version')).version ?? '?'}`);
  console.log('readonly phase OK (nothing was changed)');
  process.exit(0);
}

if (phase === 'persist') {
  const admin = await session('admin').login(USER, PASSWORD);
  const names = (await createCatalogStore(admin.api).list()).map((i) => i.name).filter((n) => n.startsWith('E2E ')).sort();
  console.log('after restart:', names.join(', '));
  assert.deepEqual(names, ['E2E Milch', 'E2E Vollkornbrot']);
  console.log('persist phase OK');
  process.exit(0);
}

// ---------------------------------------------------------------- setup
await ensureAdmin();
const admin = await session('admin').login(USER, PASSWORD);
await checkModuleLoaded(admin);
const store = createCatalogStore(admin.api);

// Aufraeumen aus frueheren Laeufen.
for (const i of (await store.list()).filter((x) => x.name.startsWith('E2E '))) await store.remove(i);

// 1. CRUD
let items = await store.list();
const milk = await store.create({ name: 'E2E Milch', default_quantity: 2, price_cents: 119 }, items);
items.push(milk);
const bread = await store.create({ name: 'E2E Vollkornbrot' }, items);
items.push(bread);
await assert.rejects(store.create({ name: 'e2e  milch' }, items), { reason: 'item_exists' });
const breadEdited = await store.update(bread, { price_cents: 349 }, items);
assert.equal(breadEdited.revision, 2);
const temp = await store.create({ name: 'E2E Wegwerf' }, items);
await store.remove(temp);
assert.equal(typeof milk.id, 'string');
console.log('CRUD: OK');

// 2. Zwei Geraete, eine Revision
const device2 = await session('device2').login(USER, PASSWORD);
const store2 = createCatalogStore(device2.api);
const seen2 = (await store2.list()).find((i) => i.id === milk.id);
const milk2 = await store.update(milk, { default_quantity: 3 }, items);
await assert.rejects(store2.update(seen2, { default_quantity: 9 }), { reason: 'conflict' });
assert.equal((await store.get(milk.id)).default_quantity, 3, 'stale write did not overwrite');
console.log('conflict between two sessions: OK');

// 3. Rechte: Mitglied mit read und mit none
const stamp = Date.now().toString(36);
const members = {};
for (const [level, name] of [['read', `e2eread${stamp}`], ['none', `e2enone${stamp}`]]) {
  const made = await admin.api.post('/auth/users', { username: name, display_name: name, password: `${name}pw123` });
  await admin.api.put(`/permissions/user/${made.user.id}`, { modules: { [`ext:${MODULE}`]: level } });
  members[level] = { id: made.user.id, s: await session(level).login(name, `${name}pw123`) };
}
assert.ok((await createCatalogStore(members.read.s.api).list()).length >= 2);
await assert.rejects(createCatalogStore(members.read.s.api).create({ name: 'E2E verboten' }), { reason: 'forbidden' });
await assert.rejects(createCatalogStore(members.none.s.api).list(), { reason: 'forbidden' });
console.log('permissions none/read/write: OK');

// 4. Einkaufsliste (echte API)
let lists = (await admin.api.get('/shopping')).data;
let list = lists.find((l) => l.name === 'E2E Liste');
if (!list) list = (await admin.api.post('/shopping', { name: 'E2E Liste' })).data;
const listId = list.id;
for (const it of (await admin.api.get(`/shopping/${listId}/items`)).data) await admin.api.delete(`/shopping/items/${it.id}`);
const milkNow = await store.get(milk.id);
const actions = [];
actions.push((await addToShoppingList(admin.api, listId, milkNow)).action);
actions.push((await addToShoppingList(admin.api, listId, breadEdited)).action);
actions.push((await addToShoppingList(admin.api, listId, milkNow)).action);
assert.deepEqual(actions, ['added', 'added', 'increased']);
const rows = (await admin.api.get(`/shopping/${listId}/items`)).data;
assert.equal(rows.filter((r) => r.name === 'E2E Milch').length, 1);
assert.equal(rows.find((r) => r.name === 'E2E Milch').quantity, '6');
assert.deepEqual(await store.get(milk.id), milkNow, 'adding never changes the catalogue item');
console.log('shopping list:', rows.map((r) => `${r.name}[${r.quantity}]`).join(', '));

// 5. Import (wie die Datei aus tools/export-sidecar-db.mjs)
const exportFile = JSON.stringify({ format: 'flessinglabs-quickshop-export', version: 1, data: [
  { name: 'E2E Milch', default_quantity: 1, price_cents: null },
  { name: 'E2E Importiert', default_quantity: 4, price_cents: 99 },
] });
const { items: toImport } = parseImport(exportFile);
const imported = await importItems(store, toImport, await store.list());
assert.deepEqual([imported.created, imported.skipped], [1, 1]);
assert.equal((await store.get(milk.id)).default_quantity, 3, 'import left the existing item alone');
await store.remove(imported.items[0]);
console.log('import: OK');

// 6. Andere Bereiche unveraendert
for (const p of ['/tasks', '/notes', '/pantry', '/dashboard', '/shopping', '/modules']) {
  const res = await admin.raw(`/api/v1${p}`);
  assert.ok(res.status < 400, `${p} -> ${res.status}`);
}
console.log('other areas: OK');

// 7. Keine Sidecar-Aufrufe
const all = [...admin.seen, ...device2.seen, ...members.read.s.seen, ...members.none.s.seen];
assert.ok(all.every((r) => !r.includes('/extensions/')), 'no request to a sidecar path');
assert.ok(all.some((r) => r.includes(RECORDS)), 'catalogue went through the module storage');
console.log(`requests: ${all.length}, none to a sidecar`);

// Aufraeumen: Testliste und -mitglieder; zwei Artikel bleiben fuer `persist`.
await admin.api.delete(`/shopping/${listId}`);
for (const m of Object.values(members)) await admin.api.delete(`/auth/users/${m.id}`).catch(() => {});
console.log('setup phase OK');
