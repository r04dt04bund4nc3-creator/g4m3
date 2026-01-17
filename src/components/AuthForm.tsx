// src/components/AuthForm.tsx
import React, { useState } from 'react';
import { useApp } from '../state/AppContext';

const buttonBaseStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: 'bold',
  fontSize: '1rem',
  marginBottom: '10px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '10px'
};

export const AuthForm: React.FC = () => {
  const { signInWithGoogle, signInWithDiscord, signInWithEmail } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    const { error } = await signInWithEmail(email, password);
    if (error) {
      setError(error.message);
    } else {
      setMessage('Check your email for the login link!');
    }
  };

  return (
    <div style={{
      width: '100%',
      maxWidth: '320px',
      textAlign: 'center',
      fontFamily: 'monospace'
    }}>
      <h3 style={{ marginBottom: '20px', color: '#fff' }}>SIGN IN TO DOWNLOAD & SAVE</h3>

      {/* Social Logins */}
      <button style={{ ...buttonBaseStyle, backgroundColor: '#4285F4', color: 'white' }} onClick={signInWithGoogle}>
        Sign in with Google
      </button>
      <button style={{ ...buttonBaseStyle, backgroundColor: '#5865F2', color: 'white' }} onClick={signInWithDiscord}>
        Sign in with Discord
      </button>

      {/* Separator */}
      <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0', color: '#666' }}>
        <hr style={{ flex: 1, borderColor: '#333' }} />
        <span style={{ padding: '0 10px' }}>OR</span>
        <hr style={{ flex: 1, borderColor: '#333' }} />
      </div>

      {/* Email Form */}
      <form onSubmit={handleEmailSignIn}>
        <input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: '#fff' }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: '#fff' }}
        />
        <button type="submit" style={{ ...buttonBaseStyle, backgroundColor: '#00ff66', color: '#000' }}>
          Sign In with Email
        </button>
      </form>
      {error && <p style={{ color: '#ff4d4d', fontSize: '0.8rem', marginTop: '10px' }}>{error}</p>}
      {message && <p style={{ color: '#4ade80', fontSize: '0.8rem', marginTop: '10px' }}>{message}</p>}
    </div>
  );
};