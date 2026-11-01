import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePriceInput, formatPrice, priceInputValue } from '../../module/lib/price.js';

test('parsePriceInput reads German and English decimals', () => {
  assert.equal(parsePriceInput('1,99'), 199);
  assert.equal(parsePriceInput('1.99'), 199);
  assert.equal(parsePriceInput('2'), 200);
  assert.equal(parsePriceInput('0,5'), 50);
  assert.equal(parsePriceInput(' 3,49 € '), 349);
  assert.equal(parsePriceInput(''), null);
  assert.equal(parsePriceInput(null), null);
  assert.ok(Number.isNaN(parsePriceInput('abc')));
  assert.ok(Number.isNaN(parsePriceInput('1,999')));
  assert.ok(Number.isNaN(parsePriceInput('-1')));
});

test('formatPrice and priceInputValue round-trip', () => {
  assert.match(formatPrice(199, 'de-DE'), /^1,99\s€$/);
  assert.equal(formatPrice(null), '');
  assert.equal(priceInputValue(199, 'de-DE'), '1,99');
  assert.equal(parsePriceInput(priceInputValue(123456, 'de-DE')), 123456);
});
