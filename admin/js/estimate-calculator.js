export function dollarsToCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function centsToDollars(cents) {
  return (Number(cents) || 0) / 100;
}

export function formatMoney(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(centsToDollars(cents));
}

export function calculateMaterialLine(item) {
  const quantity = Number(item.quantity) || 0;
  const unitPriceCents = dollarsToCents(item.unitPrice);
  const markupPercent = Number(item.markup) || 0;
  return Math.round(quantity * unitPriceCents * (1 + markupPercent / 100));
}

export function calculateLaborLine(item) {
  const hours = Number(item.hours) || 0;
  const hourlyRateCents = dollarsToCents(item.hourlyRate);
  return Math.round(hours * hourlyRateCents);
}

export function calculateEstimateTotals(materials, labor, discount, taxRate) {
  const materialsCents = materials.reduce((total, item) => total + calculateMaterialLine(item), 0);
  const laborCents = labor.reduce((total, item) => total + calculateLaborLine(item), 0);
  const subtotalCents = materialsCents + laborCents;
  const discountCents = Math.max(dollarsToCents(discount), 0);
  const taxableCents = Math.max(subtotalCents - discountCents, 0);
  const normalizedTaxRate = Math.max(Number(taxRate) || 0, 0);
  const taxCents = Math.round(taxableCents * normalizedTaxRate / 100);

  return {
    materialsCents,
    laborCents,
    subtotalCents,
    discountCents,
    taxCents,
    totalCents: taxableCents + taxCents,
  };
}
