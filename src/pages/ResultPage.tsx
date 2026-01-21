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
  const [recoveredPrint, setRecoveredPrint] = useState<string | null>(null);
  const [recoveredBlob, setRecoveredBlob] = useState<Blob | null>(null);

  // 1. RECOVERY ON MOUNT
  useEffect(() => {
    const savedPrint = sessionStorage.getItem('res_recovery_print');
    const savedBlobUri = sessionStorage.getItem('res_recovery_blob');
    if (savedPrint) setRecoveredPrint(savedPrint);
    if (savedBlobUri) {
      fetch(savedBlobUri).then(res => res.blob()).then(setRecoveredBlob).catch(() => {});
    }
  }, []);

  // 2. SAFE PERSISTENCE (Ensures data is saved BEFORE we leave the page)
  const safePersistAndRedirect = async (provider: 'google' | 'discord') => {
    trackEvent('social_login_attempt', { provider });

    // Save image
    if (ritual.soundPrintDataUrl) {
      sessionStorage.setItem('res_recovery_print', ritual.soundPrintDataUrl);
    }

    // Save audio blob (convert to Base64 and wait for it)
    if (state.recordingBlob) {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(state.recordingBlob!);
      });
      sessionStorage.setItem('res_recovery_blob', base64);
    }

    // Now redirect
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + '/auth/callback' },
    });
  };

  const downloadAudio = useCallback(() => {
    const activeBlob = state.recordingBlob || recoveredBlob;
    if (!auth.user || !activeBlob) {
      alert("No audio data found. Please try the ritual again.");
      return;
    }
    const url = URL.createObjectURL(activeBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.file?.name?.replace(/\.[^/.]+$/, "") || 'performance'}-sound-print.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [state.recordingBlob, recoveredBlob, auth.user, state.file?.name]);

  const isLoggedIn = !!auth.user?.id;
  const currentPrint = ritual.soundPrintDataUrl || recoveredPrint;

  return (
    <div className="res-page-root">
      <div className="res-machine-container">
        
        {/* HARDWARE BACKGROUND */}
        <img src={isLoggedIn ? loggedInSkin : loggedOutSkin} className="res-background-image" alt="" />

        {/* LOGGED IN STATUS */}
        <div className="res-email-overlay">
          {auth.isLoading ? "SYNCING..." : isLoggedIn ? `LOGGED IN: ${auth.user?.email}` : ""}
        </div>

        {/* CENTRAL SCREEN (VISUALIZER) */}
        <div className="res-visualizer-screen">
          {currentPrint && <img src={currentPrint} className="res-print-internal" alt="" />}
        </div>

        {/* INTERACTIVE HOTSPOTS */}
        <div className="res-interactive-layer">
          {isLoggedIn ? (
            <>
              <button className="hs hs-download" onClick={downloadAudio} />
              <button className="hs hs-save" onClick={() => savePerformance(ritual.finalEQState, state.file?.name || 'Track', 'hash')} />
              <button className="hs hs-replay-li" onClick={() => { reset(); navigate('/instrument'); }} />
              <button className="hs hs-home-li" onClick={() => { reset(); navigate('/'); }} />
              <button className="hs hs-signout-li" onClick={signOut} />
            </>
          ) : (
            <>
              <button className="hs hs-google" onClick={() => safePersistAndRedirect('google')} />
              <button className="hs hs-discord" onClick={() => safePersistAndRedirect('discord')} />
              <input type="email" className="hs-input hs-input-email" value={email} onChange={e => setEmail(e.target.value)} />
              <input type="password" className="hs-input hs-input-pass" value={password} onChange={e => setPassword(e.target.value)} />
              <button className="hs hs-email-signin" onClick={() => supabase.auth.signInWithPassword({ email, password })} />
              <button className="hs hs-replay-lo" onClick={() => { reset(); navigate('/instrument'); }} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResultPage;