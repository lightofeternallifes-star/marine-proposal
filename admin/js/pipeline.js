import { supabase } from './supabase-client.js';
import { formatMoney } from './estimate-calculator.js';
import { initializePageShell, normalizeOptional, setFormMessage } from './page-shell.js';

const profile = await initializePageShell();

const stages = [
  { key: 'lead', label: 'Lead' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'appointment_scheduled', label: 'Appointment Scheduled' },
  { key: 'estimate_sent', label: 'Estimate Sent' },
  { key: 'approved', label: 'Approved' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];

const stageOrder = Object.fromEntries(stages.map((stage, index) => [stage.key, index]));
const editor = document.querySelector('#pipeline-editor');
const form = document.querySelector('#pipeline-form');
const formMessage = document.querySelector('#pipeline-form-message');
const pageMessage = document.querySelector('#pipeline-message');
let pipeline = [];
let customers = [];
let vessels = [];
let estimates = [];

function customerLabel(customer) {
  return customer?.company_name
    ? `${customer.contact_name} - ${customer.company_name}`
    : customer?.contact_name || 'Customer';
}

function vesselLabel(vessel) {
  return vessel?.vessel_name
    || [vessel?.manufacturer, vessel?.model].filter(Boolean).join(' ')
    || vessel?.registration_number
    || 'No vessel selected';
}

function estimateLabel(estimate) {
  if (!estimate) return 'No estimate selected';
  return `${estimate.estimate_number} · ${formatMoney(estimate.total_cents, estimate.currency)}`;
}

function percent(numerator, denominator) {
  if (!denominator) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function stageCount(stage) {
  return pipeline.filter((item) => item.stage === stage).length;
}

function countAtOrAfter(stage) {
  const target = stageOrder[stage];
  return pipeline.filter((item) => stageOrder[item.stage] >= target).length;
}

function renderMetrics() {
  const lead = stageCount('lead');
  const qualified = stageCount('qualified');
  const appointment = stageCount('appointment_scheduled');
  const estimateSent = stageCount('estimate_sent');
  const approved = stageCount('approved');
  const won = stageCount('won');
  const lost = stageCount('lost');
  const open = pipeline.filter((item) => !['approved', 'won', 'lost'].includes(item.stage)).length;
  const total = pipeline.length;

  document.querySelector('#pipeline-leads').textContent = lead;
  document.querySelector('#pipeline-appointments').textContent = appointment;
  document.querySelector('#pipeline-estimates-sent').textContent = estimateSent;
  document.querySelector('#pipeline-won').textContent = won;
  document.querySelector('#pipeline-lost').textContent = lost;

  document.querySelector('#summary-lead-count').textContent = lead;
  document.querySelector('#summary-conversion-rate').textContent = percent(approved + won, approved + won + lost);
  document.querySelector('#summary-open-opportunities').textContent = open;

  document.querySelector('#report-lead-qualified').textContent = percent(countAtOrAfter('qualified'), total);
  document.querySelector('#report-qualified-appointment').textContent =
    percent(countAtOrAfter('appointment_scheduled'), countAtOrAfter('qualified'));
  document.querySelector('#report-appointment-estimate').textContent =
    percent(countAtOrAfter('estimate_sent'), countAtOrAfter('appointment_scheduled'));
  document.querySelector('#report-estimate-won').textContent = percent(approved + won, countAtOrAfter('estimate_sent'));
  document.querySelector('#report-close-rate').textContent = percent(approved + won, approved + won + lost);

  for (const stage of stages) {
    document.querySelector(`#count-${stage.key}`).textContent = stageCount(stage.key);
  }
}

function createCard(item) {
  const card = document.createElement('article');
  card.className = 'pipeline-card';
  card.draggable = true;
  card.dataset.pipelineId = item.id;

  const customer = item.customers;
  const vessel = item.vessels;
  const estimate = item.estimates;

  const title = document.createElement('h3');
  title.textContent = customerLabel(customer);

  const meta = document.createElement('p');
  meta.textContent = vesselLabel(vessel);

  const estimateLine = document.createElement('p');
  estimateLine.className = 'pipeline-card-estimate';
  estimateLine.textContent = estimate ? estimateLabel(estimate) : 'No estimate linked';

  const source = document.createElement('span');
  source.className = 'pipeline-source';
  source.textContent = item.source;

  const actions = document.createElement('div');
  actions.className = 'pipeline-card-actions';

  const openCustomer = document.createElement('a');
  openCustomer.className = 'table-action';
  openCustomer.href = `./customers.html?customerId=${encodeURIComponent(item.customer_id)}`;
  openCustomer.textContent = 'Customer';

  const openEstimate = document.createElement('a');
  openEstimate.className = 'table-action';
  openEstimate.href = item.estimate_id
    ? `./estimate.html?id=${encodeURIComponent(item.estimate_id)}`
    : './estimate.html';
  openEstimate.textContent = item.estimate_id ? 'Estimate' : 'New estimate';

  const wonButton = document.createElement('button');
  wonButton.className = 'table-action';
  wonButton.type = 'button';
  wonButton.textContent = 'Mark as Won';
  wonButton.disabled = item.stage === 'won';
  wonButton.addEventListener('click', () => updateStage(item.id, 'won'));

  const lostButton = document.createElement('button');
  lostButton.className = 'table-action';
  lostButton.type = 'button';
  lostButton.textContent = 'Mark as Lost';
  lostButton.disabled = item.stage === 'lost';
  lostButton.addEventListener('click', () => markLost(item));

  actions.append(openCustomer, openEstimate, wonButton, lostButton);
  card.append(title, meta, estimateLine, source, actions);

  card.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData('text/plain', item.id);
    event.dataTransfer.effectAllowed = 'move';
  });

  return card;
}

