/**
 * QuickShop - Katalog im Yuvomi-Modulspeicher
 *
 * Seit QuickShop 2.0 liegt der Katalog nicht mehr in einem eigenen Dienst,
 * sondern in Yuvomi selbst: /api/v1/modules/flessinglabs-quickshop/records
 * (Modulspeicher, Yuvomi mit Migration 274). Jeder Artikel ist ein Datensatz
 * `{ id, revision, data: { name, default_quantity, price_cents } }`.
 *
 * `api` ist Yuvomis `/api.js`-Client oder im Test eine Attrappe mit
 * get/post/put/delete, die bei Fehlern ein Objekt mit `status` und
 * `data.reason` wirft (wie ApiError).
 *
 * Yuvomi prueft nur Form und Groesse eines Datensatzes; was ein gueltiger
 * Artikel ist, entscheidet diese Datei (`cleanItem`). Revisionen kommen vom
 * Server: wer eine veraltete schickt, bekommt `conflict` - hier wird nie
 * stillschweigend mit der neuen Revision nachgeschrieben.
 */

import { normalizeName } from './add-to-list.js';

export const MODULE_ID = 'flessinglabs-quickshop';
export const RECORDS = `/modules/${MODULE_ID}/records`;
export const MAX_NAME = 120;
export const MAX_QUANTITY = 999;
export const MAX_PRICE_CENTS = 10_000_000;

export class CatalogError extends Error {
  /**
   * @param {string} reason  name_required | name_too_long | quantity_invalid | price_invalid |
   *   item_exists | conflict | not_found | forbidden | storage_full | storage_unavailable |
   *   storage_unsupported | failed
   */
  constructor(reason, message = reason, status = 0) {
    super(message);
    this.name = 'CatalogError';
    this.reason = reason;
    this.status = status;
  }
}

// Derselbe Vergleich wie beim Abgleich mit der Einkaufsliste: ein Name, eine Regel.
export { normalizeName as nameKey };

/** Ein Artikel, wie QuickShop ihn speichert - oder CatalogError. */
export function cleanItem(input) {
  const rawName = typeof input?.name === 'string' ? input.name.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  if (!rawName) throw new CatalogError('name_required');
  if (rawName.length > MAX_NAME) throw new CatalogError('name_too_long');

  let qty = input?.default_quantity;
  if (qty === undefined || qty === null || qty === '') qty = 1;
  if (typeof qty === 'string' && /^[0-9]+$/.test(qty.trim())) qty = Number(qty.trim());
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QUANTITY) throw new CatalogError('quantity_invalid');

  let price = input?.price_cents;
  if (price === undefined || price === '') price = null;
  if (price !== null && (!Number.isInteger(price) || price < 0 || price > MAX_PRICE_CENTS)) {
    throw new CatalogError('price_invalid');
  }
  return { name: rawName, default_quantity: qty, price_cents: price };
}

