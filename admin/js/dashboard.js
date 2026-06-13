import { requireActiveProfile, signOut } from './auth.js';
import { supabase } from './supabase-client.js';

const profile = await requireActiveProfile();
document.querySelector('#user-name').textContent = profile.full_name;
document.querySelector('#sign-out').addEventListener('click', signOut);

async function loadCounts() {
  const countQueries = [
    supabase.from('estimates').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
    supabase.from('estimates').select('*', { count: 'exact', head: true }).eq('status', 'generated'),
    supabase.from('estimates').select('*', { count: 'exact', head: true }).eq('status', 'sent'),
    supabase.from('customers').select('*', { count: 'exact', head: true }).is('archived_at', null),
  ];

  const [drafts, generated, sent, customers] = await Promise.all(countQueries);
  document.querySelector('#draft-count').textContent = drafts.count ?? 0;
  document.querySelector('#generated-count').textContent = generated.count ?? 0;
  document.querySelector('#sent-count').textContent = sent.count ?? 0;
  document.querySelector('#customer-count').textContent = customers.count ?? 0;
}

function renderRecentEstimates(estimates) {
  const container = document.querySelector('#recent-estimates');
  if (!estimates.length) {
    container.innerHTML = '<p class="empty-state">No estimates yet.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = '<thead><tr><th>Estimate</th><th>Customer</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody></tbody>';
  const body = table.querySelector('tbody');
  for (const estimate of estimates) {
    const row = document.createElement('tr');
    const values = [
      estimate.estimate_number,
      estimate.customers.company_name || estimate.customers.contact_name,
      estimate.status,
      new Date(estimate.updated_at).toLocaleDateString(),
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const actionCell = document.createElement('td');
    const link = document.createElement('a');
    link.className = 'table-action';
    link.href = `./estimate.html?id=${encodeURIComponent(estimate.id)}`;
    link.textContent = 'Open';
    actionCell.append(link);
    row.append(actionCell);
    body.append(row);
  }
  container.replaceChildren(table);
}

async function loadRecentEstimates() {
  const { data, error } = await supabase
    .from('estimates')
    .select('id, estimate_number, status, updated_at, customers(contact_name, company_name)')
    .order('updated_at', { ascending: false })
    .limit(8);
  if (!error) {
    renderRecentEstimates(data);
  }
}

await Promise.all([loadCounts(), loadRecentEstimates()]);
