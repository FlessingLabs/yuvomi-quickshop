/**
 * QuickShop - einen Katalogartikel auf eine Yuvomi-Einkaufsliste setzen
 *
 * Ausschliesslich ueber die offizielle REST-API (`/api/v1/shopping`), mit der
 * Session des Mitglieds. `api` ist Yuvomis `/api.js`-Client (oder im Test eine
 * Attrappe mit get/post/patch/delete) - diese Datei importiert nichts aus
 * Yuvomi und laeuft deshalb auch unter `node --test`.
 *
 * Yuvomis POST /:listId/items erkennt keine Doppel. Deshalb wird zuerst die
 * Liste gelesen:
 *   - nicht drauf             -> neu anlegen mit der Standardanzahl   ('added')
 *   - drauf, abgehakt         -> wieder oeffnen, Standardanzahl setzen ('reopened')
 *   - drauf, offen, Zahl      -> Anzahl um die Standardanzahl erhoehen ('increased')
 *   - drauf, offen, Freitext  -> nichts aendern ("500 g" + 1 hat keine Bedeutung) ('already')
 *
 * Der Katalogartikel selbst wird nie veraendert.
 */

/** Vergleichsschluessel fuer Artikelnamen (identisch zum Sidecar). */
export function normalizeName(name) {
  return String(name ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
}

/**
 * Anzahl einer Einkaufsposition als ganze Zahl. Leer heisst eins (eine Position
 * ohne Menge ist ein Stueck); Freitext wie "500 g" oder "2 Pck." ergibt null.
 */
export function parseCount(quantity) {
  if (quantity === null || quantity === undefined) return 1;
  const s = String(quantity).trim();
  if (!s) return 1;
  return /^[0-9]{1,6}$/.test(s) ? Number(s) : null;
}

/** Die Kategorie, unter der dieser Name zuletzt eingekauft wurde - aus Yuvomis Vorschlaegen. */
async function lastCategory(api, name) {
  try {
    const res = await api.get(`/shopping/suggestions?q=${encodeURIComponent(name)}`);
    const key = normalizeName(name);
    return (res?.data ?? []).find((s) => normalizeName(s.name) === key)?.category ?? null;
  } catch {
    return null; // Nur eine Verfeinerung: ohne sie nimmt Yuvomi seine Standardkategorie.
  }
}

/**
 * @param {object} api       Yuvomi-API-Client
 * @param {number} listId
 * @param {{ name: string, default_quantity: number }} article
 * @returns {Promise<{ action: 'added'|'reopened'|'increased'|'already', item: object, undo: null | (() => Promise<void>) }>}
 */
export async function addToShoppingList(api, listId, article) {
  const qty = Number.isInteger(article.default_quantity) && article.default_quantity > 0 ? article.default_quantity : 1;
  const key = normalizeName(article.name);

  const res = await api.get(`/shopping/${listId}/items`);
  const existing = (res?.data ?? []).filter((i) => normalizeName(i.name) === key);
  // Gibt es den Namen offen und abgehakt, zaehlt der offene: dort soll die Menge landen.
  const open = existing.find((i) => !i.is_checked);
  const match = open ?? existing[0];

  if (!match) {
    const category = await lastCategory(api, article.name);
    const body = { name: article.name, quantity: String(qty), ...(category ? { category } : {}) };
    let created;
    try {
      created = await api.post(`/shopping/${listId}/items`, body);
    } catch (err) {
      // Die gemerkte Kategorie kann inzwischen geloescht sein - dann ohne.
      if (!category || err?.status !== 400) throw err;
      created = await api.post(`/shopping/${listId}/items`, { name: article.name, quantity: String(qty) });
    }
    const item = created.data;
    return { action: 'added', item, undo: () => api.delete(`/shopping/items/${item.id}`).then(() => {}) };
  }

  // Den Stand VOR der Aenderung festhalten, nicht beim Zuruecknehmen lesen.
  const before = { quantity: match.quantity ?? null, is_checked: Boolean(match.is_checked) };
  const restore = () => api.patch(`/shopping/items/${match.id}`, before).then(() => {});

  if (match.is_checked) {
    const updated = await api.patch(`/shopping/items/${match.id}`, { is_checked: false, quantity: String(qty) });
    return { action: 'reopened', item: updated.data, undo: restore };
  }

  const current = parseCount(match.quantity);
  if (current === null) return { action: 'already', item: match, undo: null };

  const updated = await api.patch(`/shopping/items/${match.id}`, { quantity: String(current + qty) });
  return { action: 'increased', item: updated.data, undo: restore };
}

/**
 * Reiht Aufrufe hintereinander. Zwei schnelle Tipps auf denselben Artikel
 * duerfen die Liste nicht beide als "nicht drauf" lesen und zwei Positionen
 * anlegen.
 */
export function createSerialQueue() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}
