import { supabase } from './supabase-client.js';
import { formatMoney } from './estimate-calculator.js';
import { initializePageShell } from './page-shell.js';

await initializePageShell();
const list = document.querySelector('#estimate-list');
const search = document.querySelector('#estimate-search');
const statusFilter = document.querySelector('#estimate-status-filter');
let estimates = [];

function renderEstimates() {
  const term = search.value.trim().toLowerCase();
  const status = statusFilter.value;
  const filtered = estimates.filter((estimate) => {
    const matchesStatus = !status || estimate.status === status;
    const matchesSearch = [
      estimate.estimate_number,
      estimate.customers?.contact_name,
      estimate.customers?.company_name,
      estimate.vessels?.vessel_name,
    ].some((value) => value?.toLowerCase().includes(term));
    return matchesStatus && matchesSearch;
  });

  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No matching estimates.';
    list.append(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead>
      <tr><th>Estimate</th><th>Customer</th><th>Vessel</th><th>Status</th><th>Total</th><th>Updated</th><th></th></tr>
    </thead>
    <tbody></tbody>
  `;
  const body = table.querySelector('tbody');
  for (const estimate of filtered) {
    const row = document.createElement('tr');
    const cells = [
      estimate.estimate_number,
      estimate.customers.company_name || estimate.customers.contact_name,
      estimate.vessels.vessel_name || estimate.vessels.registration_number || '-',
      estimate.status,
      formatMoney(estimate.total_cents, estimate.currency),
      new Date(estimate.updated_at).toLocaleDateString(),
    ];
    for (const value of cells) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const actionCell = document.createElement('td');
    const editLink = document.createElement('a');
    editLink.className = 'table-action';
    editLink.href = `./estimate.html?id=${encodeURIComponent(estimate.id)}`;
    editLink.textContent = 'Open';
    actionCell.append(editLink);
    row.append(actionCell);
    body.append(row);
  }
  list.append(table);
}

const { data, error } = await supabase
  .from('estimates')
  .select(`
    id, estimate_number, status, currency, total_cents, updated_at,
    customers(contact_name, company_name),
    vessels(vessel_name, registration_number)
  `)
  .neq('status', 'sent')
  .order('updated_at', { ascending: false });

if (error) {
  list.innerHTML = '<p class="empty-state">Unable to load estimates.</p>';
} else {
  estimates = data;
  renderEstimates();
}

search.addEventListener('input', renderEstimates);
statusFilter.addEventListener('change', renderEstimates);
