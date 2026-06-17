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

function customerLabel(customer, lead) {
  if (customer?.company_name) return `${customer.contact_name} - ${customer.company_name}`;
  return customer?.contact_name || lead?.full_name || 'Unknown customer';
}

function vesselLabel(vessel, lead) {
  return vessel?.vessel_name || lead?.vessel_name || 'No vessel recorded';
}

function leadLabel(lead) {
  return `${lead.full_name} · ${lead.email} · ${lead.service_type}`;
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
    title.textContent = customerLabel(conversation.customers, conversation.leads);

    const vessel = document.createElement('span');
    vessel.textContent = vesselLabel(conversation.vessels, conversation.leads);

    const meta = document.createElement('small');
    meta.textContent = `${statusLabels[conversation.status] || conversation.status} · ${conversation.channel} · ${formatDate(conversation.last_message_at || conversation.updated_at)}`;

    card.append(title, vessel, meta);
    card.addEventListener('click', () => selectConversation(conversation.id));
    conversationList.append(card);
  }
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
      <tr><th>Customer</th><th>Requested</th><th>Location</th><th>Status</th><th>Created</th></tr>
    </thead>
    <tbody></tbody>
  `;
  const body = table.querySelector('tbody');
  for (const appointment of relatedAppointments) {
    const row = document.createElement('tr');
    const location = [
      appointment.marina_name,
      appointment.city,
      appointment.state_province,
      appointment.country,
    ].filter(Boolean).join(', ') || appointment.location_type || '-';
    const customer = appointment.customers?.company_name
      ? `${appointment.customers.contact_name} - ${appointment.customers.company_name}`
      : appointment.customers?.contact_name || '-';
    const values = [
      customer,
      appointment.requested_time_text || formatDate(appointment.requested_start_at),
      location,
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
    .from('leads')
    .select('id, full_name, email, phone, vessel_name, boat_type, service_type, customer_id, vessel_id, pipeline_id')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  leads = data;
  populateLeadSelect();
}

async function loadConversations() {
  const { data, error } = await supabase
    .from('conversations')
    .select(`
      *,
      leads(full_name, email, phone, vessel_name, service_type, priority),
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
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(250);
  if (error) throw error;
  messages = data;
}

async function loadAppointments() {
  const { data, error } = await supabase
    .from('appointments')
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
  conversationForm.elements.channel.value = 'web';
  conversationForm.elements.status.value = 'active';
  document.querySelector('#conversation-form-message').hidden = true;
  conversationEditor.hidden = false;
  conversationEditor.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelector('#close-conversation-editor').addEventListener('click', () => {
  conversationEditor.hidden = true;
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

  const payload = {
    lead_id: lead.id,
    customer_id: lead.customer_id,
    vessel_id: lead.vessel_id,
    pipeline_id: lead.pipeline_id,
    channel: conversationForm.elements.channel.value,
    external_contact_id: lead.phone || lead.email,
    status: conversationForm.elements.status.value,
    qualification_state: 'started',
    current_question_key: normalizeOptional(conversationForm.elements.currentQuestionKey.value),
    assigned_to: profile.id,
    qualification_summary: {
      source: 'manual_admin_foundation',
      lead_service_type: lead.service_type,
    },
  };

  const { error } = await supabase.from('conversations').insert(payload);
  if (error) {
    setFormMessage(formMessage, 'Unable to create conversation.', true);
    return;
  }

  setFormMessage(formMessage, 'Conversation created.');
  await loadAll();
  window.setTimeout(() => { conversationEditor.hidden = true; }, 500);
});

messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formMessage = document.querySelector('#message-form-message');
  formMessage.hidden = true;
  if (!messageForm.reportValidity() || !selectedConversation) return;

  const { error } = await supabase.from('messages').insert({
    conversation_id: selectedConversation.id,
    lead_id: selectedConversation.lead_id,
    customer_id: selectedConversation.customer_id,
    direction: messageForm.elements.direction.value,
    sender_type: messageForm.elements.senderType.value,
    channel: selectedConversation.channel,
    body: messageForm.elements.body.value.trim(),
    structured_payload: {},
    delivery_status: messageForm.elements.direction.value === 'outbound' ? 'sent' : null,
  });

  if (error) {
    setFormMessage(formMessage, 'Unable to save message.', true);
    return;
  }

  messageForm.reset();
  messageForm.elements.senderType.value = 'staff';
  messageForm.elements.direction.value = 'outbound';
  setFormMessage(formMessage, 'Message saved.');
  await loadAll();
});

appointmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formMessage = document.querySelector('#appointment-form-message');
  formMessage.hidden = true;
  if (!appointmentForm.reportValidity() || !selectedConversation) return;

  const date = appointmentForm.elements.requestedDate.value;
  const time = appointmentForm.elements.requestedTime.value;
  const requestedStartAt = date && time
    ? new Date(`${date}T${time}:00`).toISOString()
    : null;
  const requestedTimeText = date || time
    ? [date, time].filter(Boolean).join(' ')
    : null;

  const { error } = await supabase.from('appointments').insert({
    lead_id: selectedConversation.lead_id,
    customer_id: selectedConversation.customer_id,
    vessel_id: selectedConversation.vessel_id,
    pipeline_id: selectedConversation.pipeline_id,
    conversation_id: selectedConversation.id,
    requested_start_at: requestedStartAt,
    requested_time_text: requestedTimeText,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    location_type: normalizeOptional(appointmentForm.elements.locationType.value),
    marina_name: normalizeOptional(appointmentForm.elements.marinaName.value),
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
  .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, loadAll)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, loadAll)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, loadAll)
  .subscribe();

try {
  await loadAll();
} catch (error) {
  console.error(error);
  setFormMessage(pageMessage, 'Unable to load Natalie data foundation.', true);
}
