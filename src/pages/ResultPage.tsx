// src/pages/ResultPage.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useAnalytics } from '../hooks/useAnalytics';
import { supabase } from '../lib/supabaseClient';

import loggedOutSkin from '../assets/result-logged-out.webp';
import loggedInSkin from '../assets/result-logged-in.webp';
import './ResultPage.css';

/** DB Helpers */
const DB_NAME = 'G4BKU5_DB';
const STORE_NAME = 'blobs';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(blob, key);
  db.close();
}

async function loadBlob(key: string): Promise<Blob | null> {
  const db = await openDB();
  const blob = await new Promise<Blob | null>((resolve) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as Blob || null);
    req.onerror = () => resolve(null);
  });
  db.close();
  return blob;
}

const RECOVERY_BLOB_KEY = 'res_recovery_blob';
const RECOVERY_PRINT_KEY = 'res_recovery_print';

function buildSessionFileName(file?: File | null): string {
  const now = new Date();
  const stamp = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `4B4KU5-${stamp}.webm`;
}

const ResultPage: React.FC = () => {
  const navigate = useNavigate();
  const { state, ritual, auth, signOut, reset } = useApp();
  const { trackEvent } = useAnalytics();

  const [recoveredPrint, setRecoveredPrint] = useState<string | null>(null);
  const [recoveredBlob, setRecoveredBlob] = useState<Blob | null>(null);

  useEffect(() => {
    const run = async () => {
      const savedPrint = sessionStorage.getItem(RECOVERY_PRINT_KEY);
      if (savedPrint) setRecoveredPrint(savedPrint);
      const b = await loadBlob(RECOVERY_BLOB_KEY);
      if (b) setRecoveredBlob(b);
    };
    run();
  }, []);

  const effectiveBlob = state.recordingBlob ?? recoveredBlob;

  const safePersistAndRedirect = useCallback(async (provider: 'discord') => {
    sessionStorage.setItem('post-auth-redirect', '/result');
    if (ritual.soundPrintDataUrl) sessionStorage.setItem(RECOVERY_PRINT_KEY, ritual.soundPrintDataUrl);
    if (state.recordingBlob) await saveBlob(RECOVERY_BLOB_KEY, state.recordingBlob);

    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + '/auth/callback' },
    });
  }, [ritual.soundPrintDataUrl, state.recordingBlob]);

  const downloadSession = useCallback(() => {
    if (!effectiveBlob) return alert('No recording data found.');
    const url = URL.createObjectURL(effectiveBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildSessionFileName(state.file);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [effectiveBlob, state.file]);

  const goHome = () => navigate('/'); // NON-DESTRUCTIVE: Keep data for now

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const isLoggedIn = !!auth.user?.id;
  const currentPrint = ritual.soundPrintDataUrl || recoveredPrint;

  return (
    <div className="res-page-root">
      <div className="res-machine-container">
        <img src={isLoggedIn ? loggedInSkin : loggedOutSkin} className="res-background-image" alt="" />

        <div className="res-visualizer-screen">
          {currentPrint && <img src={currentPrint} className="res-print-internal" alt="" />}
        </div>

        <div className="res-interactive-layer">
          {isLoggedIn ? (
            <>
              <button className="hs hs-download" onClick={downloadSession} />
              <button className="hs hs-home-li" onClick={goHome} />
              <button className="hs hs-signout-li" onClick={handleSignOut} />
            </>
          ) : (
            <>
              <button className="hs hs-discord" onClick={() => safePersistAndRedirect('discord')} />
              <button className="hs hs-home-lo" onClick={goHome} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResultPage;