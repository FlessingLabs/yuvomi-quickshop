import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, nameKey } from '../src/store.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickshop-'));
  return path.join(dir, 'quickshop.db');
}

test('create uses defaults: quantity 1, no price', () => {
  const s = openStore(':memory:');
  const item = s.create({ name: '  Milch ' }, { userId: 7 });
  assert.equal(item.name, 'Milch');
  assert.equal(item.default_quantity, 1);
  assert.equal(item.price_cents, null);
  assert.equal(item.created_by, 7);
  assert.ok(Number.isInteger(item.id));
});

test('create validates name, quantity and price', () => {
  const s = openStore(':memory:');
  assert.throws(() => s.create({}), { reason: 'name_required' });
  assert.throws(() => s.create({ name: '   ' }), { reason: 'name_required' });
  assert.throws(() => s.create({ name: 'x'.repeat(121) }), { reason: 'name_too_long' });
  assert.throws(() => s.create({ name: 'A', default_quantity: 0 }), { reason: 'quantity_invalid' });
  assert.throws(() => s.create({ name: 'A', default_quantity: 1.5 }), { reason: 'quantity_invalid' });
  assert.throws(() => s.create({ name: 'A', default_quantity: 1000 }), { reason: 'quantity_invalid' });
  assert.throws(() => s.create({ name: 'A', price_cents: -1 }), { reason: 'price_invalid' });
  assert.throws(() => s.create({ name: 'A', price_cents: 1.5 }), { reason: 'price_invalid' });
  assert.throws(() => s.create({ name: 'A', price_cents: '199' }), { reason: 'price_invalid' });
  assert.equal(s.create({ name: 'A', default_quantity: '3', price_cents: 199 }).default_quantity, 3);
});

test('names are unique regardless of case and spacing', () => {
  const s = openStore(':memory:');
  s.create({ name: 'Vollkorn Brot' });
  assert.throws(() => s.create({ name: 'vollkorn   brot' }), { status: 409, reason: 'item_exists' });
  assert.equal(nameKey(' ÄPFEL '), 'äpfel');
});

test('update is partial; null clears the price; rename keeps uniqueness', () => {
  const s = openStore(':memory:');
  const a = s.create({ name: 'Butter', default_quantity: 2, price_cents: 249 });
  s.create({ name: 'Käse' });

  const u1 = s.update(a.id, { default_quantity: 4 });
  assert.equal(u1.default_quantity, 4);
  assert.equal(u1.price_cents, 249);
  assert.equal(u1.name, 'Butter');

  assert.equal(s.update(a.id, { price_cents: null }).price_cents, null);
  assert.throws(() => s.update(a.id, { name: 'KÄSE' }), { reason: 'item_exists' });
  assert.equal(s.update(a.id, { name: 'butter' }).name, 'butter', 'renaming to a case variant of itself is fine');
  assert.equal(s.update(999, { name: 'X' }), null);
});

test('list sorts by name and searches by substring, case-insensitive', () => {
  const s = openStore(':memory:');
  for (const name of ['Zucker', 'apfelsaft', 'Äpfel', 'Milch', 'Hafermilch']) s.create({ name });
  assert.deepEqual(s.list().map((i) => i.name).slice(0, 2), ['apfelsaft', 'Hafermilch']);
  assert.deepEqual(s.list({ q: 'MILCH' }).map((i) => i.name).sort(), ['Hafermilch', 'Milch']);
  assert.deepEqual(s.list({ q: '' }).length, 5);
});

test('remove deletes once', () => {
  const s = openStore(':memory:');
  const a = s.create({ name: 'Eier' });
  assert.equal(s.remove(a.id), true);
  assert.equal(s.remove(a.id), false);
  assert.equal(s.get(a.id), null);
});

test('items survive a restart (file database)', () => {
  const file = tmpFile();
  const s1 = openStore(file);
  const a = s1.create({ name: 'Kaffee', default_quantity: 2, price_cents: 899 });
  s1.close();

  const s2 = openStore(file);
  assert.deepEqual(s2.get(a.id), a);
  s2.close();
});

test('refuses a database from a newer QuickShop', async () => {
  const file = tmpFile();
  openStore(file).close();
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA user_version = 99');
  raw.close();
  assert.throws(() => openStore(file), /newer than this QuickShop/);
});
