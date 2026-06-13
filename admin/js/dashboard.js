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

await loadCounts();
