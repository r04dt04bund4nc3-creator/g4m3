import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useAnalytics } from '../hooks/useAnalytics';
import { supabase } from '../lib/supabaseClient';

import loggedOutSkin from '../assets/result-logged-out.webp';
import loggedInSkin from '../assets/result-logged-in.webp';
import './ResultPage.css';

const ResultPage: React.FC = () => {
  const navigate = useNavigate();
  const { state, ritual, auth, savePerformance, signOut, reset } = useApp();
  const { trackEvent } = useAnalytics();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Local "Recovery" state for OAuth redirects
  const [recoveredPrint, setRecoveredPrint] = useState<string | null>(null);
  const [recoveredBlob, setRecoveredBlob] = useState<Blob | null>(null);

  // 1. PERSISTENCE LOGIC: Save state before OAuth redirect
  const persistStateForAuth = async () => {
    if (ritual.soundPrintDataUrl) {
      sessionStorage.setItem('res_recovery_print', ritual.soundPrintDataUrl);
    }
    if (state.recordingBlob) {
      // Convert blob to base64 for session storage (temporary fix for redirect)
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        sessionStorage.setItem('res_recovery_blob', base64data);
      };
      reader.readAsDataURL(state.recordingBlob);
    }
  };

  // 2. RECOVERY LOGIC: Load state after redirect
  useEffect(() => {
    const savedPrint = sessionStorage.getItem('res_recovery_print');
    const savedBlobUri = sessionStorage.getItem('res_recovery_blob');

    if (savedPrint) setRecoveredPrint(savedPrint);
    
    if (savedBlobUri) {
      fetch(savedBlobUri)
        .then(res => res.blob())
        .then(blob => setRecoveredBlob(blob));
    }
  }, []);

  const getRedirectUrl = () => window.location.origin + '/auth/callback';

  const handleSocialLogin = async (provider: 'google' | 'discord') => {
    trackEvent('social_login_attempt', { provider });
    await persistStateForAuth(); // Save before we leave the page
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: getRedirectUrl() },
    });
  };

  const handleEmailSignIn = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    trackEvent('email_login_attempt');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: getRedirectUrl() },
      });
      alert('Check your email for the login link!');
    }
  };

  const downloadAudio = useCallback(() => {
    const activeBlob = state.recordingBlob || recoveredBlob;
    if (!auth.user || !activeBlob) {
      alert("No audio data found. Please try the ritual again.");
      return;
    }
    
    trackEvent('download_audio', { fileName: state.file?.name });
    const url = URL.createObjectURL(activeBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.file?.name?.replace(/\.[^/.]+$/, "") || 'performance'}-sound-print.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [state.recordingBlob, recoveredBlob, state.file, auth.user, trackEvent]);

  const handleSave = async () => {
    if (!auth.user) return;
    const trackName = state.file?.name || 'Unknown Track';
    const trackHash = btoa(state.file?.name || '') + '-' + state.file?.size;
    await savePerformance(ritual.finalEQState, trackName, trackHash);
    trackEvent('save_performance', { userId: auth.user.id });
    alert("Saved to library.");
  };

  const replay = () => {
    sessionStorage.clear(); // Clear recovery on intentional exit
    reset(); 
    navigate('/instrument'); 
  };

  const goHome = () => { 
    sessionStorage.clear();
    reset(); 
    navigate('/'); 
  };

  const isLoggedIn = !!auth.user?.id;
  const currentPrint = ritual.soundPrintDataUrl || recoveredPrint;

  return (
    <div className="res-page-root">
      <div className="res-machine-container">
        
        <img 
          src={isLoggedIn ? loggedInSkin : loggedOutSkin} 
          className="res-background-image"
          alt="" 
        />

        <div className="res-email-overlay">
          {auth.isLoading ? "SYNCING..." : isLoggedIn ? `LOGGED IN: ${auth.user?.email}` : ""}
        </div>

        <div className="res-visualizer-screen">
          {currentPrint && (
            <img 
              src={currentPrint} 
              className="res-print-internal"
              alt="Sound Print" 
            />
          )}
        </div>

        <div className="res-interactive-layer">
          {isLoggedIn ? (
            <>
              <button className="hs hs-download" onClick={downloadAudio} />
              <button className="hs hs-save" onClick={handleSave} />
              <button className="hs hs-replay-li" onClick={replay} />
              <button className="hs hs-home-li" onClick={goHome} />
              <button className="hs hs-signout-li" onClick={signOut} />
            </>
          ) : (
            <>
              <button className="hs hs-google" onClick={() => handleSocialLogin('google')} />
              <button className="hs hs-discord" onClick={() => handleSocialLogin('discord')} />
              
              <input 
                type="email" 
                className="hs-input hs-input-email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input 
                type="password" 
                className="hs-input hs-input-pass" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <button className="hs hs-email-signin" onClick={() => handleEmailSignIn()} />
              <button className="hs hs-replay-lo" onClick={replay} />
            </>
          )}
        </div>

      </div>
    </div>
  );
};

export default ResultPage;