import { supabase } from './supabase-client.js';
import { initializePageShell, normalizeOptional, setFormMessage } from './page-shell.js';

const profile = await initializePageShell();
const list = document.querySelector('#vessel-list');
const search = document.querySelector('#vessel-search');
const editor = document.querySelector('#vessel-editor');
const editorTitle = document.querySelector('#vessel-editor-title');
const form = document.querySelector('#vessel-form');
const formMessage = document.querySelector('#vessel-form-message');
const archiveButton = document.querySelector('#archive-vessel');
let vessels = [];
let customers = [];

function vesselLabel(vessel) {
  if (vessel.vessel_name) {
    return vessel.vessel_name;
  }
  return [vessel.manufacturer, vessel.model].filter(Boolean).join(' ') || vessel.registration_number;
}

function customerLabel(customer) {
  return customer.company_name
    ? `${customer.contact_name} - ${customer.company_name}`
    : customer.contact_name;
}

function renderVessels() {
  const term = search.value.trim().toLowerCase();
  const filtered = vessels.filter((vessel) => (
    [
      vesselLabel(vessel),
      vessel.registration_number,
      vessel.manufacturer,
      vessel.model,
      vessel.customers?.contact_name,
      vessel.customers?.company_name,
    ].some((value) => value?.toLowerCase().includes(term))
  ));

  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = term ? 'No matching vessels.' : 'No vessels yet.';
    list.append(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead>
      <tr><th>Vessel</th><th>Customer</th><th>Type</th><th>Location</th><th></th></tr>
    </thead>
    <tbody></tbody>
  `;
  const body = table.querySelector('tbody');

  for (const vessel of filtered) {
    const row = document.createElement('tr');
    const cells = [
      vesselLabel(vessel),
      customerLabel(vessel.customers),
      vessel.vessel_type ?? '-',
      vessel.location ?? '-',
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
    editButton.addEventListener('click', () => openEditor(vessel));
    actionCell.append(editButton);
    row.append(actionCell);
    body.append(row);
  }
  list.append(table);
}

function populateCustomerOptions() {
  const select = form.elements.customerId;
  select.replaceChildren(new Option('Select customer', ''));
  for (const customer of customers) {
    select.add(new Option(customerLabel(customer), customer.id));
  }
}

async function loadData() {
  const [customerResult, vesselResult] = await Promise.all([
    supabase.from('customers').select('id, contact_name, company_name').is('archived_at', null).order('contact_name'),
    supabase
      .from('vessels')
      .select('*, customers(id, contact_name, company_name)')
      .is('archived_at', null)
      .order('updated_at', { ascending: false }),
  ]);

  if (customerResult.error || vesselResult.error) {
    list.innerHTML = '<p class="empty-state">Unable to load vessels.</p>';
    return;
  }
  customers = customerResult.data;
  vessels = vesselResult.data;
  populateCustomerOptions();
  renderVessels();
}

function openEditor(vessel = null) {
  form.reset();
  formMessage.hidden = true;
  editor.hidden = false;
  editorTitle.textContent = vessel ? 'Edit vessel' : 'New vessel';
  archiveButton.hidden = !vessel;
  populateCustomerOptions();

  if (vessel) {
    form.elements.id.value = vessel.id;
    form.elements.customerId.value = vessel.customer_id;
    form.elements.vesselName.value = vessel.vessel_name ?? '';
    form.elements.vesselType.value = vessel.vessel_type ?? '';
    form.elements.manufacturer.value = vessel.manufacturer ?? '';
    form.elements.model.value = vessel.model ?? '';
    form.elements.year.value = vessel.year ?? '';
    form.elements.lengthFeet.value = vessel.length_feet ?? '';
    form.elements.registrationNumber.value = vessel.registration_number ?? '';
    form.elements.location.value = vessel.location ?? '';
    form.elements.notes.value = vessel.notes ?? '';
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
    customer_id: form.elements.customerId.value,
    vessel_name: normalizeOptional(form.elements.vesselName.value),
    vessel_type: normalizeOptional(form.elements.vesselType.value),
    manufacturer: normalizeOptional(form.elements.manufacturer.value),
    model: normalizeOptional(form.elements.model.value),
    year: form.elements.year.value ? Number(form.elements.year.value) : null,
    length_feet: form.elements.lengthFeet.value ? Number(form.elements.lengthFeet.value) : null,
    registration_number: normalizeOptional(form.elements.registrationNumber.value),
    location: normalizeOptional(form.elements.location.value),
    notes: normalizeOptional(form.elements.notes.value),
    updated_by: profile.id,
  };

  if (!payload.vessel_name && !payload.registration_number && !(payload.manufacturer && payload.model)) {
    setFormMessage(formMessage, 'Add a vessel name, registration number, or manufacturer and model.', true);
    return;
  }

  const query = id
    ? supabase.from('vessels').update(payload).eq('id', id)
    : supabase.from('vessels').insert({ ...payload, created_by: profile.id });
  const { error } = await query;

  if (error) {
    setFormMessage(formMessage, 'Unable to save the vessel.', true);
    return;
  }
  setFormMessage(formMessage, 'Vessel saved.');
  await loadData();
  window.setTimeout(() => { editor.hidden = true; }, 500);
});

archiveButton.addEventListener('click', async () => {
  const id = form.elements.id.value;
  if (!id || !window.confirm('Archive this vessel? Existing estimates will be retained.')) {
    return;
  }
  const { error } = await supabase
    .from('vessels')
    .update({ archived_at: new Date().toISOString(), updated_by: profile.id })
    .eq('id', id);
  if (error) {
    setFormMessage(formMessage, 'Unable to archive the vessel.', true);
    return;
  }
  editor.hidden = true;
  await loadData();
});

document.querySelector('#new-vessel').addEventListener('click', () => openEditor());
document.querySelector('#close-vessel-editor').addEventListener('click', () => { editor.hidden = true; });
search.addEventListener('input', renderVessels);
await loadData();
