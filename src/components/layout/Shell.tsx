import React from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../../state/AppContext'; // Adjust the import path

export function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { auth, signInWithDiscord } = useApp(); // Destructure signInWithDiscord directly

  // Determine if the "Sign in with Discord" button should be visible in the shell header
  // It should NOT be visible on the UploadPage (root /)
  // It should be visible on the ResultPage (/result) or if the user is already logged out.
  const showSignInButtonInHeader = location.pathname !== '/' && !auth.user;

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      position: 'relative',
      overflow: 'hidden',
      color: '#fff',
    }}>
      {/* Top Status Bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: '0.5rem 1rem',
        fontSize: '0.75rem',
        fontFamily: 'monospace',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 1000,
      }}>
        <span>
          {auth.isLoading ? 'Loading...' :
           auth.user ? `Signed in as ${auth.user.user_metadata?.user_name || 'User'}` :
           'Not signed in – play freely.'}
        </span>
        {/* Only show the sign-in button in the header if explicitly needed (e.g., not on upload page) */}
        {showSignInButtonInHeader && (
          <button
            onClick={signInWithDiscord} // Corrected: call signInWithDiscord directly
            style={{
              padding: '0.25rem 0.5rem',
              backgroundColor: '#00ff66',
              color: '#000',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 'bold',
            }}
          >
            Sign in with Discord
          </button>
        )}
      </div>
      {children}
    </div>
  );
}