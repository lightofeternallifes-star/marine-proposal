import { getSession } from './auth.js';
import { supabase } from './supabase-client.js';

const existingSession = await getSession();
if (existingSession) {
  window.location.replace('./dashboard.html');
}

const form = document.querySelector('#login-form');
const submitButton = document.querySelector('#login-submit');
const errorMessage = document.querySelector('#login-error');
const resetButton = document.querySelector('#reset-password');
const resetMessage = document.querySelector('#reset-message');

function showMessage(element, message) {
  element.textContent = message;
  element.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;

  if (!form.reportValidity()) {
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Signing in...';

  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    showMessage(errorMessage, 'Unable to sign in. Check your credentials and try again.');
    submitButton.disabled = false;
    submitButton.textContent = 'Sign in';
    return;
  }

  window.location.replace('./dashboard.html');
});

resetButton.addEventListener('click', async () => {
  resetMessage.hidden = true;
  errorMessage.hidden = true;

  const email = form.elements.email.value.trim();
  if (!email) {
    showMessage(errorMessage, 'Enter your email address before requesting a reset.');
    return;
  }

  resetButton.disabled = true;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL('./reset-password.html', window.location.href).href,
  });
  resetButton.disabled = false;

  if (error) {
    showMessage(errorMessage, 'Unable to send the password reset email.');
    return;
  }

  showMessage(resetMessage, 'If the account exists, password reset instructions were sent.');
});
