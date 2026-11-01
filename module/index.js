/**
 * FlessingLabs QuickShop - Seite
 *
 * Artikel einmal anlegen, mit einem Tipp auf die Yuvomi-Einkaufsliste setzen.
 *
 * Datenwege (beide ueber Yuvomis /api.js, mit der Sitzung des Mitglieds):
 *   Katalog        -> Yuvomis Modulspeicher /api/v1/modules/flessinglabs-quickshop/records
 *                     (lib/catalog-store.js; braucht Yuvomi mit Migration 274)
 *   Einkaufsliste  -> Yuvomis offizielle API /api/v1/shopping (lib/add-to-list.js)
 *
 * Katalog-Ids sind UUIDs (Strings), Einkaufslisten-Ids Zahlen - beide nie
 * miteinander verwechseln.
 *
 * Bedienung bewusst ohne Dialoge: Das Suchfeld ist zugleich das Anlegefeld,
 * Bearbeiten klappt unter der Zeile auf, Loeschen und Hinzufuegen lassen sich
 * im Toast zuruecknehmen.
 */

import { api } from '/api.js';
import { t, getFormatLocale } from '/i18n.js';
import { esc } from '/utils/html.js';
import { renderPageHeader, renderPageTitle, renderPageActions, renderPageBody, renderPageSection } from '/utils/page-layout.js';
import { showToast } from '/utils/toast-show.js';
import { createCatalogStore, parseImport, importItems } from './lib/catalog-store.js';
import { addToShoppingList, createSerialQueue, normalizeName } from './lib/add-to-list.js';
import { parsePriceInput, formatPrice, priceInputValue } from './lib/price.js';

const ID = 'flessinglabs-quickshop';
const LIST_KEY = `${ID}:list`;
const tr = (key, params) => t(`extensions.${ID}.${key}`, params);

function readStoredList() {
  try { return Number(localStorage.getItem(LIST_KEY)) || null; } catch { return null; }
}
function storeList(id) {
  try { localStorage.setItem(LIST_KEY, String(id)); } catch { /* privates Fenster: dann eben nicht gemerkt */ }
}

function icons(el) {
  if (window.lucide) window.lucide.createIcons({ el });
}

