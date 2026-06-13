import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateEstimateTotals,
  calculateLaborLine,
  calculateMaterialLine,
  dollarsToCents,
} from '../admin/js/estimate-calculator.js';

test('converts dollars to integer cents', () => {
  assert.equal(dollarsToCents('125.99'), 12599);
  assert.equal(dollarsToCents('0.005'), 1);
});

test('calculates material quantity and markup', () => {
  assert.equal(calculateMaterialLine({
    quantity: 2,
    unitPrice: 100,
    markup: 25,
  }), 25000);
});

test('calculates labor hours and rate', () => {
  assert.equal(calculateLaborLine({
    hours: 2.5,
    hourlyRate: 150,
  }), 37500);
});

test('calculates discount, tax and total', () => {
  const result = calculateEstimateTotals(
    [{ quantity: 2, unitPrice: 100, markup: 25 }],
    [{ hours: 2.5, hourlyRate: 150 }],
    25,
    7,
  );

  assert.deepEqual(result, {
    materialsCents: 25000,
    laborCents: 37500,
    subtotalCents: 62500,
    discountCents: 2500,
    taxCents: 4200,
    totalCents: 64200,
  });
});

test('never taxes a negative discounted subtotal', () => {
  const result = calculateEstimateTotals([], [], 100, 7);
  assert.equal(result.taxCents, 0);
  assert.equal(result.totalCents, 0);
});
