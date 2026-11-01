#!/usr/bin/env node
/**
 * Katalog aus dem alten QuickShop-Dienst (Version 1.x) exportieren.
 *
 *   node tools/export-sidecar-db.mjs /pfad/zu/quickshop.db > quickshop-export.json
 *
 * Die Datenbank wird NUR LESEND geoeffnet und nie veraendert oder geloescht.
 * Die Ausgabe nimmt QuickShop 2 unter "Katalog importieren" an. Braucht
 * Node.js 22.13 oder neuer (eingebautes node:sqlite).
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage: node tools/export-sidecar-db.mjs <quickshop.db> > quickshop-export.json');
  process.exit(2);
}

const db = new DatabaseSync(file, { readOnly: true });
const rows = db.prepare('SELECT name, default_quantity, price_cents FROM items ORDER BY name COLLATE NOCASE, id').all();
db.close();

process.stdout.write(`${JSON.stringify({
  format: 'flessinglabs-quickshop-export',
  version: 1,
  exported_at: new Date().toISOString(),
  data: rows.map((r) => ({ name: r.name, default_quantity: r.default_quantity, price_cents: r.price_cents ?? null })),
}, null, 2)}\n`);
console.error(`${rows.length} items exported from ${file} (read-only).`);
