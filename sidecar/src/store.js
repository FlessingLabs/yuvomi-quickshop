/**
 * QuickShop - Artikelkatalog (Datenhaltung)
 *
 * Eine eigene SQLite-Datei, nie yuvomi.db (MODULES.md: "Do not open yuvomi.db").
 * Der Katalog gehoert dem Haushalt, wie die Einkaufsliste selbst: es gibt keine
 * Eigentuemerschaft je Artikel, `created_by` ist nur Herkunftsnachweis.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_NAME = 120;
export const MAX_QUANTITY = 999;
export const MAX_PRICE_CENTS = 10_000_000; // 100.000 EUR - schuetzt vor Vertippern

/** Schema-Migrationen, Index = Zielversion - 1. Nur anhaengen, nie aendern. */
const MIGRATIONS = [
  `CREATE TABLE items (
     id               INTEGER PRIMARY KEY AUTOINCREMENT,
     name             TEXT    NOT NULL,
     name_key         TEXT    NOT NULL UNIQUE,
     default_quantity INTEGER NOT NULL DEFAULT 1,
     price_cents      INTEGER,
     created_by       INTEGER,
     created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
     updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   )`,
];

export class ValidationError extends Error {
  constructor(message, reason) {
    super(message);
    this.status = 400;
    this.reason = reason;
  }
}

export class ConflictError extends Error {
  constructor(message, reason) {
    super(message);
    this.status = 409;
    this.reason = reason;
  }
}

/** Vergleichsschluessel fuer Namen: "Milch", " milch " und "MILCH" sind derselbe Artikel. */
export function nameKey(name) {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
}

function cleanName(raw) {
  if (typeof raw !== 'string') throw new ValidationError('name is required.', 'name_required');
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!name) throw new ValidationError('name is required.', 'name_required');
  if (name.length > MAX_NAME) throw new ValidationError(`name must be at most ${MAX_NAME} characters.`, 'name_too_long');
  return name;
}

function cleanQuantity(raw) {
  if (raw === undefined || raw === null || raw === '') return 1;
  const n = typeof raw === 'string' && /^[0-9]+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (!Number.isInteger(n) || n < 1 || n > MAX_QUANTITY) {
    throw new ValidationError(`default_quantity must be a whole number from 1 to ${MAX_QUANTITY}.`, 'quantity_invalid');
  }
  return n;
}

function cleanPrice(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (!Number.isInteger(raw) || raw < 0 || raw > MAX_PRICE_CENTS) {
    throw new ValidationError(`price_cents must be a whole number of cents from 0 to ${MAX_PRICE_CENTS}.`, 'price_invalid');
  }
  return raw;
}

function toItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    default_quantity: row.default_quantity,
    price_cents: row.price_cents ?? null,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function openStore(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current > MIGRATIONS.length) {
    throw new Error(`Database schema ${current} is newer than this QuickShop (${MIGRATIONS.length}). Refusing to start.`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const byId = db.prepare('SELECT * FROM items WHERE id = ?');
  const byKey = db.prepare('SELECT id FROM items WHERE name_key = ?');

  function assertFreeName(key, exceptId = null) {
    const hit = byKey.get(key);
    if (hit && hit.id !== exceptId) {
      throw new ConflictError('An item with this name already exists.', 'item_exists');
    }
  }

  return {
    list({ q = '' } = {}) {
      const all = db.prepare('SELECT * FROM items ORDER BY name COLLATE NOCASE ASC, id ASC').all();
      const needle = nameKey(String(q));
      if (!needle) return all.map(toItem);
      return all.filter((r) => r.name_key.includes(needle)).map(toItem);
    },

    get(id) {
      return toItem(byId.get(id));
    },

    create(input, { userId = null } = {}) {
      const name = cleanName(input?.name);
      const quantity = cleanQuantity(input?.default_quantity);
      const price = cleanPrice(input?.price_cents);
      const key = nameKey(name);
      assertFreeName(key);
      const result = db.prepare(
        'INSERT INTO items (name, name_key, default_quantity, price_cents, created_by) VALUES (?, ?, ?, ?, ?)'
      ).run(name, key, quantity, price, userId);
      return toItem(byId.get(Number(result.lastInsertRowid)));
    },

    /** Teil-Update: nicht mitgeschickt heisst unveraendert, `price_cents: null` loescht den Preis. */
    update(id, input) {
      const row = byId.get(id);
      if (!row) return null;
      const name = input?.name !== undefined ? cleanName(input.name) : row.name;
      const quantity = input?.default_quantity !== undefined ? cleanQuantity(input.default_quantity) : row.default_quantity;
      const price = input?.price_cents !== undefined ? cleanPrice(input.price_cents) : row.price_cents;
      const key = nameKey(name);
      assertFreeName(key, row.id);
      db.prepare(`
        UPDATE items SET name = ?, name_key = ?, default_quantity = ?, price_cents = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(name, key, quantity, price, row.id);
      return toItem(byId.get(row.id));
    },

    remove(id) {
      return db.prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0;
    },

    close() {
      db.close();
    },
  };
}
