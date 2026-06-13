import { supabase } from './supabase-client.js';
import { formatMoney } from './estimate-calculator.js';
import { initializePageShell } from './page-shell.js';

await initializePageShell();
const list = document.querySelector('#history-list');
const search = document.querySelector('#history-search');
let estimates = [];

function renderHistory() {
  const term = search.value.trim().toLowerCase();
  const filtered = estimates.filter((estimate) => (
    [
      estimate.estimate_number,
      estimate.customers?.contact_name,
      estimate.customers?.company_name,
      estimate.vessels?.vessel_name,
      estimate.vessels?.registration_number,
    ].some((value) => value?.toLowerCase().includes(term))
  ));

  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No estimate history found.';
    list.append(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead>
      <tr><th>Estimate</th><th>Customer</th><th>Vessel</th><th>Version</th><th>Status</th><th>Total</th><th>Updated</th><th></th></tr>
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
      String(estimate.current_version),
      estimate.status,
      formatMoney(estimate.total_cents, estimate.currency),
      new Date(estimate.updated_at).toLocaleString(),
    ];
    for (const value of cells) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const actionCell = document.createElement('td');
    const openLink = document.createElement('a');
    openLink.className = 'table-action';
    openLink.href = `./estimate.html?id=${encodeURIComponent(estimate.id)}`;
    openLink.textContent = 'Open';
    actionCell.append(openLink);
    row.append(actionCell);
    body.append(row);
  }
  list.append(table);
}

const { data, error } = await supabase
  .from('estimates')
  .select(`
    id, estimate_number, status, currency, total_cents, current_version, updated_at,
    customers(contact_name, company_name),
    vessels(vessel_name, registration_number)
  `)
  .order('updated_at', { ascending: false });

if (error) {
  list.innerHTML = '<p class="empty-state">Unable to load estimate history.</p>';
} else {
  estimates = data;
  renderHistory();
}

search.addEventListener('input', renderHistory);
