// src/pages/ResultPage.tsx
import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useAnalytics } from '../hooks/useAnalytics';
import { AuthForm } from '../components/AuthForm'; // Import the AuthForm

const ResultPage: React.FC = () => {
  const navigate = useNavigate();
  const { state, ritual, auth, savePerformance, signOut, reset } = useApp();
  const { trackEvent } = useAnalytics();

  const downloadAudio = useCallback(() => {
    if (!state.recordingBlob) return;

    const url = URL.createObjectURL(state.recordingBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.file?.name.replace(/\.[^/.]+$/, "") || 'performance'}-sound-print.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    trackEvent('download_audio', {
      fileName: state.file?.name,
      fileSize: state.recordingBlob.size,
    });
  }, [state.recordingBlob, state.file, trackEvent]);

  const replayRitual = useCallback(() => {
    reset();
    navigate('/instrument');
  }, [navigate, reset]);

  const returnHome = useCallback(() => {
    reset();
    navigate('/');
  }, [navigate, reset]);

  const handleSavePerformance = useCallback(async () => {
    if (!auth.user) return;

    const trackName = state.file?.name || 'Unknown Track';
    const trackHash = btoa(state.file?.name || '') + '-' + state.file?.size;

    await savePerformance(ritual.finalEQState, trackName, trackHash);
    trackEvent('save_performance', { userId: auth.user.id });
    alert("Performance saved to your library.");
  }, [auth.user, state.file, ritual.finalEQState, savePerformance, trackEvent]);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#050810',
      fontFamily: 'monospace'
    }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1.5rem', letterSpacing: '4px' }}>
        YOUR SOUND PRINT
      </h1>

      {/* Visual capture display */}
      <div style={{ marginBottom: '2rem', position: 'relative' }}>
        {ritual.soundPrintDataUrl ? (
          <img
            src={ritual.soundPrintDataUrl}
            alt="Sound Print"
            style={{
              maxWidth: '80vw',
              maxHeight: '40vh',
              border: '2px solid #00ff66',
              borderRadius: '8px',
              boxShadow: '0 0 20px rgba(0, 255, 102, 0.2)'
            }}
          />
        ) : (
          <div style={{
            width: '300px',
            height: '200px',
            border: '1px dashed #333',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ccc'
          }}>
            Capturing Visual...
          </div>
        )}
      </div>

      {auth.isLoading ? (
        <p style={{ color: '#fff' }}>Loading session...</p>
      ) : auth.user ? (
        // LOGGED-IN VIEW
        <>
          <p style={{ marginBottom: '1rem', color: '#fff' }}>Signed in as {auth.user.email}</p>
          <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
            <button
              onClick={downloadAudio}
              style={{
                padding: '10px 20px',
                backgroundColor: '#00ff66',
                color: '#000',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              DOWNLOAD AUDIO
            </button>

            <button
              onClick={handleSavePerformance}
              style={{
                padding: '10px 20px',
                backgroundColor: 'transparent',
                color: '#00ff66',
                border: '1px solid #00ff66',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              SAVE TO LIBRARY
            </button>
          </div>
          <div style={{ display: 'flex', gap: '15px' }}>
            <button
              onClick={replayRitual}
              style={{
                padding: '10px 20px',
                backgroundColor: '#4ade80',
                color: '#000',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              REPLAY RITUAL
            </button>

            <button
              onClick={returnHome}
              style={{
                padding: '10px 20px',
                backgroundColor: '#333',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              RETURN HOME
            </button>

            <button
              onClick={signOut}
              style={{
                padding: '10px 20px',
                backgroundColor: '#6b7280',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              SIGN OUT
            </button>
          </div>
        </>
      ) : (
        // LOGGED-OUT VIEW
        <>
          <AuthForm />
          <div style={{ display: 'flex', gap: '15px', marginTop: '30px' }}>
            <button
              onClick={replayRitual}
              style={{
                padding: '10px 20px',
                backgroundColor: '#4ade80',
                color: '#000',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              REPLAY RITUAL
            </button>

            <button
              onClick={returnHome}
              style={{
                padding: '10px 20px',
                backgroundColor: '#333',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              RETURN HOME
            </button>
          </div>
        </>
      )}

      <p style={{ marginTop: '40px', fontSize: '0.7rem', opacity: 0.4, maxWidth: '300px', textAlign: 'center', color: '#fff' }}>
        ONLY PERFORMANCE DATA + LOGIN ARE STORED. WE DO NOT UPLOAD YOUR AUDIO FILES.
      </p>
    </div>
  );
};

export default ResultPage;