/** Datensatz -> Artikel. Ein Datensatz, den eine fremde Hand verbogen hat, wird tolerant gelesen. */
export function fromRecord(record) {
  const d = record?.data ?? {};
  const qty = Number.isInteger(d.default_quantity) && d.default_quantity >= 1 ? d.default_quantity : 1;
  return {
    id: String(record.id),
    revision: record.revision,
    name: typeof d.name === 'string' ? d.name : '',
    default_quantity: qty,
    price_cents: Number.isInteger(d.price_cents) ? d.price_cents : null,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function translate(err) {
  if (err instanceof CatalogError) return err;
  if (err?.name === 'AbortError' || err?.name === 'ApiAbortError') return err;
  const status = err?.status ?? 0;
  const reason = err?.data?.reason ?? null;
  if (status === 404 && reason === 'module_storage_unavailable') return new CatalogError('storage_unavailable', err.message, 404);
  // 404 ohne diesen Grund: die Route gibt es nicht - ein Yuvomi ohne Modulspeicher.
  if (status === 404 && !reason) return new CatalogError('storage_unsupported', err.message, 404);
  if (status === 404) return new CatalogError('not_found', err.message, 404);
  if (status === 409) return new CatalogError('conflict', err.message, 409);
  if (status === 403) return new CatalogError('forbidden', err.message, 403);
  if (status === 413) return new CatalogError('storage_full', err.message, 413);
  return new CatalogError('failed', err?.message || 'failed', status);
}

async function call(fn) {
  try {
    return await fn();
  } catch (err) {
    throw translate(err);
  }
}

export function createCatalogStore(api) {
  return {
    /** Alle Artikel, alle Seiten. */
    async list({ signal } = {}) {
      const items = [];
      let after = '';
      for (let page = 0; page < 50; page++) {
        const q = `?limit=200${after ? `&after=${encodeURIComponent(after)}` : ''}`;
        const res = await call(() => api.get(`${RECORDS}${q}`, { signal }));
        items.push(...(res?.data ?? []).map(fromRecord));
        if (!res?.next) break;
        after = res.next;
      }
      return items;
    },

    /** Neu anlegen. `existing` ist die aktuelle Liste, gegen die der Name eindeutig sein muss. */
    async create(input, existing = []) {
      const item = cleanItem(input);
      const key = normalizeName(item.name);
      if (existing.some((i) => normalizeName(i.name) === key)) throw new CatalogError('item_exists');
      const res = await call(() => api.post(RECORDS, { data: item }));
      return fromRecord(res.data);
    },

    /** Ersetzen mit der Revision, die `current` traegt. */
    async update(current, changes, existing = []) {
      const item = cleanItem({ ...current, ...changes });
      const key = normalizeName(item.name);
      if (existing.some((i) => i.id !== current.id && normalizeName(i.name) === key)) throw new CatalogError('item_exists');
      const res = await call(() => api.put(`${RECORDS}/${encodeURIComponent(current.id)}`, { data: item, revision: current.revision }));
      return fromRecord(res.data);
    },

    async remove(current) {
      await call(() => api.delete(`${RECORDS}/${encodeURIComponent(current.id)}?revision=${current.revision}`));
      return true;
    },

    /** Einen Artikel frisch lesen, etwa nach einem Konflikt. null, wenn es ihn nicht mehr gibt. */
    async get(id) {
      try {
        const res = await call(() => api.get(`${RECORDS}/${encodeURIComponent(id)}`));
        return fromRecord(res.data);
      } catch (err) {
        if (err.reason === 'not_found') return null;
        throw err;
      }
    },
  };
}

/**
 * Artikel aus einer Export-Datei lesen: die Antwort des alten QuickShop-Dienstes
 * (`{ data: [...] }` von /api/extensions/flessinglabs-quickshop/items), die
 * Ausgabe von tools/export-sidecar-db.mjs oder ein blosses Array.
 * Gibt nur gueltige Artikel zurueck, plus die Zahl der verworfenen.
 */
export function parseImport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CatalogError('import_invalid');
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed?.items) ? parsed.items : null;
  if (!list) throw new CatalogError('import_invalid');
  const items = [];
  let invalid = 0;
  for (const raw of list) {
    try {
      items.push(cleanItem(raw));
    } catch {
      invalid++;
    }
  }
  return { items, invalid };
}

/**
 * Importieren: legt jeden Artikel an, dessen Name noch nicht im Katalog steht.
 * Vorhandene werden nie veraendert. Laeuft der Speicher voll, endet der Import
 * dort und meldet, wie weit er kam.
 */
export async function importItems(store, items, existing) {
  const known = [...existing];
  const result = { created: 0, skipped: 0, failed: 0, stoppedBy: null, items: [] };
  for (const item of items) {
    if (known.some((i) => normalizeName(i.name) === normalizeName(item.name))) {
      result.skipped++;
      continue;
    }
    try {
      const made = await store.create(item, known);
      known.push(made);
      result.items.push(made);
      result.created++;
    } catch (err) {
      result.failed++;
      if (err.reason === 'storage_full' || err.reason === 'forbidden' || err.reason === 'storage_unsupported') {
        result.stoppedBy = err.reason;
        break;
      }
    }
  }
  return result;
}
