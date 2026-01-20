import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useAnalytics } from '../hooks/useAnalytics';
import { AuthForm } from '../components/ui/AuthForm';

import loggedOutSkin from '../assets/result-logged-out.webp';
import loggedInSkin from '../assets/result-logged-in.webp';
import './ResultPage.css';

const ResultPage: React.FC = () => {
  const navigate = useNavigate();
  const { state, ritual, auth, savePerformance, signOut, reset } = useApp();
  const { trackEvent } = useAnalytics();

  const downloadAudio = useCallback(() => {
    if (!auth.user || !state.recordingBlob) return;

    // Analytics tracking
    trackEvent('download_audio', { fileName: state.file?.name });

    const url = URL.createObjectURL(state.recordingBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.file?.name.replace(/\.[^/.]+$/, "") || 'performance'}-sound-print.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [state.recordingBlob, state.file, auth.user, trackEvent]);

  const handleSave = async () => {
    if (!auth.user) return;

    const trackName = state.file?.name || 'Unknown Track';
    const trackHash = btoa(state.file?.name || '') + '-' + state.file?.size;

    await savePerformance(ritual.finalEQState, trackName, trackHash);
    
    // Analytics tracking
    trackEvent('save_performance', { userId: auth.user.id });
    
    alert("Saved to library.");
  };

  const replay = () => {
    trackEvent('ritual_replay');
    reset(); 
    navigate('/instrument'); 
  };

  const goHome = () => { 
    reset(); 
    navigate('/'); 
  };

  const isLoggedIn = !!auth.user?.id;

  return (
    /* res-root-override uses 'all: unset' in CSS to block old App.css styles */
    <div className="res-root-override">
      <div className="res-machine-container">
        
        {/* The hardware background */}
        <img 
          src={isLoggedIn ? loggedInSkin : loggedOutSkin} 
          className="res-background-image" 
          alt="" 
        />

        {/* Dynamic Email / Status text overlay */}
        <div className="res-email-overlay">
          {auth.isLoading ? "SYNCING..." : 
           isLoggedIn ? `Signed in as ${auth.user?.email}` : 
           ""}
        </div>

        {/* The central glass screen area for the Sound Print */}
        <div className="res-visualizer-screen">
          {ritual.soundPrintDataUrl && (
            <img 
              src={ritual.soundPrintDataUrl} 
              className="res-print-internal" 
              alt="Sound Print" 
            />
          )}
        </div>

        {/* Invisible interactive buttons (Hotspots) */}
        <div className="res-interactive-layer">
          {isLoggedIn ? (
            <>
              <button className="hs hs-download" onClick={downloadAudio} title="Download Audio" />
              <button className="hs hs-save" onClick={handleSave} title="Save to Library" />
              <button className="hs hs-replay" onClick={replay} title="Replay Ritual" />
              <button className="hs hs-home" onClick={goHome} title="Return Home" />
              <button className="hs hs-signout" onClick={signOut} title="Sign Out" />
            </>
          ) : (
            <>
              {/* Login form positioned over the wood panel */}
              <div className="res-auth-box-position">
                <AuthForm />
              </div>
              {/* Smaller hotspots for the logged-out state */}
              <button className="hs hs-replay-lo" onClick={replay} title="Replay Ritual" />
              <button className="hs hs-home-lo" onClick={goHome} title="Return Home" />
            </>
          )}
        </div>

      </div>
    </div>
  );
};

export default ResultPage;