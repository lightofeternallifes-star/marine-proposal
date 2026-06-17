import { supabase } from './supabase-client.js';
import { initializePageShell, normalizeOptional, setFormMessage } from './page-shell.js';

const profile = await initializePageShell();

const conversationList = document.querySelector('#conversation-list');
const messageList = document.querySelector('#message-list');
const messageContext = document.querySelector('#message-context');
const messageForm = document.querySelector('#message-form');
const appointmentForm = document.querySelector('#appointment-form');
const appointmentList = document.querySelector('#appointment-list');
const conversationEditor = document.querySelector('#conversation-editor');
const conversationForm = document.querySelector('#conversation-form');
const pageMessage = document.querySelector('#natalie-message');
const detailsContext = document.querySelector('#details-context');
const markQualifiedButton = document.querySelector('#mark-qualified');

let conversations = [];
let messages = [];
let appointments = [];
let leads = [];
let selectedConversation = null;

const statusLabels = {
  active: 'Active',
  waiting_on_customer: 'Waiting on Customer',
  qualified: 'Qualified',
  appointment_requested: 'Appointment Requested',
  escalated: 'Escalated',
  closed: 'Closed',
  archived: 'Archived',
};

function stageLabel(value) {
  return String(value || '-')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function customerLabel(customer, lead) {
  if (customer?.company_name) return `${customer.contact_name} - ${customer.company_name}`;
  return customer?.contact_name || lead?.full_name || 'Unknown customer';
}

function vesselLabel(vessel, lead) {
  return vessel?.vessel_name || lead?.vessel_name || 'No vessel recorded';
}

function leadLabel(lead) {
  return `${lead.full_name} · ${lead.email || lead.phone || 'No contact'} · ${lead.service_type}`;
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function renderMetrics() {
  const count = (status) => conversations.filter((item) => item.status === status).length;
  document.querySelector('#natalie-active-count').textContent = count('active');
  document.querySelector('#natalie-waiting-count').textContent = count('waiting_on_customer');
  document.querySelector('#natalie-qualified-count').textContent = count('qualified');
  document.querySelector('#natalie-appointment-count').textContent = appointments.length;
  document.querySelector('#natalie-message-count').textContent = messages.length;
}

function renderConversations() {
  conversationList.replaceChildren();
  if (!conversations.length) {
    conversationList.innerHTML = '<p class="empty-state">No Natalie conversations yet.</p>';
    return;
  }

  for (const conversation of conversations) {
    const card = document.createElement('button');
    card.className = 'natalie-card';
    card.type = 'button';
    card.dataset.selected = selectedConversation?.id === conversation.id ? 'true' : 'false';

    const title = document.createElement('strong');
    title.textContent = customerLabel(conversation.customers, conversation.lead_intake);

    const vessel = document.createElement('span');
    vessel.textContent = vesselLabel(conversation.vessels, conversation.lead_intake);

    const meta = document.createElement('small');
    meta.textContent = `${conversation.current_stage || 'Lead'} · ${statusLabels[conversation.status] || conversation.status} · ${formatDate(conversation.last_message_at || conversation.updated_at)}`;

    card.append(title, vessel, meta);
    card.addEventListener('click', () => selectConversation(conversation.id));
    conversationList.append(card);
  }
}

function renderConversationDetails() {
  const fields = {
    customerName: document.querySelector('#detail-customer-name'),
    location: document.querySelector('#detail-location'),
    vessel: document.querySelector('#detail-vessel'),
    problem: document.querySelector('#detail-problem'),
    stage: document.querySelector('#detail-stage'),
    appointment: document.querySelector('#detail-appointment'),
  };

  if (!selectedConversation) {
    detailsContext.textContent = 'Select a conversation to see Natalie intake details.';
    fields.customerName.textContent = '-';
    fields.location.textContent = '-';
    fields.vessel.textContent = '-';
    fields.problem.textContent = '-';
    fields.stage.textContent = '-';
    fields.appointment.textContent = '-';
    markQualifiedButton.disabled = true;
    return;
  }

  const data = selectedConversation.intake_summary || {};
  const appointment = appointments.find((item) => item.conversation_id === selectedConversation.id);
  const vessel = [
    data.vessel_name,
    [data.manufacturer, data.model].filter(Boolean).join(' '),
  ].filter(Boolean).join(' · ') || vesselLabel(selectedConversation.vessels, selectedConversation.lead_intake);

  detailsContext.textContent = customerLabel(selectedConversation.customers, selectedConversation.lead_intake);
  fields.customerName.textContent = data.full_name || selectedConversation.customers?.contact_name || selectedConversation.lead_intake?.full_name || '-';
  fields.location.textContent = [data.marina, data.city, data.country].filter(Boolean).join(', ') || selectedConversation.vessels?.location || '-';
  fields.vessel.textContent = vessel || '-';
  fields.problem.textContent = data.description || appointment?.notes || '-';
  fields.stage.textContent = selectedConversation.current_stage || stageLabel(selectedConversation.status);
  fields.appointment.textContent = appointment?.requested_window
    || '-';
  markQualifiedButton.disabled = selectedConversation.status === 'qualified';
}

function renderMessages() {
  messageList.replaceChildren();
  if (!selectedConversation) {
    messageContext.textContent = 'Select a conversation.';
    messageList.innerHTML = '<p class="empty-state">No messages selected.</p>';
    messageForm.hidden = true;
    appointmentForm.hidden = true;
    return;
  }

  messageContext.textContent = `${customerLabel(selectedConversation.customers, selectedConversation.leads)} · ${statusLabels[selectedConversation.status] || selectedConversation.status}`;
  messageForm.hidden = false;
  appointmentForm.hidden = false;

  const conversationMessages = messages
    .filter((message) => message.conversation_id === selectedConversation.id)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  if (!conversationMessages.length) {
    messageList.innerHTML = '<p class="empty-state">No messages recorded for this conversation.</p>';
    return;
  }

  for (const message of conversationMessages) {
    const item = document.createElement('article');
    item.className = `message-bubble ${message.direction}`;
    const header = document.createElement('strong');
    header.textContent = `${message.sender_type} · ${formatDate(message.created_at)}`;
    const body = document.createElement('p');
    body.textContent = message.body;
    item.append(header, body);
    messageList.append(item);
  }
}

function renderAppointments() {
  const relatedAppointments = selectedConversation
    ? appointments.filter((item) => item.conversation_id === selectedConversation.id)
    : appointments;

  if (!relatedAppointments.length) {
    appointmentList.innerHTML = '<p class="empty-state">No appointment requests yet.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead>
      <tr><th>Customer</th><th>Requested</th><th>Location</th><th>Problem</th><th>Status</th><th>Created</th></tr>
    </thead>
    <tbody></tbody>
  `;
  const body = table.querySelector('tbody');
  for (const appointment of relatedAppointments) {
    const row = document.createElement('tr');
    const location = [
      appointment.marina,
      appointment.city,
      appointment.state_province,
      appointment.country,
    ].filter(Boolean).join(', ') || appointment.location_type || '-';
    const customer = appointment.customers?.company_name
      ? `${appointment.customers.contact_name} - ${appointment.customers.company_name}`
      : appointment.customers?.contact_name || '-';
    const values = [
      customer,
      appointment.requested_window || [appointment.requested_date, appointment.requested_time].filter(Boolean).join(' '),
      location,
      appointment.notes || '-',
      appointment.status,
      formatDate(appointment.created_at),
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  appointmentList.replaceChildren(table);
}

function renderAll() {
  renderMetrics();
  renderConversations();
  renderConversationDetails();
  renderMessages();
  renderAppointments();
}

function selectConversation(id) {
  selectedConversation = conversations.find((item) => item.id === id) || null;
  renderAll();
}

function populateLeadSelect() {
  const select = conversationForm.elements.leadId;
  select.replaceChildren(new Option('Select website lead', ''));
  for (const lead of leads) {
    select.add(new Option(leadLabel(lead), lead.id));
  }
}

async function loadLeads() {
  const { data, error } = await supabase
    .from('lead_intake')
    .select('id, full_name, email, phone, vessel_name, manufacturer, model, service_type, customer_id, vessel_id, pipeline_id')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  leads = data;
  populateLeadSelect();
}

async function loadConversations() {
  const { data, error } = await supabase
    .from('natalie_conversations')
    .select(`
      *,
      lead_intake(full_name, email, phone, vessel_name, manufacturer, model, service_type, description, marina, city, country),
      customers(contact_name, company_name, email, phone),
      vessels(vessel_name, vessel_type, location),
      sales_pipeline(stage, source)
    `)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  conversations = data;
  if (selectedConversation) {
    selectedConversation = conversations.find((item) => item.id === selectedConversation.id) || null;
  }
}

async function loadMessages() {
  const { data, error } = await supabase
    .from('natalie_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(250);
  if (error) throw error;
  messages = data;
}

async function loadAppointments() {
  const { data, error } = await supabase
    .from('appointment_requests')
    .select(`
      *,
      customers(contact_name, company_name),
      vessels(vessel_name)
    `)
    .order('created_at', { ascending: false })
    .limit(250);
  if (error) throw error;
  appointments = data;
}

async function loadAll() {
  await Promise.all([loadLeads(), loadConversations(), loadMessages(), loadAppointments()]);
  renderAll();
}

document.querySelector('#new-conversation').addEventListener('click', () => {
  conversationForm.reset();
  document.querySelector('#conversation-form-message').hidden = true;
  conversationEditor.hidden = false;
  conversationEditor.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelector('#close-conversation-editor').addEventListener('click', () => {
  conversationEditor.hidden = true;
});

markQualifiedButton.addEventListener('click', async () => {
  if (!selectedConversation) return;
  const { error } = await supabase
    .from('natalie_conversations')
    .update({
      status: 'qualified',
      current_stage: 'Qualified',
      qualified_at: new Date().toISOString(),
    })
    .eq('id', selectedConversation.id);
  if (error) {
    setFormMessage(pageMessage, 'Unable to mark conversation qualified.', true);
    return;
  }
  setFormMessage(pageMessage, 'Conversation marked qualified.');
  await loadAll();
  selectConversation(selectedConversation.id);
});

conversationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formMessage = document.querySelector('#conversation-form-message');
  formMessage.hidden = true;
  if (!conversationForm.reportValidity()) return;

  const lead = leads.find((item) => item.id === conversationForm.elements.leadId.value);
  if (!lead) {
    setFormMessage(formMessage, 'Select a lead.', true);
    return;
  }

  try {
    const { data: existing } = await supabase
      .from('natalie_conversations')
      .select('id')
      .eq('lead_intake_id', lead.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let conversationId = existing?.id;
    if (!conversationId) {
      const { data: created, error } = await supabase
        .from('natalie_conversations')
        .insert({
          lead_intake_id: lead.id,
          customer_id: lead.customer_id,
          vessel_id: lead.vessel_id,
          pipeline_id: lead.pipeline_id,
          status: 'active',
          current_stage: 'Lead',
          assigned_to: profile.id,
          intake_summary: {
            full_name: lead.full_name,
            phone: lead.phone,
            email: lead.email,
            vessel_name: lead.vessel_name,
            manufacturer: lead.manufacturer,
            model: lead.model,
            service_type: lead.service_type,
          },
        })
        .select('id')
        .single();
      if (error) throw error;
      conversationId = created.id;
    }
    setFormMessage(formMessage, 'Natalie intake started.');
    await loadAll();
    selectConversation(conversationId);
    window.setTimeout(() => { conversationEditor.hidden = true; }, 500);
  } catch (error) {
    setFormMessage(formMessage, error.message || 'Unable to start Natalie intake.', true);
    return;
  }
});

messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formMessage = document.querySelector('#message-form-message');
  formMessage.hidden = true;
  if (!messageForm.reportValidity() || !selectedConversation) return;

  try {
    const { error } = await supabase.from('natalie_messages').insert({
      conversation_id: selectedConversation.id,
      lead_intake_id: selectedConversation.lead_intake_id,
      customer_id: selectedConversation.customer_id,
      direction: 'inbound',
      sender_type: 'customer',
      body: messageForm.elements.body.value.trim(),
      metadata: { source: 'admin_natalie_foundation' },
    });
    if (error) throw error;
    messageForm.reset();
    setFormMessage(formMessage, 'Message saved to Natalie conversation.');
    await loadAll();
    selectConversation(selectedConversation.id);
  } catch (error) {
    setFormMessage(formMessage, error.message || 'Unable to save Natalie answer.', true);
    return;
  }
});

appointmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formMessage = document.querySelector('#appointment-form-message');
  formMessage.hidden = true;
  if (!appointmentForm.reportValidity() || !selectedConversation) return;

  const { error } = await supabase.from('appointment_requests').insert({
    lead_intake_id: selectedConversation.lead_intake_id,
    customer_id: selectedConversation.customer_id,
    vessel_id: selectedConversation.vessel_id,
    pipeline_id: selectedConversation.pipeline_id,
    conversation_id: selectedConversation.id,
    requested_date: normalizeOptional(appointmentForm.elements.requestedDate.value),
    requested_time: normalizeOptional(appointmentForm.elements.requestedTime.value),
    requested_window: normalizeOptional([appointmentForm.elements.requestedDate.value, appointmentForm.elements.requestedTime.value].filter(Boolean).join(' ')),
    location_type: normalizeOptional(appointmentForm.elements.locationType.value),
    marina: normalizeOptional(appointmentForm.elements.marinaName.value),
    city: normalizeOptional(appointmentForm.elements.city.value),
    state_province: normalizeOptional(appointmentForm.elements.stateProvince.value),
    country: normalizeOptional(appointmentForm.elements.country.value),
    status: appointmentForm.elements.status.value,
    notes: normalizeOptional(appointmentForm.elements.notes.value),
  });

  if (error) {
    setFormMessage(formMessage, 'Unable to save appointment request.', true);
    return;
  }

  appointmentForm.reset();
  appointmentForm.elements.status.value = 'requested';
  setFormMessage(formMessage, 'Appointment request saved.');
  await loadAll();
});

supabase
  .channel('natalie-data-foundation')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'natalie_conversations' }, loadAll)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'natalie_messages' }, loadAll)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'appointment_requests' }, loadAll)
  .subscribe();

try {
  await loadAll();
} catch (error) {
  console.error(error);
  setFormMessage(pageMessage, 'Unable to load Natalie data foundation.', true);
}
