import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogStore, cleanItem, parseImport, importItems, RECORDS, CatalogError } from '../../module/lib/catalog-store.js';

/**
 * Attrappe des Yuvomi-Modulspeichers mit dem Verhalten aus
 * server/services/module-records.js: UUIDs, Revisionen, 409 bei veralteter
 * Revision, Seiten zu `limit`, 413 bei vollem Speicher. Fehler kommen wie
 * ApiError aus /api.js: `{ status, data: { reason } }`.
 */
function fakeYuvomi({ supported = true, enabled = true, capacity = 1000 } = {}) {
  const rows = new Map();
  let n = 0;
  const calls = [];
  const fail = (status, reason) => Object.assign(new Error(reason ?? `HTTP ${status}`), { status, data: reason ? { reason } : {} });
  const gate = () => {
    if (!supported) throw fail(404);
    if (!enabled) throw fail(404, 'module_storage_unavailable');
  };
  const record = (r) => ({ ...r, data: structuredClone(r.data) });
  const api = {
    async get(path) {
      calls.push(['GET', path]); gate();
      const url = new URL(path, 'http://x');
      if (url.pathname === RECORDS) {
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const after = url.searchParams.get('after') ?? '';
        const all = [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)).filter((r) => r.id > after);
        const page = all.slice(0, limit);
        return { data: page.map(record), next: all.length > limit ? page.at(-1).id : null };
      }
      const r = rows.get(url.pathname.split('/').pop());
      if (!r) throw fail(404, 'record_not_found');
      return { data: record(r) };
    },
    async post(path, body) {
      calls.push(['POST', path, body]); gate();
      if (rows.size >= capacity) throw fail(413, 'module_storage_full');
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
      const r = { id, revision: 1, data: structuredClone(body.data), created_at: 't', updated_at: 't' };
      rows.set(id, r);
      return { data: record(r) };
    },
    async put(path, body) {
      calls.push(['PUT', path, body]); gate();
      const r = rows.get(path.split('/').pop());
      if (!r) throw fail(404, 'record_not_found');
      if (r.revision !== body.revision) throw fail(409, 'record_conflict');
      r.data = structuredClone(body.data); r.revision++;
      return { data: record(r) };
    },
    async delete(path) {
      calls.push(['DELETE', path]); gate();
      const url = new URL(path, 'http://x');
      const r = rows.get(url.pathname.split('/').pop());
      if (!r) throw fail(404, 'record_not_found');
      if (r.revision !== Number(url.searchParams.get('revision'))) throw fail(409, 'record_conflict');
      rows.delete(r.id);
      return { data: { id: r.id, deleted: true } };
    },
  };
  return { api, rows, calls };
}

test('cleanItem: defaults and validation like QuickShop 1.x', () => {
  assert.deepEqual(cleanItem({ name: '  Milch ' }), { name: 'Milch', default_quantity: 1, price_cents: null });
  assert.equal(cleanItem({ name: 'A', default_quantity: '3' }).default_quantity, 3);
  for (const [input, reason] of [
    [{}, 'name_required'], [{ name: '  ' }, 'name_required'], [{ name: 'x'.repeat(121) }, 'name_too_long'],
    [{ name: 'A', default_quantity: 0 }, 'quantity_invalid'], [{ name: 'A', default_quantity: 1.5 }, 'quantity_invalid'],
    [{ name: 'A', default_quantity: 1000 }, 'quantity_invalid'], [{ name: 'A', price_cents: -1 }, 'price_invalid'],
    [{ name: 'A', price_cents: '199' }, 'price_invalid'],
  ]) assert.throws(() => cleanItem(input), { reason });
});

test('CRUD with string UUID ids and revisions', async () => {
  const y = fakeYuvomi();
  const store = createCatalogStore(y.api);
  const milk = await store.create({ name: 'Milch', default_quantity: 2, price_cents: 119 });
  assert.equal(typeof milk.id, 'string');
  assert.equal(milk.revision, 1);
  const edited = await store.update(milk, { default_quantity: 4 });
  assert.equal(edited.revision, 2);
  assert.equal(edited.price_cents, 119, 'unchanged fields are kept');
  assert.deepEqual((await store.list()).map((i) => [i.name, i.default_quantity]), [['Milch', 4]]);
  await store.remove(edited);
  assert.equal(y.rows.size, 0);
  assert.ok(y.calls.every(([, p]) => p.startsWith('/modules/flessinglabs-quickshop/records')), 'never a sidecar path');
});

