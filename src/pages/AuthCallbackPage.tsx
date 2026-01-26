// src/pages/AuthCallbackPage.tsx
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function AuthCallbackPage() {
  const [msg, setMsg] = useState('Finalizing login...');

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const url = new URL(window.location.href);
        const hasCode = !!url.searchParams.get('code');

        if (hasCode) {
          const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (error) throw error;
        } else {
          // fallback
          const { error } = await supabase.auth.getSession();
          if (error) throw error;
        }

        if (cancelled) return;

        const dest = sessionStorage.getItem('post-auth-redirect') || '/result';
        sessionStorage.removeItem('post-auth-redirect');

        window.location.replace(dest);
      } catch (e: any) {
        console.error(e);
        if (cancelled) return;
        setMsg(`Login failed: ${e?.message ?? 'unknown error'}`);
        setTimeout(() => window.location.replace('/'), 1200);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ minHeight: '100dvh', background: '#050810', color: '#fff', padding: 24 }}>
      <div style={{ opacity: 0.85 }}>{msg}</div>
    </div>
  );
}