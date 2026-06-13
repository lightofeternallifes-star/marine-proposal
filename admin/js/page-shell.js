import { requireActiveProfile, signOut } from './auth.js';

export async function initializePageShell() {
  const profile = await requireActiveProfile();
  const userName = document.querySelector('#user-name');
  const signOutButton = document.querySelector('#sign-out');

  if (userName) {
    userName.textContent = profile.full_name;
  }
  if (signOutButton) {
    signOutButton.addEventListener('click', signOut);
  }

  return profile;
}

export function normalizeOptional(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function setFormMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error', isError);
  element.hidden = false;
}