export async function render(container, { signal } = {}) {
  const catalog = createCatalogStore(api);
  const queue = createSerialQueue();
  const locale = getFormatLocale?.() || 'de-DE';

  const state = {
    items: [],
    query: '',
    editingId: null,
    access: 'none',        // Katalog: none | read | write
    shoppingWrite: false,  // Einkaufsliste beschreibbar?
    lists: [],
    listId: null,
  };

  container.replaceChildren();
  container.insertAdjacentHTML('beforeend',
    renderPageHeader({
      title: renderPageTitle(esc(tr('title'))),
      actions: renderPageActions('<div class="qs-target" data-qs="target"></div>'),
    })
    + renderPageBody({
      className: 'qs',
      content: renderPageSection({ content: '<div data-qs="main" aria-busy="true"></div>' }),
    }));
  const main = container.querySelector('[data-qs="main"]');
  const target = container.querySelector('[data-qs="target"]');

  // ------------------------------------------------------------------
  // Laden
  // ------------------------------------------------------------------

  async function load() {
    main.setAttribute('aria-busy', 'true');
    try {
      const [items, coreMe, lists] = await Promise.all([
        catalog.list({ signal }),
        api.get('/auth/me', { signal }),
        api.get('/shopping', { signal }).catch(() => ({ data: [] })),
      ]);
      if (signal?.aborted) return;
      const level = coreMe?.permissions?.modules?.[`ext:${ID}`];
      state.access = coreMe?.permissions?.admin || level === 'write' ? 'write' : level === 'read' ? 'read' : 'none';
      state.items = items;
      state.shoppingWrite = coreMe?.permissions?.modules?.shopping === 'write';
      state.lists = (lists?.data ?? []).filter((l) => l.accepts_new_items !== 0 && l.accepts_new_items !== false);
      const stored = readStoredList();
      state.listId = state.lists.some((l) => l.id === stored) ? stored : (state.lists[0]?.id ?? null);
      renderShell();
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') return;
      renderLoadError(err);
    } finally {
      main.removeAttribute('aria-busy');
    }
  }

  /**
   * Warum der Katalog nicht geladen werden konnte - so genau, wie es sich
   * sagen laesst. Ein Yuvomi ohne Modulspeicher ist kein Netzwerkfehler und
   * bekommt seinen eigenen Satz.
   */
  function renderLoadError(err) {
    const kind = {
      storage_unsupported: 'unsupported',
      storage_unavailable: 'unavailable',
      forbidden: 'forbidden',
    }[err?.reason] ?? 'failed';
    const retry = kind === 'failed' || kind === 'unavailable';
    target.replaceChildren();
    main.replaceChildren();
    main.insertAdjacentHTML('beforeend', `
      <div class="qs-message" role="alert">
        <p class="qs-message__title">${esc(tr(`error.load.${kind}.title`))}</p>
        <p class="qs-message__text">${esc(tr(`error.load.${kind}.text`))}</p>
        ${retry ? `<button type="button" class="btn btn--secondary" data-action="retry">${esc(tr('error.retry'))}</button>` : ''}
      </div>`);
  }

  // ------------------------------------------------------------------
  // Darstellung
  // ------------------------------------------------------------------

  const canWrite = () => state.access === 'write';
  const canAdd = () => state.shoppingWrite && state.listId !== null;

  function renderTarget() {
    target.replaceChildren();
    if (state.lists.length > 1) {
      const options = state.lists.map((l) =>
        `<option value="${l.id}"${l.id === state.listId ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
      target.insertAdjacentHTML('beforeend', `
        <label class="qs-target__label">
          <span class="sr-only">${esc(tr('list.label'))}</span>
          <select class="form-input qs-target__select" data-action="pick-list">${options}</select>
        </label>`);
    } else if (state.lists.length === 1) {
      target.insertAdjacentHTML('beforeend',
        `<span class="qs-target__single">${esc(tr('list.target', { name: state.lists[0].name }))}</span>`);
    }
  }

  function renderShell() {
    renderTarget();
    const hints = [];
    if (!state.shoppingWrite) hints.push(esc(tr('hint.noShopping')));
    else if (state.listId === null) hints.push(`${esc(tr('hint.noList'))} <a href="/shopping">${esc(tr('hint.openShopping'))}</a>`);
    if (!canWrite()) hints.push(esc(tr('hint.readonly')));

    main.replaceChildren();
    main.insertAdjacentHTML('beforeend', `
      <div class="qs-search">
        <label class="sr-only" for="qs-search">${esc(tr('search.label'))}</label>
        <input id="qs-search" class="form-input qs-search__input" type="search" enterkeyhint="go"
               autocomplete="off" autocapitalize="sentences" maxlength="120"
               placeholder="${esc(tr('search.placeholder'))}" value="${esc(state.query)}">
      </div>
      ${hints.map((h) => `<p class="qs-hint">${h}</p>`).join('')}
      <div data-qs="create"></div>
      <ul class="qs-list" data-qs="list" aria-live="polite"></ul>
      ${canWrite() ? importHtml() : ''}`);
    renderList();
  }

  function filtered() {
    const needle = normalizeName(state.query);
    if (!needle) return state.items;
    return state.items.filter((i) => normalizeName(i.name).includes(needle));
  }

  function exactMatch() {
    const key = normalizeName(state.query);
    return key ? state.items.find((i) => normalizeName(i.name) === key) : null;
  }

  function metaText(item) {
    const parts = [tr('meta.quantity', { count: item.default_quantity })];
    if (item.price_cents !== null) parts.push(formatPrice(item.price_cents, locale));
    return parts.join(' · ');
  }

  function rowHtml(item) {
    const editing = state.editingId === item.id;
    const name = esc(item.name);
    const opener = canWrite()
      ? `<button type="button" class="qs-row__main" data-action="edit" aria-expanded="${editing}"
                 aria-label="${esc(tr('edit.aria', { name: item.name }))}">`
      : '<div class="qs-row__main">';
    const openerEnd = canWrite() ? '</button>' : '</div>';
    const add = canAdd()
      ? `<button type="button" class="btn btn--primary qs-row__add" data-action="add"
                 aria-label="${esc(tr('add.aria', { name: item.name }))}"><i data-lucide="plus" aria-hidden="true"></i></button>`
      : '';
    return `
      <li class="qs-row${editing ? ' qs-row--editing' : ''}" data-id="${esc(item.id)}">
        <div class="qs-row__line">
          ${opener}<span class="qs-row__name">${name}</span><span class="qs-row__meta">${esc(metaText(item))}</span>${openerEnd}
          ${add}
        </div>
        ${editing ? editorHtml(item) : ''}
      </li>`;
  }

  function editorHtml(item) {
    return `
      <form class="qs-edit" data-action="save" novalidate>
        <label class="qs-edit__field">
          <span>${esc(tr('field.name'))}</span>
          <input class="form-input" name="name" required maxlength="120" value="${esc(item.name)}">
        </label>
        <div class="qs-edit__row">
          <div class="qs-edit__field">
            <span id="qs-qty-${esc(item.id)}">${esc(tr('field.quantity'))}</span>
            <div class="qs-stepper" role="group" aria-labelledby="qs-qty-${esc(item.id)}">
              <button type="button" class="btn btn--secondary qs-stepper__btn" data-action="qty-down"
                      aria-label="${esc(tr('quantity.less'))}"><i data-lucide="minus" aria-hidden="true"></i></button>
              <input class="form-input qs-stepper__input" name="default_quantity" inputmode="numeric"
                     pattern="[0-9]*" value="${item.default_quantity}" aria-labelledby="qs-qty-${esc(item.id)}">
              <button type="button" class="btn btn--secondary qs-stepper__btn" data-action="qty-up"
                      aria-label="${esc(tr('quantity.more'))}"><i data-lucide="plus" aria-hidden="true"></i></button>
            </div>
          </div>
          <label class="qs-edit__field">
            <span>${esc(tr('field.price'))}</span>
            <input class="form-input" name="price" inputmode="decimal" autocomplete="off"
                   value="${esc(priceInputValue(item.price_cents, locale))}">
          </label>
        </div>
        <p class="qs-edit__error" role="alert" hidden></p>
        <div class="qs-edit__actions">
          <button type="submit" class="btn btn--primary">${esc(tr('action.save'))}</button>
          <button type="button" class="btn btn--secondary" data-action="cancel">${esc(tr('action.cancel'))}</button>
          <button type="button" class="btn btn--danger-outline qs-edit__delete" data-action="delete">
            <i data-lucide="trash-2" aria-hidden="true"></i> ${esc(tr('action.delete'))}</button>
        </div>
      </form>`;
  }

  /** Import aus einer Datei - nur auf ausdruecklichen Wunsch, nie automatisch. */
  function importHtml() {
    return `
      <details class="qs-import">
        <summary>${esc(tr('import.summary'))}</summary>
        <p class="qs-hint">${esc(tr('import.text'))}</p>
        <label class="btn btn--secondary qs-import__pick">
          ${esc(tr('import.pick'))}
          <input type="file" accept="application/json,.json" class="sr-only" data-action="import-file">
        </label>
        <p class="qs-hint" data-qs="import-result" role="status"></p>
      </details>`;
  }

  function renderList() {
    const list = main.querySelector('[data-qs="list"]');
    const create = main.querySelector('[data-qs="create"]');
    if (!list || !create) return;

    create.replaceChildren();
    const q = state.query.trim();
    if (q && canWrite() && !exactMatch()) {
      create.insertAdjacentHTML('beforeend', `
        <button type="button" class="btn btn--secondary qs-create" data-action="create">
          <i data-lucide="plus" aria-hidden="true"></i> ${esc(tr('create.button', { name: q }))}</button>`);
    }

    list.replaceChildren();
    const items = filtered();
    if (items.length) {
      list.insertAdjacentHTML('beforeend', items.map(rowHtml).join(''));
    } else if (!q) {
      list.insertAdjacentHTML('beforeend', `
        <li class="qs-message">
          <p class="qs-message__title">${esc(tr('empty.title'))}</p>
          ${canWrite() ? `<p class="qs-message__text">${esc(tr('empty.text'))}</p>` : ''}
        </li>`);
    } else if (!canWrite()) {
      list.insertAdjacentHTML('beforeend',
        `<li class="qs-message"><p class="qs-message__text">${esc(tr('empty.search', { query: q }))}</p></li>`);
    }
    icons(main);
  }

  // ------------------------------------------------------------------
  // Handlungen
  // ------------------------------------------------------------------

  function errorText(err) {
    const known = {
      item_exists: 'error.exists',
      name_required: 'error.name',
      name_too_long: 'error.nameLong',
      quantity_invalid: 'error.quantity',
      price_invalid: 'error.price',
      conflict: 'error.conflict',
      storage_full: 'error.full',
      forbidden: 'error.forbidden',
    }[err?.reason];
    return tr(known ?? 'error.generic');
  }

  function itemById(id) {
    return state.items.find((i) => i.id === id);
  }

  function sortItems() {
    state.items.sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
  }

  async function addItem(item, button) {
    if (!canAdd()) return;
    button?.setAttribute('aria-busy', 'true');
    try {
      const listId = state.listId;
      const result = await queue(() => addToShoppingList(api, listId, item));
      if (signal?.aborted) return;
      const quantity = result.item?.quantity ?? '';
      const message = tr(`toast.${result.action}`, { name: item.name, quantity });
      showToast(message, result.action === 'already' ? 'default' : 'success', 4000,
        result.undo ? () => { result.undo().catch(() => showToast(tr('error.generic'), 'danger')); } : null);
    } catch (err) {
      if (!signal?.aborted) showToast(tr('error.generic'), 'danger');
    } finally {
      button?.removeAttribute('aria-busy');
    }
  }

  async function createFromQuery() {
    const name = state.query.trim();
    if (!name || !canWrite()) return;
    try {
      const item = await catalog.create({ name, default_quantity: 1 }, state.items);
      if (signal?.aborted) return;
      state.items.push(item);
      sortItems();
      // Der Suchbegriff bleibt stehen: die neue Zeile ist dann die einzige
      // sichtbare, und Enter oder + setzt sie gleich auf die Liste.
      renderList();
      showToast(tr('toast.created', { name: item.name }), 'success');
    } catch (err) {
      if (!signal?.aborted) showToast(errorText(err), 'danger');
    }
  }

  /**
   * Jemand anderes hat den Artikel inzwischen geaendert oder geloescht. Die
   * aktuelle Fassung wird geladen und gezeigt; gespeichert wird erst, wenn die
   * Person es noch einmal will - nie still mit der neuen Revision.
   */
  async function resolveConflict(id) {
    const fresh = await catalog.get(id).catch(() => undefined);
    if (signal?.aborted) return;
    if (fresh === null) {
      state.items = state.items.filter((i) => i.id !== id);
      state.editingId = null;
      renderList();
      showToast(tr('error.goneMeanwhile'), 'warning', 5000);
      return;
    }
    if (fresh) {
      state.items = state.items.map((i) => (i.id === id ? fresh : i));
      sortItems();
    }
    state.editingId = id;
    renderList();
    const errorEl = main.querySelector('.qs-edit__error');
    if (errorEl) { errorEl.textContent = tr('error.conflict'); errorEl.hidden = false; }
  }

  async function saveEdit(form) {
    const id = form.closest('.qs-row')?.dataset.id;
    const current = itemById(id);
    if (!current) return;
    const errorEl = form.querySelector('.qs-edit__error');
    const fail = (text) => { errorEl.textContent = text; errorEl.hidden = false; };

    const name = form.elements.name.value.trim();
    if (!name) return fail(tr('error.name'));
    const quantity = Number(form.elements.default_quantity.value.trim());
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) return fail(tr('error.quantity'));
    const price = parsePriceInput(form.elements.price.value);
    if (Number.isNaN(price)) return fail(tr('error.price'));

    try {
      const updated = await catalog.update(current, { name, default_quantity: quantity, price_cents: price }, state.items);
      if (signal?.aborted) return;
      state.items = state.items.map((i) => (i.id === id ? updated : i));
      sortItems();
      state.editingId = null;
      renderList();
      showToast(tr('toast.saved'), 'success');
    } catch (err) {
      if (signal?.aborted) return;
      if (err?.reason === 'conflict' || err?.reason === 'not_found') return resolveConflict(id);
      fail(errorText(err));
    }
  }

  async function deleteItem(id) {
    const item = itemById(id);
    if (!item) return;
    try {
      await catalog.remove(item);
      if (signal?.aborted) return;
      state.items = state.items.filter((i) => i.id !== id);
      state.editingId = null;
      renderList();
      // Rueckgaengig legt den Artikel neu an (neue Id) - fuer den Katalog ohne
      // Belang, denn auf der Einkaufsliste steht nur der Name.
      showToast(tr('toast.deleted', { name: item.name }), 'default', 5000, async () => {
        try {
          const back = await catalog.create({ name: item.name, default_quantity: item.default_quantity, price_cents: item.price_cents }, state.items);
          if (signal?.aborted) return;
          state.items.push(back);
          sortItems();
          renderList();
        } catch (err) {
          showToast(errorText(err), 'danger');
        }
      });
    } catch (err) {
      if (signal?.aborted) return;
      if (err?.reason === 'conflict' || err?.reason === 'not_found') return resolveConflict(id);
      showToast(errorText(err), 'danger');
    }
  }

  async function runImport(input) {
    const file = input.files?.[0];
    input.value = '';
    const out = main.querySelector('[data-qs="import-result"]');
    if (!file || !out) return;
    out.textContent = tr('import.running');
    try {
      const { items, invalid } = parseImport(await file.text());
      const result = await importItems(catalog, items, state.items);
      if (signal?.aborted) return;
      state.items.push(...result.items);
      sortItems();
      renderList();
      const parts = [tr('import.result', { created: result.created, skipped: result.skipped, invalid: invalid + result.failed })];
      if (result.stoppedBy) parts.push(errorText({ reason: result.stoppedBy }));
      out.textContent = parts.join(' ');
    } catch (err) {
      if (!signal?.aborted) out.textContent = err?.reason === 'import_invalid' ? tr('import.invalid') : errorText(err);
    }
  }

  function stepQuantity(form, delta) {
    const input = form.elements.default_quantity;
    const n = Number(input.value) || 1;
    input.value = String(Math.min(999, Math.max(1, n + delta)));
  }

  // ------------------------------------------------------------------
  // Ereignisse (delegiert, mit dem Abbruchsignal der Seite)
  // ------------------------------------------------------------------

  container.addEventListener('input', (e) => {
    if (e.target.id !== 'qs-search') return;
    state.query = e.target.value;
    state.editingId = null;
    renderList();
  }, { signal });

  container.addEventListener('keydown', (e) => {
    if (e.target.id !== 'qs-search') return;
    if (e.key === 'Escape' && state.query) {
      e.target.value = '';
      state.query = '';
      renderList();
      return;
    }
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const hit = exactMatch();
    if (hit) addItem(hit);
    else if (state.query.trim()) createFromQuery();
  }, { signal });

  container.addEventListener('change', (e) => {
    if (e.target.dataset?.action === 'import-file') { runImport(e.target); return; }
    if (e.target.dataset?.action !== 'pick-list') return;
    state.listId = Number(e.target.value);
    storeList(state.listId);
  }, { signal });

  container.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-action="save"]');
    if (!form) return;
    e.preventDefault();
    saveEdit(form);
  }, { signal });

  container.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !container.contains(el)) return;
    const row = el.closest('.qs-row');
    const id = row ? row.dataset.id : null;
    switch (el.dataset.action) {
      case 'retry': load(); break;
      case 'create': createFromQuery(); break;
      case 'add': addItem(itemById(id), el); break;
      case 'edit':
        state.editingId = state.editingId === id ? null : id;
        renderList();
        if (state.editingId !== null) main.querySelector('.qs-edit input[name="name"]')?.focus();
        break;
      case 'cancel': state.editingId = null; renderList(); break;
      case 'delete': deleteItem(id); break;
      case 'qty-down': stepQuantity(el.closest('form'), -1); break;
      case 'qty-up': stepQuantity(el.closest('form'), +1); break;
      default: break;
    }
  }, { signal });

  await load();
}
