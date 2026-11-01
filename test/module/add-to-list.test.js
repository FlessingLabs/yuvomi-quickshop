import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addToShoppingList, parseCount, normalizeName, createSerialQueue } from '../../module/lib/add-to-list.js';

/**
 * Eine Attrappe der Yuvomi-Einkaufs-API mit dem Verhalten, auf das sich das
 * Modul verlaesst (server/routes/shopping.js): POST legt immer neu an,
 * PATCH aendert nur mitgeschickte Felder, Kategorien sind eine feste Liste.
 */
function fakeYuvomi({ items = [], categories = ['Sonstiges', 'Milchprodukte'], history = [] } = {}) {
  let nextId = 100;
  const db = { items: items.map((i) => ({ is_checked: 0, quantity: null, category: 'Sonstiges', list_id: 1, ...i })) };
  const calls = [];
  const err = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
  const api = {
    async get(path) {
      calls.push(['GET', path]);
      let m;
      if ((m = path.match(/^\/shopping\/(\d+)\/items$/))) return { data: db.items.filter((i) => i.list_id === Number(m[1])) };
      if ((m = path.match(/^\/shopping\/suggestions\?q=(.*)$/))) {
        const q = decodeURIComponent(m[1]).toLowerCase();
        return { data: history.filter((h) => h.name.toLowerCase().startsWith(q)) };
      }
      throw err(404);
    },
    async post(path, body) {
      calls.push(['POST', path, body]);
      const m = path.match(/^\/shopping\/(\d+)\/items$/);
      if (!m) throw err(404);
      if (body.category && !categories.includes(body.category)) throw err(400);
      const item = { id: nextId++, list_id: Number(m[1]), name: body.name, quantity: body.quantity ?? null, category: body.category ?? 'Sonstiges', is_checked: 0 };
      db.items.push(item);
      return { data: item };
    },
    async patch(path, body) {
      calls.push(['PATCH', path, body]);
      const item = db.items.find((i) => i.id === Number(path.split('/').pop()));
      if (!item) throw err(404);
      if (body.quantity !== undefined) item.quantity = body.quantity;
      if (body.is_checked !== undefined) item.is_checked = body.is_checked ? 1 : 0;
      return { data: { ...item } };
    },
    async delete(path) {
      calls.push(['DELETE', path]);
      db.items = db.items.filter((i) => i.id !== Number(path.split('/').pop()));
      return { data: {} };
    },
  };
  return { api, db, calls };
}

const milk = { id: 1, name: 'Milch', default_quantity: 2, price_cents: 119 };

test('parseCount: empty is one, digits are a count, free text is null', () => {
  assert.equal(parseCount(null), 1);
  assert.equal(parseCount(''), 1);
  assert.equal(parseCount(' 3 '), 3);
  assert.equal(parseCount('500 g'), null);
  assert.equal(parseCount('2 Pck.'), null);
  assert.equal(parseCount('1,5'), null);
});

test('normalizeName ignores case and extra spaces', () => {
  assert.equal(normalizeName('  Voll  Milch '), 'voll milch');
});

test('not on the list -> added with the default quantity', async () => {
  const y = fakeYuvomi();
  const r = await addToShoppingList(y.api, 1, milk);
  assert.equal(r.action, 'added');
  assert.equal(y.db.items.length, 1);
  assert.equal(y.db.items[0].quantity, '2');
  assert.equal(y.db.items[0].name, 'Milch');
});

test('category is taken from the last purchase of exactly this name', async () => {
  const y = fakeYuvomi({ history: [{ name: 'Milchreis', category: 'Sonstiges' }, { name: 'milch', category: 'Milchprodukte' }] });
  await addToShoppingList(y.api, 1, milk);
  assert.equal(y.db.items[0].category, 'Milchprodukte');
});

test('a remembered category that no longer exists falls back to the default', async () => {
  const y = fakeYuvomi({ history: [{ name: 'Milch', category: 'Gelöscht' }] });
  const r = await addToShoppingList(y.api, 1, milk);
  assert.equal(r.action, 'added');
  assert.equal(y.db.items[0].category, 'Sonstiges');
});

