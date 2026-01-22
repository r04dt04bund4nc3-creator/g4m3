import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useAnalytics } from '../hooks/useAnalytics';
import { supabase } from '../lib/supabaseClient';

import loggedOutSkin from '../assets/result-logged-out.webp';
import loggedInSkin from '../assets/result-logged-in.webp';
import './ResultPage.css';

// --- PERSISTENCE HELPERS (INDEXED DB) ---
const DB_NAME = 'G4M3_DB';
const STORE_NAME = 'blobs';
const openDB = () => new Promise<IDBDatabase>((res, rej) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});
const saveBlob = async (key: string, blob: Blob) => {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
};
const loadBlob = async (key: string) => {
  const db = await openDB();
  return new Promise<Blob | null>((res, rej) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

const ResultPage: React.FC = () => {
  const navigate = useNavigate();
  const { state, ritual, auth, savePerformance, signOut, reset } = useApp();
  const { trackEvent } = useAnalytics();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recoveredPrint, setRecoveredPrint] = useState<string | null>(null);
  const [recoveredBlob, setRecoveredBlob] = useState<Blob | null>(null);

  useEffect(() => {
    const recover = async () => {
      const savedPrint = sessionStorage.getItem('res_recovery_print');
      if (savedPrint) setRecoveredPrint(savedPrint);
      const blob = await loadBlob('res_recovery_blob');
      if (blob) setRecoveredBlob(blob);
    };
    recover();
  }, []);

  const safePersistAndRedirect = async (provider: 'google' | 'discord') => {
    trackEvent('social_login_attempt', { provider });
    if (ritual.soundPrintDataUrl) sessionStorage.setItem('res_recovery_print', ritual.soundPrintDataUrl);
    if (state.recordingBlob) await saveBlob('res_recovery_blob', state.recordingBlob);
    
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + '/auth/callback' },
    });
  };

  const downloadSession = useCallback(() => {
    const activeBlob = state.recordingBlob || recoveredBlob;
    if (!auth.user || !activeBlob) {
      alert("No recording data found. Please try the ritual again.");
      return;
    }
    const url = URL.createObjectURL(activeBlob);
    const a = document.createElement('a');
    a.href = url;
    // EXTENSION IS NOW WEBM (VIDEO)
    const ext = activeBlob.type.includes('video') ? 'webm' : 'webm';
    a.download = `${state.file?.name?.replace(/\.[^/.]+$/, "") || 'ritual'}-session.${ext}`;
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
        <img src={isLoggedIn ? loggedInSkin : loggedOutSkin} className="res-background-image" alt="" />
        <div className="res-email-overlay">
          {auth.isLoading ? "SYNCING..." : isLoggedIn ? `LOGGED IN: ${auth.user?.email}` : ""}
        </div>

        <div className="res-visualizer-screen">
          {currentPrint && <img src={currentPrint} className="res-print-internal" alt="" />}
        </div>

        <div className="res-interactive-layer">
          {isLoggedIn ? (
            <>
              <button className="hs hs-download" onClick={downloadSession} />
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