test('names stay unique (case and spacing ignored)', async () => {
  const store = createCatalogStore(fakeYuvomi().api);
  const a = await store.create({ name: 'Vollkorn Brot' });
  const b = await store.create({ name: 'Käse' }, [a]);
  await assert.rejects(store.create({ name: 'vollkorn   brot' }, [a, b]), { reason: 'item_exists' });
  await assert.rejects(store.update(b, { name: 'VOLLKORN BROT' }, [a, b]), { reason: 'item_exists' });
  assert.equal((await store.update(b, { name: 'käse' }, [a, b])).name, 'käse', 'renaming to a case variant of itself is fine');
});

test('a stale revision is a conflict and is never retried silently', async () => {
  const y = fakeYuvomi();
  const deviceA = createCatalogStore(y.api);
  const deviceB = createCatalogStore(y.api);
  const item = await deviceA.create({ name: 'Eier', default_quantity: 6 });
  await deviceB.update(item, { default_quantity: 10 });
  const puts = y.calls.filter(([m]) => m === 'PUT').length;
  await assert.rejects(deviceA.update(item, { default_quantity: 12 }), { reason: 'conflict' });
  await assert.rejects(deviceA.remove(item), { reason: 'conflict' });
  assert.equal(y.calls.filter(([m]) => m === 'PUT').length, puts + 1, 'exactly one refused PUT, no retry');
  assert.equal((await deviceA.get(item.id)).default_quantity, 10, 'the other device wins until the person decides');
});

test('get returns null for a record deleted elsewhere', async () => {
  const y = fakeYuvomi();
  const store = createCatalogStore(y.api);
  const item = await store.create({ name: 'Weg' });
  await store.remove(item);
  assert.equal(await store.get(item.id), null);
});

test('list reads every page', async () => {
  const y = fakeYuvomi();
  const store = createCatalogStore(y.api);
  for (let i = 0; i < 450; i++) await store.create({ name: `Artikel ${i}` });
  assert.equal((await store.list()).length, 450);
  assert.equal(y.calls.filter(([m, p]) => m === 'GET' && p.includes('limit=200')).length, 3);
});

test('an unmodified Yuvomi is told apart from a switched-off module', async () => {
  await assert.rejects(createCatalogStore(fakeYuvomi({ supported: false }).api).list(), { reason: 'storage_unsupported' });
  await assert.rejects(createCatalogStore(fakeYuvomi({ enabled: false }).api).list(), { reason: 'storage_unavailable' });
  const full = createCatalogStore(fakeYuvomi({ capacity: 0 }).api);
  await assert.rejects(full.create({ name: 'X' }), (e) => e instanceof CatalogError && e.reason === 'storage_full');
});

test('import: old sidecar answer, export tool output and bare arrays', () => {
  const old = JSON.stringify({ data: [{ id: 7, name: 'Milch', default_quantity: 2, price_cents: 119, created_by: 1 }] });
  assert.deepEqual(parseImport(old).items, [{ name: 'Milch', default_quantity: 2, price_cents: 119 }]);
  const tool = JSON.stringify({ format: 'flessinglabs-quickshop-export', version: 1, data: [{ name: 'Brot', default_quantity: 1, price_cents: null }, { name: '' }] });
  const parsed = parseImport(tool);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.invalid, 1);
  assert.equal(parseImport('[{"name":"Eier"}]').items[0].name, 'Eier');
  assert.throws(() => parseImport('kein json'), { reason: 'import_invalid' });
  assert.throws(() => parseImport('{"foo":1}'), { reason: 'import_invalid' });
});

test('import creates only missing names and never changes existing items', async () => {
  const y = fakeYuvomi();
  const store = createCatalogStore(y.api);
  const milk = await store.create({ name: 'Milch', default_quantity: 9 });
  const result = await importItems(store, [
    { name: 'milch', default_quantity: 1, price_cents: null },
    { name: 'Brot', default_quantity: 1, price_cents: 249 },
    { name: 'Brot', default_quantity: 2, price_cents: null },
  ], [milk]);
  assert.deepEqual([result.created, result.skipped, result.failed], [1, 2, 0]);
  assert.equal((await store.get(milk.id)).default_quantity, 9);
  assert.equal(y.calls.filter(([m]) => m === 'PUT').length, 0);
});

test('import stops at a full catalogue and says so', async () => {
  const store = createCatalogStore(fakeYuvomi({ capacity: 1 }).api);
  const result = await importItems(store, [{ name: 'A', default_quantity: 1, price_cents: null }, { name: 'B', default_quantity: 1, price_cents: null }, { name: 'C', default_quantity: 1, price_cents: null }], []);
  assert.equal(result.created, 1);
  assert.equal(result.stoppedBy, 'storage_full');
});