test('open with a numeric quantity -> quantity increased, no second row', async () => {
  const y = fakeYuvomi({ items: [{ id: 5, name: 'milch', quantity: '1' }] });
  const r = await addToShoppingList(y.api, 1, milk);
  assert.equal(r.action, 'increased');
  assert.equal(y.db.items.length, 1);
  assert.equal(y.db.items[0].quantity, '3');
});

test('open without a quantity counts as one', async () => {
  const y = fakeYuvomi({ items: [{ id: 5, name: 'Milch', quantity: null }] });
  await addToShoppingList(y.api, 1, milk);
  assert.equal(y.db.items[0].quantity, '3');
});

test('open with free-text quantity -> left alone', async () => {
  const y = fakeYuvomi({ items: [{ id: 5, name: 'Milch', quantity: '1 l' }] });
  const r = await addToShoppingList(y.api, 1, milk);
  assert.equal(r.action, 'already');
  assert.equal(r.undo, null);
  assert.equal(y.db.items[0].quantity, '1 l');
  assert.ok(!y.calls.some(([m]) => m === 'PATCH' || m === 'POST'));
});

test('checked off -> reopened with the default quantity', async () => {
  const y = fakeYuvomi({ items: [{ id: 5, name: 'Milch', quantity: '6', is_checked: 1 }] });
  const r = await addToShoppingList(y.api, 1, milk);
  assert.equal(r.action, 'reopened');
  assert.equal(y.db.items[0].is_checked, 0);
  assert.equal(y.db.items[0].quantity, '2');
});

test('open row wins over a checked row of the same name', async () => {
  const y = fakeYuvomi({ items: [{ id: 5, name: 'Milch', is_checked: 1 }, { id: 6, name: 'Milch', quantity: '1' }] });
  await addToShoppingList(y.api, 1, milk);
  assert.equal(y.db.items.find((i) => i.id === 6).quantity, '3');
  assert.equal(y.db.items.find((i) => i.id === 5).is_checked, 1);
});

test('items on other lists are not matched', async () => {
  const y = fakeYuvomi({ items: [{ id: 5, name: 'Milch', list_id: 2 }] });
  const r = await addToShoppingList(y.api, 1, milk);
  assert.equal(r.action, 'added');
});

test('undo restores the exact previous state', async () => {
  const y = fakeYuvomi();
  const added = await addToShoppingList(y.api, 1, milk);
  await added.undo();
  assert.equal(y.db.items.length, 0);

  const y2 = fakeYuvomi({ items: [{ id: 5, name: 'Milch', quantity: '1' }] });
  await (await addToShoppingList(y2.api, 1, milk)).undo();
  assert.equal(y2.db.items[0].quantity, '1');

  const y3 = fakeYuvomi({ items: [{ id: 5, name: 'Milch', quantity: '6', is_checked: 1 }] });
  await (await addToShoppingList(y3.api, 1, milk)).undo();
  assert.equal(y3.db.items[0].quantity, '6');
  assert.equal(y3.db.items[0].is_checked, 1);
});

test('the catalogue article is never modified', async () => {
  const y = fakeYuvomi({ items: [{ id: 5, name: 'Milch', quantity: '1' }] });
  const article = { ...milk };
  await addToShoppingList(y.api, 1, article);
  assert.deepEqual(article, milk);
});

test('several articles one after another', async () => {
  const y = fakeYuvomi();
  const q = createSerialQueue();
  const bread = { id: 2, name: 'Brot', default_quantity: 1 };
  await Promise.all([
    q(() => addToShoppingList(y.api, 1, milk)),
    q(() => addToShoppingList(y.api, 1, bread)),
    q(() => addToShoppingList(y.api, 1, milk)),
  ]);
  assert.deepEqual(y.db.items.map((i) => [i.name, i.quantity]), [['Milch', '4'], ['Brot', '1']]);
});

test('serial queue keeps going after a failure', async () => {
  const q = createSerialQueue();
  await assert.rejects(q(async () => { throw new Error('x'); }));
  assert.equal(await q(async () => 42), 42);
});
