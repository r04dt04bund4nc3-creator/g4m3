// src/pages/ResultPage.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useAnalytics } from '../hooks/useAnalytics';

import loggedOutSkin from '../assets/result-logged-out.webp';
import loggedInSkin from '../assets/result-logged-in.webp';
import './ResultPage.css';

/** --- IndexedDB for Video Recovery --- */
const DB_NAME = 'G4BKU5_DB';
const STORE_NAME = 'blobs';
const RECOVERY_BLOB_KEY = 'res_recovery_blob';
const RECOVERY_PRINT_KEY = 'res_recovery_print';

async function openDB() {
  return new Promise<IDBDatabase>((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function saveBlob(blob: Blob) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(blob, RECOVERY_BLOB_KEY);
  return new Promise(res => tx.oncomplete = res);
}

async function loadBlob() {
  const db = await openDB();
  return new Promise<Blob>(res => {
    const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(RECOVERY_BLOB_KEY);
    req.onsuccess = () => res(req.result);
  });
}

const ResultPage: React.FC = () => {
  const navigate = useNavigate();
  const { state, ritual, auth, signInWithDiscord, signInWithX, signOut, reset } = useApp();
  const { trackEvent } = useAnalytics();

  const [recoveredPrint, setRecoveredPrint] = useState<string | null>(null);
  const [recoveredBlob, setRecoveredBlob] = useState<Blob | null>(null);

  useEffect(() => {
    const run = async () => {
      const savedPrint = sessionStorage.getItem(RECOVERY_PRINT_KEY);
      if (savedPrint) setRecoveredPrint(savedPrint);
      const b = await loadBlob();
      if (b) setRecoveredBlob(b);
    };
    run();
  }, []);

  const effectiveBlob = state.recordingBlob ?? recoveredBlob ?? null;

  const handleLogin = async (provider: 'discord' | 'twitter') => {
    if (ritual.soundPrintDataUrl) sessionStorage.setItem(RECOVERY_PRINT_KEY, ritual.soundPrintDataUrl);
    if (state.recordingBlob) await saveBlob(state.recordingBlob);
    
    if (provider === 'discord') await signInWithDiscord();
    else await signInWithX();
  };

  const downloadSession = useCallback(() => {
    if (!effectiveBlob) return alert('No recording data found.');
    const url = URL.createObjectURL(effectiveBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `4B4KU5-Session-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [effectiveBlob]);

  const goHome = () => { reset(); navigate('/'); };

  const isLoggedIn = !!auth.user?.id;
  const currentPrint = ritual.soundPrintDataUrl || recoveredPrint;

  return (
    <div className="res-page-root">
      <div className="res-machine-container">
        <img src={isLoggedIn ? loggedInSkin : loggedOutSkin} className="res-background-image" alt="" />

        <div className="res-visualizer-screen">
          {currentPrint && <img src={currentPrint} className="res-print-internal" alt="Sound Print" />}
        </div>

        <div className="res-interactive-layer">
          {isLoggedIn ? (
            <>
              <button className="hs hs-home-li" onClick={goHome} />
              <button className="hs hs-download" onClick={downloadSession} />
              <button className="hs hs-signout-li" onClick={signOut} />
            </>
          ) : (
            <>
              <button className="hs hs-discord" onClick={() => handleLogin('discord')} />
              <button className="hs hs-home-lo" onClick={goHome} />
              <button className="hs hs-x" onClick={() => handleLogin('twitter')} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResultPage;