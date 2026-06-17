import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  assertConfigured,
} from '../admin/js/config.js';

assertConfigured();

const form = document.querySelector('#lead-form');
const submitButton = document.querySelector('#lead-submit');
const message = document.querySelector('#lead-message');

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle('error', isError);
  message.hidden = false;
}

function formValue(name) {
  return String(form.elements[name]?.value || '').trim();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.hidden = true;

  if (!form.reportValidity()) return;

  submitButton.disabled = true;
  submitButton.textContent = 'Submitting...';

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/submit-lead`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        fullName: formValue('fullName'),
        phone: formValue('phone'),
        email: formValue('email'),
        vesselName: formValue('vesselName'),
        boatType: formValue('boatType'),
        marinaName: formValue('marinaName'),
        city: formValue('city'),
        serviceType: formValue('serviceType'),
        problemDescription: formValue('problemDescription'),
        priority: formValue('priority'),
        companyWebsite: formValue('companyWebsite'),
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || 'Unable to submit your request.');
    }

    form.reset();
    setMessage('Request received. Marine Consolidated Electronics will follow up shortly.');
  } catch (error) {
    setMessage(error.message || 'Unable to submit your request. Please call us directly.', true);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Request Service';
  }
});
