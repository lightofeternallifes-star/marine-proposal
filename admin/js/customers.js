import { supabase } from './supabase-client.js';
import { initializePageShell, normalizeOptional, setFormMessage } from './page-shell.js';

const profile = await initializePageShell();
const list = document.querySelector('#customer-list');
const search = document.querySelector('#customer-search');
const editor = document.querySelector('#customer-editor');
const editorTitle = document.querySelector('#customer-editor-title');
const form = document.querySelector('#customer-form');
const formMessage = document.querySelector('#customer-form-message');
const archiveButton = document.querySelector('#archive-customer');
const crmSummary = document.querySelector('#customer-crm-summary');
const params = new URLSearchParams(window.location.search);
let customers = [];

const stageLabels = {
  lead: 'Lead',
  qualified: 'Qualified',
  appointment_scheduled: 'Appointment Scheduled',
  estimate_sent: 'Estimate Sent',
  approved: 'Approved',
  won: 'Won',
  lost: 'Lost',
};

function customerLabel(customer) {
  return customer.company_name
    ? `${customer.contact_name} - ${customer.company_name}`
    : customer.contact_name;
}

function renderCustomers() {
  const term = search.value.trim().toLowerCase();
  const filtered = customers.filter((customer) => (
    [
      customer.contact_name,
      customer.company_name,
      customer.email,
      customer.phone,
    ].some((value) => value?.toLowerCase().includes(term))
  ));

  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = term ? 'No matching customers.' : 'No customers yet.';
    list.append(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead>
      <tr><th>Customer</th><th>Email</th><th>Phone</th><th>Updated</th><th></th></tr>
    </thead>
    <tbody></tbody>
  `;

  const body = table.querySelector('tbody');
  for (const customer of filtered) {
    const row = document.createElement('tr');
    const cells = [
      customerLabel(customer),
      customer.email ?? '-',
      customer.phone ?? '-',
      new Date(customer.updated_at).toLocaleDateString(),
    ];
    for (const value of cells) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const actionCell = document.createElement('td');
    const editButton = document.createElement('button');
    editButton.className = 'table-action';
    editButton.type = 'button';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', () => openEditor(customer));
    actionCell.append(editButton);
    row.append(actionCell);
    body.append(row);
  }
  list.append(table);
}

async function loadCustomers() {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .is('archived_at', null)
    .order('contact_name');

  if (error) {
    list.innerHTML = '<p class="empty-state">Unable to load customers.</p>';
    return;
  }
  customers = data;
  renderCustomers();
}

async function loadCustomerCrmSummary(customerId) {
  if (!customerId) {
    crmSummary.hidden = true;
    return;
  }

  const [pipelineResult, estimatesResult] = await Promise.all([
    supabase
      .from('sales_pipeline')
      .select('stage, updated_at')
      .eq('customer_id', customerId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('estimates')
      .select('estimate_number, status, updated_at')
      .eq('customer_id', customerId)
      .order('updated_at', { ascending: false }),
  ]);

  if (pipelineResult.error) {
    console.warn('[Customers] Pipeline summary unavailable:', pipelineResult.error.message);
  }
  if (estimatesResult.error) {
    console.warn('[Customers] Estimate summary unavailable:', estimatesResult.error.message);
  }

  const pipelineStage = pipelineResult.data?.stage;
  const estimates = estimatesResult.data ?? [];
  const lastEstimate = estimates[0];
  document.querySelector('#customer-pipeline-stage').textContent =
    pipelineStage ? stageLabels[pipelineStage] : 'No pipeline record';
  document.querySelector('#customer-last-estimate').textContent =
    lastEstimate ? `${lastEstimate.estimate_number} · ${lastEstimate.status}` : 'No estimates';
  document.querySelector('#customer-total-estimates').textContent = estimates.length;
  document.querySelector('#customer-crm-status').textContent =
    pipelineStage ? stageLabels[pipelineStage] : (estimates.length ? 'Estimate customer' : 'Customer only');
  crmSummary.hidden = false;
}

function openEditor(customer = null) {
  form.reset();
  formMessage.hidden = true;
  editor.hidden = false;
  editorTitle.textContent = customer ? 'Edit customer' : 'New customer';
  archiveButton.hidden = !customer;

  if (customer) {
    const address = customer.billing_address ?? {};
    form.elements.id.value = customer.id;
    form.elements.contactName.value = customer.contact_name;
    form.elements.companyName.value = customer.company_name ?? '';
    form.elements.email.value = customer.email ?? '';
    form.elements.phone.value = customer.phone ?? '';
    form.elements.street.value = address.street ?? '';
    form.elements.city.value = address.city ?? '';
    form.elements.state.value = address.state ?? '';
    form.elements.postalCode.value = address.postal_code ?? '';
    form.elements.country.value = address.country ?? '';
    form.elements.notes.value = customer.notes ?? '';
    loadCustomerCrmSummary(customer.id);
  } else {
    form.elements.id.value = '';
    form.elements.country.value = 'United States';
    crmSummary.hidden = true;
  }

  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formMessage.hidden = true;
  if (!form.reportValidity()) {
    return;
  }

  const id = form.elements.id.value;
  const payload = {
    contact_name: form.elements.contactName.value.trim(),
    company_name: normalizeOptional(form.elements.companyName.value),
    email: normalizeOptional(form.elements.email.value),
    phone: normalizeOptional(form.elements.phone.value),
    billing_address: {
      street: normalizeOptional(form.elements.street.value),
      city: normalizeOptional(form.elements.city.value),
      state: normalizeOptional(form.elements.state.value),
      postal_code: normalizeOptional(form.elements.postalCode.value),
      country: normalizeOptional(form.elements.country.value),
    },
    notes: normalizeOptional(form.elements.notes.value),
    updated_by: profile.id,
  };

  const query = id
    ? supabase.from('customers').update(payload).eq('id', id)
    : supabase.from('customers').insert({ ...payload, created_by: profile.id });
  const { error } = await query;

  if (error) {
    setFormMessage(formMessage, 'Unable to save the customer.', true);
    return;
  }

  setFormMessage(formMessage, 'Customer saved.');
  await loadCustomers();
  window.setTimeout(() => { editor.hidden = true; }, 500);
});

archiveButton.addEventListener('click', async () => {
  const id = form.elements.id.value;
  if (!id || !window.confirm('Archive this customer? Existing estimates will be retained.')) {
    return;
  }
  const { error } = await supabase
    .from('customers')
    .update({ archived_at: new Date().toISOString(), updated_by: profile.id })
    .eq('id', id);
  if (error) {
    setFormMessage(formMessage, 'Unable to archive the customer.', true);
    return;
  }
  editor.hidden = true;
  await loadCustomers();
});

document.querySelector('#new-customer').addEventListener('click', () => openEditor());
document.querySelector('#close-customer-editor').addEventListener('click', () => { editor.hidden = true; });
search.addEventListener('input', renderCustomers);
await loadCustomers();

const requestedCustomerId = params.get('customerId');
if (requestedCustomerId) {
  const customer = customers.find((item) => item.id === requestedCustomerId);
  if (customer) openEditor(customer);
}
