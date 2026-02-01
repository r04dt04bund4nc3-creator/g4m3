// src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ✅ CRITICAL: Detect environment for storage isolation
const isProduction = import.meta.env.PROD;
const storageKey = isProduction 
  ? 'sb-4b4ku5-auth-token' 
  : `sb-local-auth-token-${import.meta.env.VITE_SUPABASE_URL?.slice(-8) ?? 'dev'}`;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // ✅ FIXED: Use PKCE for security, but with proper storage isolation
    flowType: 'pkce',
    storage: localStorage,
    storageKey: storageKey,
  },
});