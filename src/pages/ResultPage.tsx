// src/pages/ResultPage.tsx
import React, { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useAnalytics } from '../hooks/useAnalytics';

const ResultPage: React.FC = () => {
  const navigate = useNavigate();
  const { state, ritual, auth, savePerformance, signInWithDiscord } = useApp();
  const { trackEvent } = useAnalytics();

  const downloadAudio = useCallback(() => {
    if (!state.recordingBlob) return;

    const url = URL.createObjectURL(state.recordingBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.file?.name.replace(/\.[^/.]+$/, '') || 'performance'}-sound-print.webm`;
    a.click();
    URL.revokeObjectURL(url);

    trackEvent('download_audio', {
      fileName: state.file?.name,
      fileSize: state.recordingBlob.size,
    });
  }, [state.recordingBlob, state.file, trackEvent]);

  const replayRitual = useCallback(() => {
    navigate('/instrument');
  }, [navigate]);

  const returnHome = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const handleSavePerformance = useCallback(async () => {
    if (!auth.user) {
      await signInWithDiscord();
      return;
    }

    const trackName = state.file?.name || 'Unknown Track';
    const trackHash = btoa(state.file?.name || '') + '-' + state.file?.size; // simple hash

    await savePerformance(ritual.finalEQState, trackName, trackHash);
    trackEvent('save_performance', { userId: auth.user.id });
  }, [auth.user, signInWithDiscord, state.file, ritual.finalEQState, savePerformance, trackEvent]);

  // Optional: auto‑download once when they hit this page
  useEffect(() => {
    if (state.recordingBlob) {
      downloadAudio();
    }
  }, [state.recordingBlob, downloadAudio]);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#050810',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '2rem',
        fontFamily: 'monospace',
        color: '#fff',
      }}
    >
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Your Sound Print</h1>

      {/* Thumbnail */}
      {ritual.soundPrintDataUrl && (
        <img
          src={ritual.soundPrintDataUrl}
          alt="Sound Print Thumbnail"
          style={{
            maxWidth: '80%',
            maxHeight: '300px',
            objectFit: 'contain',
            marginBottom: '1rem',
            border: '2px solid #00ff66',
            borderRadius: '8px',
          }}
        />
      )}

      {/* Download + nav */}
      <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
        <button
          onClick={downloadAudio}
          disabled={!state.recordingBlob}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#00ff66',
            color: '#000',
            border: 'none',
            borderRadius: '4px',
            cursor: state.recordingBlob ? 'pointer' : 'not-allowed',
            fontWeight: 'bold',
          }}
        >
          Download again
        </button>

        <button
          onClick={replayRitual}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#4ade80',
            color: '#000',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          Replay Ritual
        </button>

        <button
          onClick={returnHome}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#6b7280',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          Return Home
        </button>
      </div>

      {/* Phase‑4 auth section */}
      <div style={{ marginTop: '2rem', fontSize: '0.9rem', opacity: 0.9 }}>
        {auth.isLoading ? (
          'Checking login…'
        ) : auth.user ? (
          <>
            Signed in as {auth.user.user_metadata?.user_name || 'traveler'}.<br />
            Performances will be saved to your Sound Prints.
            <div style={{ marginTop: '0.75rem' }}>
              <button
                onClick={handleSavePerformance}
                style={{
                  padding: '0.35rem 0.75rem',
                  backgroundColor: '#00ff66',
                  color: '#000',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                }}
              >
                Save this performance
              </button>
            </div>
          </>
        ) : (
          <>
            Want to save this as a “Sound Print”?<br />
            <button
              onClick={signInWithDiscord}
              style={{
                marginTop: '0.5rem',
                padding: '0.35rem 0.75rem',
                backgroundColor: '#00ff66',
                color: '#000',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 'bold',
              }}
            >
              Sign in with Discord
            </button>
            <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', opacity: 0.7 }}>
              We don’t upload your MP3s. Only your performance data + login are stored.
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ResultPage;