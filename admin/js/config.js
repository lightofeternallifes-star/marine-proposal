export const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

export function assertConfigured() {
  if (
    SUPABASE_URL.includes('YOUR_PROJECT_REF')
    || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY'
  ) {
    throw new Error('MarineQuote Supabase configuration is not installed.');
  }
}
