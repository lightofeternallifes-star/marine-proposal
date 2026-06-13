export const SUPABASE_URL = 'https://wxhqhlwfwsrarhacdzlu.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_MIQiUgq7DlztkUtbpYKyjw_meodztPT';

export function assertConfigured() {
  if (
    SUPABASE_URL.includes('YOUR_PROJECT_REF')
    || !SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')
  ) {
    throw new Error('MarineQuote Supabase configuration is not installed.');
  }
}
