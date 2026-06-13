import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0';
import { assertConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';

assertConfigured();

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
