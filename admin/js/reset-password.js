import { supabase } from './supabase-client.js';

const form = document.querySelector('#password-form');
const submitButton = document.querySelector('#password-submit');
const errorMessage = document.querySelector('#password-error');
const successMessage = document.querySelector('#password-success');

function showMessage(element, message) {
  element.textContent = message;
  element.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;
  successMessage.hidden = true;

  if (!form.reportValidity()) {
    return;
  }

  const password = form.elements.password.value;
  const confirmation = form.elements.passwordConfirmation.value;

  if (password !== confirmation) {
    showMessage(errorMessage, 'Passwords do not match.');
    return;
  }

  submitButton.disabled = true;
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    showMessage(errorMessage, 'Unable to update the password. Request a new reset link.');
    submitButton.disabled = false;
    return;
  }

  showMessage(successMessage, 'Password updated. Redirecting to MarineQuote...');
  window.setTimeout(() => window.location.replace('./dashboard.html'), 900);
});
