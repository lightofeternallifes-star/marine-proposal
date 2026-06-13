import { supabase } from './supabase-client.js';
import { formatMoney } from './estimate-calculator.js';
import { initializePageShell, setFormMessage } from './page-shell.js';

await initializePageShell();

const params = new URLSearchParams(window.location.search);
const estimateId = params.get('id');
const message = document.querySelector('#preview-message');
const generateButton = document.querySelector('#preview-generate-pdf');
const downloadLink = document.querySelector('#preview-download-pdf');
const deliveryPanel = document.querySelector('#email-delivery-panel');
const deliveryForm = document.querySelector('#email-delivery-form');
const deliveryMessage = document.querySelector('#delivery-message');
const deliveryList = document.querySelector('#delivery-list');
const sendButton = document.querySelector('#send-estimate-email');
let currentVersion = 0;

function addDetail(container, label, value) {
  const row = document.createElement('div');
  const term = document.createElement('dt');
  const detail = document.createElement('dd');
  term.textContent = label;
  detail.textContent = value || '-';
  row.append(term, detail);
  container.append(row);
}

function addLine(container, values) {
  const row = document.createElement('tr');
  for (const value of values) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  }
  container.append(row);
}

async function loadCurrentPdf() {
  const { data, error } = await supabase
    .from('estimate_documents')
    .select('storage_path')
    .eq('estimate_id', estimateId)
    .eq('version_number', currentVersion)
    .maybeSingle();
  if (error || !data) return false;

  const { data: signedData } = await supabase.storage
    .from('estimate-pdfs')
    .createSignedUrl(data.storage_path, 600);
  if (signedData?.signedUrl) {
    downloadLink.href = signedData.signedUrl;
    downloadLink.hidden = false;
    deliveryPanel.hidden = false;
    return true;
  }
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

async function loadEstimate() {
  if (!estimateId) {
    throw new Error('Select an estimate before opening the preview.');
  }

  const { data, error } = await supabase
    .from('estimates')
    .select(`
      *,
      customers(contact_name, company_name, email, phone, billing_address),
      vessels(vessel_name, vessel_type, manufacturer, model, year, length_feet, registration_number, location),
      estimate_materials(description, quantity, unit, unit_price_cents, line_total_cents, sort_order),
      estimate_labor(description, hours, hourly_rate_cents, line_total_cents, sort_order)
    `)
    .eq('id', estimateId)
    .single();
  if (error || !data) {
    throw new Error('Unable to load the estimate preview.');
  }

  currentVersion = data.current_version;
  deliveryForm.elements.recipientEmail.value = data.customers.email || '';
  document.querySelector('#preview-number').textContent = data.estimate_number;
  document.querySelector('#document-number').textContent = data.estimate_number;
  document.querySelector('#preview-status').textContent =
    `Version ${data.current_version} · ${data.status} · Updated ${new Date(data.updated_at).toLocaleString()}`;
  document.querySelector('#edit-estimate').href =
    `./estimate.html?id=${encodeURIComponent(data.id)}`;

  const customer = document.querySelector('#preview-customer');
  addDetail(customer, 'Customer', data.customers.company_name || data.customers.contact_name);
  if (data.customers.company_name) addDetail(customer, 'Contact', data.customers.contact_name);
  addDetail(customer, 'Email', data.customers.email);
  addDetail(customer, 'Phone', data.customers.phone);

  const vessel = document.querySelector('#preview-vessel');
  addDetail(
    vessel,
    'Vessel',
    data.vessels.vessel_name
      || [data.vessels.manufacturer, data.vessels.model].filter(Boolean).join(' ')
      || data.vessels.registration_number,
  );
  addDetail(vessel, 'Type', data.vessels.vessel_type);
  addDetail(
    vessel,
    'Manufacturer / Model',
    [data.vessels.manufacturer, data.vessels.model].filter(Boolean).join(' '),
  );
  addDetail(vessel, 'Location', data.vessels.location);

  document.querySelector('#preview-job-description').textContent =
    data.job_description || 'No job description provided.';
  document.querySelector('#preview-recommended-work').textContent =
    data.recommended_work || 'No recommended work provided.';
  document.querySelector('#preview-notes').textContent =
    data.customer_notes || 'No customer-facing notes.';
  document.querySelector('#preview-validity').textContent =
    `This estimate is valid for ${data.validity_days} days from the generated date.`;

  const materials = document.querySelector('#preview-materials');
  for (const item of data.estimate_materials.sort((a, b) => a.sort_order - b.sort_order)) {
    addLine(materials, [
      item.description,
      `${item.quantity} ${item.unit}`,
      formatMoney(item.unit_price_cents, data.currency),
      formatMoney(item.line_total_cents, data.currency),
    ]);
  }

  const labor = document.querySelector('#preview-labor');
  for (const item of data.estimate_labor.sort((a, b) => a.sort_order - b.sort_order)) {
    addLine(labor, [
      item.description,
      String(item.hours),
      formatMoney(item.hourly_rate_cents, data.currency),
      formatMoney(item.line_total_cents, data.currency),
    ]);
  }

  document.querySelector('#preview-materials-total').textContent =
    formatMoney(data.materials_subtotal_cents, data.currency);
  document.querySelector('#preview-labor-total').textContent =
    formatMoney(data.labor_subtotal_cents, data.currency);
  document.querySelector('#preview-subtotal').textContent =
    formatMoney(data.subtotal_cents, data.currency);
  document.querySelector('#preview-discount').textContent =
    `-${formatMoney(data.discount_cents, data.currency)}`;
  document.querySelector('#preview-tax').textContent =
    formatMoney(data.tax_cents, data.currency);
  document.querySelector('#preview-total').textContent =
    formatMoney(data.total_cents, data.currency);

  document.querySelector('#estimate-preview').hidden = false;
  await loadCurrentPdf();
  await loadDeliveries();
}

generateButton.addEventListener('click', async () => {
  generateButton.disabled = true;
  downloadLink.hidden = true;
  message.hidden = true;
  try {
    const { data, error } = await supabase.functions.invoke('generate-estimate-pdf', {
      body: { estimateId },
    });
    if (error || !data?.signedUrl) {
      throw error ?? new Error('PDF URL missing');
    }
    currentVersion = data.version;
    downloadLink.href = data.signedUrl;
    downloadLink.hidden = false;
    deliveryPanel.hidden = false;
    setFormMessage(message, 'PDF generated. Use Download PDF to open it.');
  } catch (error) {
    console.error(error);
    setFormMessage(message, 'Unable to generate the PDF.', true);
  } finally {
    generateButton.disabled = false;
  }
});

deliveryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  deliveryMessage.hidden = true;
  if (!deliveryForm.reportValidity()) return;

  const recipientEmail = deliveryForm.elements.recipientEmail.value.trim();
  if (!window.confirm(`Send the current estimate PDF to ${recipientEmail}?`)) {
    return;
  }

  sendButton.disabled = true;
  sendButton.textContent = 'Sending...';
  setFormMessage(deliveryMessage, 'Email queued for delivery.');
  try {
    const { data, error } = await supabase.functions.invoke('send-estimate-email', {
      body: { estimateId, recipientEmail },
    });
    if (error || data?.status !== 'sent') {
      throw error ?? new Error('Email delivery failed');
    }
    setFormMessage(deliveryMessage, `Estimate sent to ${data.recipientEmail}.`);
    document.querySelector('#preview-status').textContent =
      `Version ${currentVersion} · sent · ${new Date().toLocaleString()}`;
  } catch (error) {
    console.error(error);
    setFormMessage(deliveryMessage, 'Email delivery failed. Review the status and try again.', true);
  } finally {
    await loadDeliveries();
    sendButton.disabled = false;
    sendButton.textContent = 'Send Email';
  }
});

try {
  await loadEstimate();
} catch (error) {
  console.error(error);
  generateButton.hidden = true;
  setFormMessage(message, error.message, true);
}
