import { supabase } from './supabase-client.js';
import { initializePageShell, normalizeOptional, setFormMessage } from './page-shell.js';

await initializePageShell();

const form = document.querySelector('#lead-form');
const formMessage = document.querySelector('#lead-form-message');
const list = document.querySelector('#lead-list');

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '-';
}

function resetForm() {
  form.reset();
  form.elements.country.value = 'United States';
  formMessage.hidden = true;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderLeads(leads) {
  if (!leads.length) {
    list.innerHTML = '<p class="empty-state">No leads yet.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead>
      <tr><th>Lead</th><th>Vessel</th><th>Service</th><th>Status</th><th>Pipeline</th><th>Created</th></tr>
    </thead>
    <tbody></tbody>
  `;
  const body = table.querySelector('tbody');

  for (const lead of leads) {
    const row = document.createElement('tr');
    const vessel = [
      lead.vessel_name,
      [lead.manufacturer, lead.model].filter(Boolean).join(' '),
      lead.length ? `${lead.length} ft` : null,
    ].filter(Boolean).join(' · ') || '-';
    const pipeline = lead.pipeline_id ? 'Created' : 'Pending';
    const values = [
      `${lead.full_name}${lead.email ? ` · ${lead.email}` : ''}${lead.phone ? ` · ${lead.phone}` : ''}`,
      vessel,
      lead.service_type,
      lead.status,
      pipeline,
      formatDate(lead.created_at),
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }

  list.replaceChildren(table);
}

async function loadLeads() {
  const { data, error } = await supabase
    .from('lead_intake')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    list.innerHTML = '<p class="empty-state">Unable to load leads.</p>';
    return;
  }
  renderLeads(data);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formMessage.hidden = true;
  if (!form.reportValidity()) return;

  const lengthValue = form.elements.length.value;
  const payload = {
    full_name: form.elements.fullName.value.trim(),
    phone: normalizeOptional(form.elements.phone.value),
    email: normalizeOptional(form.elements.email.value),
    vessel_name: normalizeOptional(form.elements.vesselName.value),
    manufacturer: normalizeOptional(form.elements.manufacturer.value),
    model: normalizeOptional(form.elements.model.value),
    length: lengthValue ? Number(lengthValue) : null,
    marina: normalizeOptional(form.elements.marina.value),
    city: normalizeOptional(form.elements.city.value),
    country: normalizeOptional(form.elements.country.value),
    service_type: form.elements.serviceType.value,
    description: form.elements.description.value.trim(),
    status: 'Lead',
  };

  const { error } = await supabase.from('lead_intake').insert(payload);
  if (error) {
    console.error(error);
    setFormMessage(formMessage, 'Unable to save lead.', true);
    return;
  }

  setFormMessage(formMessage, 'Lead saved and added to Pipeline.');
  form.reset();
  form.elements.country.value = 'United States';
  await loadLeads();
});

document.querySelector('#new-lead').addEventListener('click', resetForm);
await loadLeads();
