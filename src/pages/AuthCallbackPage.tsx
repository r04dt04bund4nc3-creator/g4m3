// src/pages/AuthCallbackPage.tsx
import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function AuthCallbackPage() {
  const [msg, setMsg] = useState('Finalizing login...');
  const processedRef = useRef(false);

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 3;

    const run = async () => {
      try {
        const url = new URL(window.location.href);
        const hasCode = !!url.searchParams.get('code');
        const hasError = url.searchParams.get('error');

        if (hasError) {
          throw new Error(url.searchParams.get('error_description') || 'OAuth error');
        }

        if (hasCode) {
          while (retryCount < maxRetries) {
            try {
              const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
              if (error) throw error;
              break;
            } catch (pkceErr: any) {
              retryCount++;
              console.warn(`PKCE attempt ${retryCount} failed:`, pkceErr.message);
              
              if (retryCount >= maxRetries) {
                const { data } = await supabase.auth.getSession();
                if (!data.session) throw pkceErr;
                console.warn('PKCE failed but session recovered via fallback');
              } else {
                await new Promise(r => setTimeout(r, 500 * retryCount));
              }
            }
          }
        }

        let sessionVerified = false;
        let verifyAttempts = 0;
        while (!sessionVerified && verifyAttempts < 10) {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            sessionVerified = true;
            break;
          }
          verifyAttempts++;
          await new Promise(r => setTimeout(r, 200));
        }

        if (!sessionVerified) {
          throw new Error('Session could not be verified');
        }

        await new Promise(r => setTimeout(r, 300));
        if (cancelled) return;

        // ✅ ROBUST: Handle both '/result' and 'result'
        let dest = sessionStorage.getItem('post-auth-redirect') || '/result';
        sessionStorage.removeItem('post-auth-redirect');
        
        // Ensure leading slash
        if (!dest.startsWith('/')) dest = '/' + dest;

        window.location.replace(dest);
      } catch (e: any) {
        console.error('Auth Error:', e);
        if (cancelled) return;
        setMsg(`Login failed: ${e?.message ?? 'Unknown Error'}`);
        setTimeout(() => window.location.replace('/'), 3000);
      }
    };

    run();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ 
      minHeight: '100dvh', 
      background: '#050810', 
      color: '#00ff9d', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      fontFamily: 'Courier New, monospace',
      flexDirection: 'column',
      gap: '16px'
    }}>
      <div style={{ opacity: 0.85 }}>{msg}</div>
      <div style={{ 
        width: '40px', 
        height: '40px', 
        border: '2px solid #00ff9d',
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite'
      }} />
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}