function renderBoard() {
  for (const stage of stages) {
    const column = document.querySelector(`[data-stage-drop="${stage.key}"]`);
    column.replaceChildren();
    const records = pipeline
      .filter((item) => item.stage === stage.key)
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'pipeline-empty';
      empty.textContent = 'No opportunities';
      column.append(empty);
      continue;
    }

    for (const item of records) {
      column.append(createCard(item));
    }
  }
}

function renderAll() {
  renderMetrics();
  renderBoard();
}

async function loadPipeline() {
  const { data, error } = await supabase
    .from('sales_pipeline')
    .select(`
      *,
      customers(contact_name, company_name, email),
      vessels(vessel_name, manufacturer, model, registration_number),
      estimates(estimate_number, status, currency, total_cents)
    `)
    .order('updated_at', { ascending: false });

  if (error) {
    setFormMessage(pageMessage, 'Unable to load pipeline.', true);
    return;
  }

  pipeline = data;
  renderAll();
}

function populateCustomers() {
  const select = form.elements.customerId;
  select.replaceChildren(new Option('Select customer', ''));
  for (const customer of customers) {
    select.add(new Option(customerLabel(customer), customer.id));
  }
}

function populateVessels() {
  const select = form.elements.vesselId;
  const customerId = form.elements.customerId.value;
  select.replaceChildren(new Option('No vessel selected', ''));
  for (const vessel of vessels.filter((item) => item.customer_id === customerId)) {
    select.add(new Option(vesselLabel(vessel), vessel.id));
  }
}

function populateEstimates() {
  const select = form.elements.estimateId;
  const customerId = form.elements.customerId.value;
  const vesselId = form.elements.vesselId.value;
  select.replaceChildren(new Option('No estimate selected', ''));
  for (const estimate of estimates.filter((item) => (
    item.customer_id === customerId
    && (!vesselId || item.vessel_id === vesselId)
  ))) {
    select.add(new Option(estimateLabel(estimate), estimate.id));
  }
}

async function loadDirectories() {
  const [customerResult, vesselResult, estimateResult] = await Promise.all([
    supabase.from('customers').select('id, contact_name, company_name').is('archived_at', null).order('contact_name'),
    supabase.from('vessels').select('id, customer_id, vessel_name, manufacturer, model, registration_number').is('archived_at', null),
    supabase.from('estimates').select('id, customer_id, vessel_id, estimate_number, currency, total_cents').order('updated_at', { ascending: false }),
  ]);

  if (customerResult.error || vesselResult.error || estimateResult.error) {
    throw new Error('Unable to load pipeline directories.');
  }

  customers = customerResult.data;
  vessels = vesselResult.data;
  estimates = estimateResult.data;
  populateCustomers();
  populateVessels();
  populateEstimates();
}

async function updateStage(id, stage, notes = null) {
  const payload = { stage };
  if (notes !== null) payload.notes = notes;
  const { error } = await supabase
    .from('sales_pipeline')
    .update(payload)
    .eq('id', id);
  if (error) {
    setFormMessage(pageMessage, 'Unable to update pipeline stage.', true);
    return;
  }
  setFormMessage(pageMessage, `Opportunity moved to ${stages.find((item) => item.key === stage).label}.`);
  await loadPipeline();
}

async function markLost(item) {
  const reason = window.prompt('Loss reason');
  if (reason === null) return;
  const existing = item.notes ? `${item.notes}\n\n` : '';
  const notes = `${existing}Lost reason: ${reason.trim() || 'Not specified'}`;
  await updateStage(item.id, 'lost', notes);
}

document.querySelectorAll('[data-stage-drop]').forEach((column) => {
  column.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });
  column.addEventListener('drop', async (event) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain');
    const stage = column.dataset.stageDrop;
    if (id && stage) {
      await updateStage(id, stage);
    }
  });
});

form.elements.customerId.addEventListener('change', () => {
  populateVessels();
  populateEstimates();
});
form.elements.vesselId.addEventListener('change', populateEstimates);

document.querySelector('#new-opportunity').addEventListener('click', () => {
  form.reset();
  form.elements.source.value = 'manual';
  form.elements.stage.value = 'lead';
  formMessage.hidden = true;
  populateCustomers();
  populateVessels();
  populateEstimates();
  editor.hidden = false;
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelector('#close-pipeline-editor').addEventListener('click', () => {
  editor.hidden = true;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formMessage.hidden = true;
  if (!form.reportValidity()) return;

  const payload = {
    customer_id: form.elements.customerId.value,
    vessel_id: normalizeOptional(form.elements.vesselId.value),
    estimate_id: normalizeOptional(form.elements.estimateId.value),
    stage: form.elements.stage.value,
    source: form.elements.source.value.trim(),
    assigned_to: profile.id,
    notes: normalizeOptional(form.elements.notes.value),
  };

  const { error } = await supabase.from('sales_pipeline').insert(payload);
  if (error) {
    setFormMessage(formMessage, 'Unable to save opportunity.', true);
    return;
  }

  setFormMessage(formMessage, 'Opportunity saved.');
  await loadPipeline();
  window.setTimeout(() => { editor.hidden = true; }, 500);
});

supabase
  .channel('sales-pipeline-board')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_pipeline' }, loadPipeline)
  .subscribe();

try {
  await loadDirectories();
  await loadPipeline();
} catch (error) {
  console.error(error);
  setFormMessage(pageMessage, error.message, true);
}
