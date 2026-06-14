import { supabase } from './supabase-client.js';
import { initializePageShell, normalizeOptional, setFormMessage } from './page-shell.js';
import {
  calculateEstimateTotals,
  calculateLaborLine,
  calculateMaterialLine,
  dollarsToCents,
  formatMoney,
} from './estimate-calculator.js';

const profile = await initializePageShell();
const form = document.querySelector('#estimate-form');
const message = document.querySelector('#estimate-message');
const customerSelect = form.elements.customerId;
const vesselSelect = form.elements.vesselId;
const materialsBody = document.querySelector('#materials-body');
const laborBody = document.querySelector('#labor-body');
const downloadLink = document.querySelector('#download-pdf');
const sendButton = document.querySelector('#send-estimate-email');
const deliveryPanel = document.querySelector('#email-delivery-panel');
const deliveryRecipient = document.querySelector('#email-delivery-recipient');
const deliveryList = document.querySelector('#email-delivery-list');
const params = new URLSearchParams(window.location.search);
let estimateId = params.get('id');
let customers = [];
let vessels = [];
let currentVersion = 0;
let hasCurrentPdf = false;

function updatePreviewLink() {
  const link = document.querySelector('#preview-estimate');
  if (!estimateId) {
    link.hidden = true;
    link.removeAttribute('href');
    return;
  }
  link.href = `./estimate-preview.html?id=${encodeURIComponent(estimateId)}`;
  link.hidden = false;
}

function optionalNumber(value) {
  return value === '' ? null : Number(value);
}

function rowValues(body) {
  return [...body.querySelectorAll('tr')].map((row) => (
    Object.fromEntries(
      [...row.querySelectorAll('[data-field]')]
        .filter((field) => field.matches('input'))
        .map((field) => [field.dataset.field, field.value])
    )
  ));
}

function updateTotals() {
  const materials = rowValues(materialsBody);
  const labor = rowValues(laborBody);
  const totals = calculateEstimateTotals(
    materials,
    labor,
    form.elements.discount.value,
    form.elements.taxRate.value,
  );

  [...materialsBody.querySelectorAll('tr')].forEach((row, index) => {
    row.querySelector('[data-field="lineTotal"]').textContent =
      formatMoney(calculateMaterialLine(materials[index]));
  });
  [...laborBody.querySelectorAll('tr')].forEach((row, index) => {
    row.querySelector('[data-field="lineTotal"]').textContent =
      formatMoney(calculateLaborLine(labor[index]));
  });

  document.querySelector('#materials-total').textContent = formatMoney(totals.materialsCents);
  document.querySelector('#labor-total').textContent = formatMoney(totals.laborCents);
  document.querySelector('#subtotal').textContent = formatMoney(totals.subtotalCents);
  document.querySelector('#discount-total').textContent = `-${formatMoney(totals.discountCents)}`;
  document.querySelector('#tax-total').textContent = formatMoney(totals.taxCents);
  document.querySelector('#grand-total').textContent = formatMoney(totals.totalCents);
}

function addLine(type, data = {}) {
  const isMaterial = type === 'material';
  const template = document.querySelector(isMaterial ? '#material-row-template' : '#labor-row-template');
  const body = isMaterial ? materialsBody : laborBody;
  const row = template.content.firstElementChild.cloneNode(true);

  for (const [key, value] of Object.entries(data)) {
    const input = row.querySelector(`[data-field="${key}"]`);
    if (input) {
      input.value = value ?? '';
    }
  }

  row.querySelectorAll('input').forEach((input) => input.addEventListener('input', updateTotals));
  row.querySelector('.remove-line').addEventListener('click', () => {
    invalidateGeneratedOutput();
    row.remove();
    updateTotals();
  });
  body.append(row);
  updateTotals();
}

function customerLabel(customer) {
  return customer.company_name
    ? `${customer.contact_name} - ${customer.company_name}`
    : customer.contact_name;
}

function selectedCustomerEmail() {
  return customers.find((customer) => customer.id === customerSelect.value)?.email?.trim() || '';
}

function setCurrentPdfAvailable(available) {
  hasCurrentPdf = available;
  downloadLink.hidden = !available;
  sendButton.hidden = !available;
  deliveryPanel.hidden = !available;
  if (available) {
    const email = selectedCustomerEmail();
    deliveryRecipient.textContent = email
      ? `Quote delivery to ${email}`
      : 'Add a valid email to the selected customer before sending.';
    sendButton.disabled = !email;
  }
}

function invalidateGeneratedOutput() {
  if (!hasCurrentPdf) return;
  setCurrentPdfAvailable(false);
  downloadLink.removeAttribute('href');
}

function populateCustomers() {
  customerSelect.replaceChildren(new Option('Select customer', ''));
  for (const customer of customers) {
    customerSelect.add(new Option(customerLabel(customer), customer.id));
  }
}

