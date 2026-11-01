/**
 * QuickShop - Preise in Euro: Eingabe lesen, Anzeige formatieren.
 * Gespeichert wird in ganzen Cent, damit kein Rundungsfehler entsteht.
 */

/**
 * "1,99" / "1.99" / "2" / "2 €" -> Cent. Leer -> null. Unlesbar -> NaN.
 * Ein Tausenderpunkt wird nicht unterstuetzt: Einkaufsartikel kosten keine 1.000 €,
 * und "1.990" waere sonst mehrdeutig.
 */
export function parsePriceInput(raw) {
  const s = String(raw ?? '').replace(/€|eur/gi, '').trim();
  if (!s) return null;
  const m = s.match(/^([0-9]{1,6})(?:[.,]([0-9]{1,2}))?$/);
  if (!m) return NaN;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
  return cents;
}

/** Cent -> "1,99 €" im Format der Oberflaechensprache. */
export function formatPrice(cents, locale = 'de-DE') {
  if (cents === null || cents === undefined) return '';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

/** Cent -> Text fuer das Eingabefeld ("1,99"), ohne Waehrungszeichen. */
export function priceInputValue(cents, locale = 'de-DE') {
  if (cents === null || cents === undefined) return '';
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(cents / 100);
}
