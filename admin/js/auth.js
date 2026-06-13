import { supabase } from './supabase-client.js';

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

export async function getActiveProfile() {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, active')
    .eq('id', session.user.id)
    .single();

  if (error || !data?.active) {
    await supabase.auth.signOut();
    return null;
  }

  return data;
}

export async function requireActiveProfile() {
  const profile = await getActiveProfile();
  if (!profile) {
    window.location.replace('./login.html');
    throw new Error('Authentication required.');
  }
  return profile;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.replace('./login.html');
}
