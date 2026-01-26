import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Please check your .env file has VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'
  );
}

// Create Supabase client with extended timeout and no realtime
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false, // Disable to prevent lock timeout
    persistSession: true,
    detectSessionInUrl: false,
    storageKey: 'sb-auth-token',
    storage: window.localStorage
  },
  db: {
    schema: 'public'
  },
  global: {
    headers: {
      'X-Client-Info': 'license-exam-prep',
      'apikey': supabaseAnonKey
    }
  }
});

// Helper to get current session
export const getCurrentSession = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
};

// Helper to get auth token for API calls
export const getAuthToken = async (): Promise<string | null> => {
  const session = await getCurrentSession();
  return session?.access_token || null;
};
