import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from '../admin/js/config.js';

const params = new URLSearchParams(window.location.search);
const token = params.get('token') || '';
const loadingState = document.querySelector('#loading-state');
const errorState = document.querySelector('#error-state');
const estimateState = document.querySelector('#estimate-state');
const errorMessage = document.querySelector('#error-message');
const decisionMessage = document.querySelector('#decision-message');
const approveButton = document.querySelector('#approve-estimate');
const rejectButton = document.querySelector('#reject-estimate');
const noteField = document.querySelector('#customer-note');

function showError(message) {
  loadingState.hidden = true;
  estimateState.hidden = true;
  errorMessage.textContent = message;
  errorState.hidden = false;
}

function showDecision(message, isError = false) {
  decisionMessage.textContent = message;
  decisionMessage.classList.toggle('error', isError);
  decisionMessage.hidden = false;
}

function setActionsDisabled(disabled) {
  approveButton.disabled = disabled;
  rejectButton.disabled = disabled;
}

function titleizeStatus(status) {
  return String(status || '-')
    .split('_')
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : '')
    .join(' ');
}

async function callApprovalFunction(action, customerNote = '') {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/submit-estimate-approval`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ token, action, customerNote }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = response.status >= 500
      ? 'Unable to process this approval request. Please contact Marine Consolidated Electronics.'
      : 'This approval link is invalid.';
    throw new Error(body.error || fallback);
  }
  return body;
}

function renderEstimate(data) {
  document.querySelector('#estimate-number').textContent = data.estimate.estimateNumber;
  document.querySelector('#estimate-status').textContent = titleizeStatus(data.estimate.status);
  document.querySelector('#estimate-total').textContent = data.estimate.total;
  document.querySelector('#customer-name').textContent = data.customer.name || '-';
  document.querySelector('#customer-email').textContent = data.customer.email || '-';
  document.querySelector('#vessel-name').textContent = data.vessel.name || '-';
  document.querySelector('#vessel-details').textContent = [
    data.vessel.type,
    [data.vessel.manufacturer, data.vessel.model].filter(Boolean).join(' '),
    data.vessel.registrationNumber,
    data.vessel.location,
  ].filter(Boolean).join(' · ') || '-';
  document.querySelector('#recommended-work').textContent =
    data.estimate.recommendedWork || data.estimate.jobDescription || 'Marine electrical services';

  const decided = ['approved', 'rejected'].includes(data.estimate.status) || data.token.usedAt;
  setActionsDisabled(decided);
  if (decided) {
    showDecision('A customer decision has already been recorded for this estimate.');
  }

  loadingState.hidden = true;
  errorState.hidden = true;
  estimateState.hidden = false;
}

async function loadEstimate() {
  if (!token) {
    showError('This approval link is missing a secure token.');
    return;
  }

  try {
    const data = await callApprovalFunction('view');
    renderEstimate(data);
  } catch (error) {
    showError(error.message);
  }
}

approveButton.addEventListener('click', async () => {
  if (!window.confirm('Approve this estimate?')) return;
  setActionsDisabled(true);
  showDecision('Submitting your approval...');
  try {
    await callApprovalFunction('approve', noteField.value);
    showDecision('Estimate approved. Marine Consolidated Electronics has been notified.');
  } catch (error) {
    setActionsDisabled(false);
    showDecision(error.message, true);
  }
});

rejectButton.addEventListener('click', async () => {
  if (!window.confirm('Reject this estimate?')) return;
  setActionsDisabled(true);
  showDecision('Submitting your response...');
  try {
    await callApprovalFunction('reject', noteField.value);
    showDecision('Estimate rejected. Marine Consolidated Electronics has been notified.');
  } catch (error) {
    setActionsDisabled(false);
    showDecision(error.message, true);
  }
});

await loadEstimate();