function populateVessels(selectedId = '') {
  const customerId = customerSelect.value;
  const available = vessels.filter((vessel) => vessel.customer_id === customerId);
  vesselSelect.replaceChildren(new Option('Select vessel', ''));
  for (const vessel of available) {
    const label = vessel.vessel_name
      || [vessel.manufacturer, vessel.model].filter(Boolean).join(' ')
      || vessel.registration_number;
    vesselSelect.add(new Option(label, vessel.id));
  }
  vesselSelect.disabled = !customerId;
  vesselSelect.value = selectedId;
}

async function loadDirectories() {
  const [customerResult, vesselResult] = await Promise.all([
    supabase
      .from('customers')
      .select('id, contact_name, company_name, email')
      .is('archived_at', null)
      .order('contact_name'),
    supabase
      .from('vessels')
      .select('id, customer_id, vessel_name, manufacturer, model, registration_number')
      .is('archived_at', null),
  ]);
  if (customerResult.error || vesselResult.error) {
    throw new Error('Unable to load customers and vessels.');
  }
  customers = customerResult.data;
  vessels = vesselResult.data;
  populateCustomers();
}

async function loadEstimate() {
  if (!estimateId) {
    addLine('material');
    addLine('labor');
    updatePreviewLink();
    return;
  }

  const { data, error } = await supabase
    .from('estimates')
    .select('*, estimate_materials(*), estimate_labor(*)')
    .eq('id', estimateId)
    .single();
  if (error) {
    throw new Error('Unable to load the estimate.');
  }

  document.querySelector('#estimate-title').textContent = data.estimate_number;
  document.querySelector('#estimate-status').textContent = `Last updated ${new Date(data.updated_at).toLocaleString()}`;
  currentVersion = data.current_version;
  customerSelect.value = data.customer_id;
  populateVessels(data.vessel_id);
  form.elements.jobDescription.value = data.job_description ?? '';
  form.elements.recommendedWork.value = data.recommended_work ?? '';
  form.elements.customerNotes.value = data.customer_notes ?? '';
  form.elements.internalNotes.value = data.internal_notes ?? '';
  form.elements.discount.value = (data.discount_cents / 100).toFixed(2);
  form.elements.taxRate.value = data.tax_rate;
  form.elements.validityDays.value = data.validity_days;

  materialsBody.replaceChildren();
  for (const item of data.estimate_materials.sort((a, b) => a.sort_order - b.sort_order)) {
    addLine('material', {
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: (item.unit_price_cents / 100).toFixed(2),
      markup: item.markup_percent,
    });
  }
  laborBody.replaceChildren();
  for (const item of data.estimate_labor.sort((a, b) => a.sort_order - b.sort_order)) {
    addLine('labor', {
      description: item.description,
      hours: item.hours,
      hourlyRate: (item.hourly_rate_cents / 100).toFixed(2),
    });
  }
  if (!data.estimate_materials.length) addLine('material');
  if (!data.estimate_labor.length) addLine('labor');
  updateTotals();
  updatePreviewLink();

  if (data.status === 'generated' || data.status === 'sent') {
    await loadCurrentPdf(data.current_version);
    await loadDeliveries();
  }
}

async function loadCurrentPdf(versionNumber) {
  const { data, error } = await supabase
    .from('estimate_documents')
    .select('storage_path')
    .eq('estimate_id', estimateId)
    .eq('version_number', versionNumber)
    .maybeSingle();
  if (error || !data) {
    setCurrentPdfAvailable(false);
    return false;
  }

  const { data: signedData } = await supabase.storage
    .from('estimate-pdfs')
    .createSignedUrl(data.storage_path, 600);
  if (signedData?.signedUrl) {
    downloadLink.href = signedData.signedUrl;
    setCurrentPdfAvailable(true);
    return true;
  }
  setCurrentPdfAvailable(false);
  return false;
}

