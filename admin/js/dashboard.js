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

function percent(numerator, denominator) {
  if (!denominator) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

async function loadPipelineMetrics() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - 6);

  const [pipelineResult, leadsTodayResult, leadsWeekResult] = await Promise.all([
    supabase
    .from('sales_pipeline')
      .select('stage'),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfToday.toISOString()),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfWeek.toISOString()),
  ]);

  if (pipelineResult.error) {
    console.warn('[Dashboard] Pipeline metrics unavailable:', pipelineResult.error.message);
    return;
  }

  if (leadsTodayResult.error || leadsWeekResult.error) {
    console.warn('[Dashboard] Lead capture metrics unavailable:', leadsTodayResult.error?.message || leadsWeekResult.error?.message);
  }

  const data = pipelineResult.data;
  const count = (stage) => data.filter((item) => item.stage === stage).length;
  const leads = count('lead');
  const appointments = count('appointment_scheduled');
  const estimatesSent = count('estimate_sent');
  const won = count('won');
  const lost = count('lost');
  const open = data.filter((item) => !['won', 'lost'].includes(item.stage)).length;

  document.querySelector('#dashboard-leads-today').textContent = leadsTodayResult.count ?? 0;
  document.querySelector('#dashboard-leads-week').textContent = leadsWeekResult.count ?? 0;
  document.querySelector('#dashboard-leads').textContent = leads;
  document.querySelector('#dashboard-appointments').textContent = appointments;
  document.querySelector('#dashboard-estimates-sent').textContent = estimatesSent;
  document.querySelector('#dashboard-won').textContent = won;
  document.querySelector('#dashboard-lost').textContent = lost;
  document.querySelector('#dashboard-lead-count').textContent = leads;
  document.querySelector('#dashboard-conversion-rate').textContent = percent(won, won + lost);
  document.querySelector('#dashboard-open-opportunities').textContent = open;
  document.querySelector('#dashboard-close-rate').textContent = percent(won, won + lost);
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

await Promise.all([loadCounts(), loadPipelineMetrics(), loadRecentEstimates()]);
