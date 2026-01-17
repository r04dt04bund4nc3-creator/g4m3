// src/pages/ResultPage.tsx
import React, { useCallback } from 'react'; // Removed useEffect
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useAnalytics } from '../hooks/useAnalytics';

const ResultPage: React.FC = () => {
  const navigate = useNavigate();
  const { state, ritual, auth, savePerformance, signInWithDiscord, reset } = useApp(); // Destructure signInWithDiscord and reset
  const { trackEvent } = useAnalytics();

  const downloadAudio = useCallback(() => {
    if (!state.recordingBlob) return;

    const url = URL.createObjectURL(state.recordingBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.file?.name.replace(/\.[^/.]+$/, "") || 'performance'}-sound-print.webm`;
    document.body.appendChild(a); // Append to body to ensure it's clickable
    a.click();
    document.body.removeChild(a); // Clean up the element
    URL.revokeObjectURL(url);

    trackEvent('download_audio', {
      fileName: state.file?.name,
      fileSize: state.recordingBlob.size,
    });
  }, [state.recordingBlob, state.file, trackEvent]);

  const replayRitual = useCallback(() => {
    reset(); // Reset the app state before navigating to replay
    navigate('/instrument');
  }, [navigate, reset]);

  const returnHome = useCallback(() => {
    reset(); // Reset the app state before navigating home
    navigate('/');
  }, [navigate, reset]);

  const handleSavePerformance = useCallback(async () => {
    if (!auth.user) {
      alert("You need to sign in to save your performance.");
      return;
    }

    const trackName = state.file?.name || 'Unknown Track';
    // A simple hash for now. For robust hashing, you'd use a crypto library.
    const trackHash = btoa(state.file?.name || '') + '-' + state.file?.size; 

    await savePerformance(ritual.finalEQState, trackName, trackHash);
    trackEvent('save_performance', { userId: auth.user.id });
    alert("Performance saved successfully!");
  }, [auth.user, state.file, ritual.finalEQState, savePerformance, trackEvent]);

  // Removed useEffect for auto-download. Download is now only on button click.

  return (
    <div className="result-page"> {/* Using class for styling */}
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Your Sound Print is Ready</h1>

      {/* Thumbnail */}
      {ritual.soundPrintDataUrl ? (
        <img
          src={ritual.soundPrintDataUrl}
          alt="Sound Print Thumbnail"
          style={{
            maxWidth: '80%',
            maxHeight: '300px',
            objectFit: 'contain',
            marginBottom: '1rem',
            border: '2px solid #00ff66',
            borderRadius: '8px'
          }}
        />
      ) : (
        <div style={{
          maxWidth: '80%',
          maxHeight: '300px',
          width: '400px', // Placeholder size
          height: '200px', // Placeholder size
          backgroundColor: '#333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ccc',
          marginBottom: '1rem',
          border: '2px dashed #00ff66',
          borderRadius: '8px'
        }}>
          No Visual Sound Print Captured
        </div>
      )}

      {/* Actions */}
      <div className="actions">
        <button
          onClick={downloadAudio}
          disabled={!state.recordingBlob}
          className="download"
        >
          Download Audio
        </button>

        <button
          onClick={replayRitual}
          className="replay"
        >
          Replay Ritual
        </button>

        <button
          onClick={returnHome}
          className="home"
        >
          Return Home
        </button>
      </div>

      {/* Save option */}
      <div className="save-option">
        {auth.isLoading ? 'Checking login...' :
         auth.user ? (
           <button
             onClick={handleSavePerformance}
             style={{
               padding: '0.25rem 0.5rem',
               backgroundColor: '#00ff66',
               color: '#000',
               border: 'none',
               borderRadius: '4px',
               cursor: 'pointer',
               fontSize: '0.8rem',
             }}
           >
             Save to My Library
           </button>
         ) : (
           <div>
             Want to save this as a "Sound Print"?
             <br />
             <button
               onClick={signInWithDiscord} // Corrected: call signInWithDiscord directly
               style={{
                 padding: '0.25rem 0.5rem',
                 backgroundColor: '#00ff66',
                 color: '#000',
                 border: 'none',
                 borderRadius: '4px',
                 cursor: 'pointer',
                 fontSize: '0.8rem',
                 marginTop: '0.5rem',
               }}
             >
               Sign in with Discord
             </button>
           </div>
         )}
      </div>

      {/* Footer note */}
      <p className="footer-note">
        We don’t upload your MP3s. Only your performance data + login are stored.
      </p>
    </div>
  );
};

export default ResultPage;