function renderDeliveries(deliveries) {
  deliveryList.replaceChildren();
  if (!deliveries.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No delivery attempts yet.';
    deliveryList.append(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead><tr><th>Recipient</th><th>Status</th><th>Requested</th></tr></thead>
    <tbody></tbody>
  `;
  const body = table.querySelector('tbody');
  for (const delivery of deliveries) {
    const row = document.createElement('tr');
    const recipient = document.createElement('td');
    recipient.textContent = delivery.recipient_email;
    const statusCell = document.createElement('td');
    const status = document.createElement('span');
    status.className = `delivery-status ${delivery.status}`;
    status.textContent = delivery.status;
    statusCell.append(status);
    const requested = document.createElement('td');
    requested.textContent = new Date(delivery.queued_at).toLocaleString();
    row.append(recipient, statusCell, requested);
    body.append(row);
  }
  deliveryList.append(table);
}

async function loadDeliveries() {
  if (!estimateId) return;
  const { data, error } = await supabase
    .from('estimate_deliveries')
    .select('id, recipient_email, status, queued_at, sent_at, failed_at')
    .eq('estimate_id', estimateId)
    .order('created_at', { ascending: false });
  if (!error) renderDeliveries(data);
}

async function saveEstimate() {
  message.hidden = true;
  if (!form.reportValidity()) {
    return null;
  }

  const materials = rowValues(materialsBody)
    .filter((item) => item.description.trim())
    .map((item, index) => ({
      estimate_id: estimateId,
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unit: item.unit.trim(),
      unit_price_cents: dollarsToCents(item.unitPrice),
      markup_percent: Number(item.markup) || 0,
      sort_order: index,
    }));
  const labor = rowValues(laborBody)
    .filter((item) => item.description.trim())
    .map((item, index) => ({
      estimate_id: estimateId,
      description: item.description.trim(),
      hours: Number(item.hours),
      hourly_rate_cents: dollarsToCents(item.hourlyRate),
      sort_order: index,
    }));

  const { data, error } = await supabase.rpc('save_estimate', {
    p_estimate_id: estimateId,
    p_customer_id: customerSelect.value,
    p_vessel_id: vesselSelect.value,
    p_job_description: normalizeOptional(form.elements.jobDescription.value),
    p_recommended_work: normalizeOptional(form.elements.recommendedWork.value),
    p_customer_notes: normalizeOptional(form.elements.customerNotes.value),
    p_internal_notes: normalizeOptional(form.elements.internalNotes.value),
    p_discount_cents: dollarsToCents(form.elements.discount.value),
    p_tax_rate: optionalNumber(form.elements.taxRate.value) ?? 0,
    p_validity_days: Number(form.elements.validityDays.value),
    p_materials: materials,
    p_labor: labor,
  });
  if (error) throw error;

  setCurrentPdfAvailable(false);
  downloadLink.removeAttribute('href');
  estimateId = data.id;
  currentVersion = data.current_version;
  document.querySelector('#estimate-title').textContent = data.estimate_number;
  window.history.replaceState({}, '', `./estimate.html?id=${estimateId}`);
  updatePreviewLink();
  setFormMessage(message, 'Estimate saved.');
  document.querySelector('#estimate-status').textContent =
    `Version ${data.current_version} saved ${new Date().toLocaleString()}`;
  return data;
}

customerSelect.addEventListener('change', () => {
  populateVessels();
  invalidateGeneratedOutput();
});
vesselSelect.addEventListener('change', invalidateGeneratedOutput);
document.querySelector('#add-material').addEventListener('click', () => {
  invalidateGeneratedOutput();
  addLine('material');
});
document.querySelector('#add-labor').addEventListener('click', () => {
  invalidateGeneratedOutput();
  addLine('labor');
});
form.elements.discount.addEventListener('input', updateTotals);
form.elements.taxRate.addEventListener('input', updateTotals);
document.querySelector('#save-estimate').addEventListener('click', async () => {
  const button = document.querySelector('#save-estimate');
  button.disabled = true;
  try {
    await saveEstimate();
  } catch (error) {
    console.error(error);
    setFormMessage(message, 'Unable to save the estimate. No data was intentionally discarded.', true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#generate-pdf').addEventListener('click', async () => {
  const button = document.querySelector('#generate-pdf');
  button.disabled = true;
  setCurrentPdfAvailable(false);
  try {
    const savedEstimate = await saveEstimate();
    if (!savedEstimate) return;
    const { data, error } = await supabase.functions.invoke('generate-estimate-pdf', {
      body: { estimateId },
    });
    if (error || !data?.signedUrl) {
      throw error ?? new Error('PDF URL missing');
    }
    currentVersion = data.version;
    downloadLink.href = data.signedUrl;
    setCurrentPdfAvailable(true);
    await loadDeliveries();
    setFormMessage(message, 'PDF generated. Use Download PDF to open it.');
    document.querySelector('#estimate-status').textContent =
      `Version ${data.version} PDF generated ${new Date().toLocaleString()}`;
  } catch (error) {
    console.error(error);
    setFormMessage(message, 'Unable to generate the PDF.', true);
  } finally {
    button.disabled = false;
  }
});

sendButton.addEventListener('click', async () => {
  message.hidden = true;
  const recipientEmail = selectedCustomerEmail();
  if (!estimateId || !hasCurrentPdf || !recipientEmail) {
    setFormMessage(message, 'Generate the current PDF and confirm the customer email before sending.', true);
    return;
  }
  if (!window.confirm(`Send the current estimate PDF to ${recipientEmail}?`)) {
    return;
  }

  sendButton.disabled = true;
  sendButton.textContent = 'Sending...';
  setFormMessage(message, `Sending quote to ${recipientEmail}...`);
  try {
    const { data, error } = await supabase.functions.invoke('send-estimate-email', {
      body: { estimateId, recipientEmail },
    });
    if (error || data?.status !== 'sent') {
      throw error ?? new Error('Email delivery failed');
    }
    setFormMessage(message, `Quote sent successfully to ${data.recipientEmail}.`);
    document.querySelector('#estimate-status').textContent =
      `Version ${currentVersion} · sent · ${new Date().toLocaleString()}`;
  } catch (error) {
    console.error(error);
    setFormMessage(message, 'Unable to send the quote. Review the email history and try again.', true);
  } finally {
    await loadDeliveries();
    sendButton.disabled = !selectedCustomerEmail();
    sendButton.textContent = 'Send Email';
  }
});

form.addEventListener('input', invalidateGeneratedOutput);

try {
  await loadDirectories();
  await loadEstimate();
} catch (error) {
  console.error(error);
  setFormMessage(message, error.message, true);
}
