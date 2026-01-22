import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useAnalytics } from '../hooks/useAnalytics';
import { supabase } from '../lib/supabaseClient';

import loggedOutSkin from '../assets/result-logged-out.webp';
import loggedInSkin from '../assets/result-logged-in.webp';
import './ResultPage.css';

/** -------- IndexedDB helpers (for big video blobs across OAuth redirects) -------- */
const DB_NAME = 'G4BKU5_DB';
const STORE_NAME = 'blobs';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadBlob(key: string): Promise<Blob | null> {
  const db = await openDB();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as Blob) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return blob;
}

async function deleteBlob(key: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

const RECOVERY_BLOB_KEY = 'res_recovery_blob';
const RECOVERY_PRINT_KEY = 'res_recovery_print';

/** -------- Filename helpers -------- */

function sanitizeBaseName(name: string): string {
  // remove extension and anything weird for file systems
  return name
    .replace(/\.[^/.]+$/, '') // strip extension
    .replace(/[^a-z0-9]+/gi, '_') // only letters, numbers, underscores
    .replace(/^_+|_+$/g, ''); // trim underscores
}

function buildSessionFileName(file?: File | null): string {
  const prefix = '4B4KU5-';

  if (file?.name) {
    const base = sanitizeBaseName(file.name) || 'session';
    return `${prefix}${base}.webm`;
  }

  // Fallback: custom short timestamp, e.g. 260122154 for 2026‑01‑22 15:04
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);           // 26
  const mm = String(now.getMonth() + 1).padStart(2, '0');   // 01..12
  const dd = String(now.getDate()).padStart(2, '0');        // 01..31
  const hh = String(now.getHours()).padStart(2, '0');       // 00..23
  const min = String(now.getMinutes()).padStart(1, '0');    // 0..59 (no leading 0 if you want 154 vs 1504)

  const stamp = `${yy}${mm}${dd}${hh}${min}`;               // -> "260122154"
  return `${prefix}${stamp}.webm`;
}

/** -------- Component -------- */

const ResultPage: React.FC = () => {
  const navigate = useNavigate();
  const { state, ritual, auth, savePerformance, signOut, reset } = useApp();
  const { trackEvent } = useAnalytics();

  const [recoveredPrint, setRecoveredPrint] = useState<string | null>(null);
  const [recoveredBlob, setRecoveredBlob] = useState<Blob | null>(null);

  // Recover after OAuth redirect (or refresh)
  useEffect(() => {
    const run = async () => {
      const savedPrint = sessionStorage.getItem(RECOVERY_PRINT_KEY);
      if (savedPrint) setRecoveredPrint(savedPrint);

      try {
        const blob = await loadBlob(RECOVERY_BLOB_KEY);
        if (blob) setRecoveredBlob(blob);
      } catch {
        // ignore
      }
    };
    run();
  }, []);

  const getRedirectUrl = () => window.location.origin + '/auth/callback';

  const safePersistAndRedirect = useCallback(
    async (provider: 'google' | 'discord') => {
      trackEvent('social_login_attempt', { provider });

      // persist sound print
      if (ritual.soundPrintDataUrl) {
        sessionStorage.setItem(RECOVERY_PRINT_KEY, ritual.soundPrintDataUrl);
      }

      // persist recorded session (video/webm)
      if (state.recordingBlob) {
        try {
          await saveBlob(RECOVERY_BLOB_KEY, state.recordingBlob);
        } catch (e) {
          console.warn('IndexedDB save failed:', e);
        }
      }

      await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: getRedirectUrl() },
      });
    },
    [ritual.soundPrintDataUrl, state.recordingBlob, trackEvent]
  );

  const downloadSession = useCallback(() => {
    const activeBlob = state.recordingBlob || recoveredBlob;
    if (!auth.user || !activeBlob) {
      alert('No recording data found. Please try the ritual again.');
      return;
    }

    const url = URL.createObjectURL(activeBlob);
    const a = document.createElement('a');
    a.href = url;

    const fileName = buildSessionFileName(state.file || null);
    a.download = fileName;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    trackEvent('download_session', { type: activeBlob.type || 'video/webm', fileName });
  }, [auth.user, recoveredBlob, state.file, state.recordingBlob, trackEvent]);

  const handleSave = useCallback(async () => {
    if (!auth.user) return;

    const trackName = state.file?.name || 'Unknown Track';
    const trackHash = btoa(state.file?.name || '') + '-' + state.file?.size;

    await savePerformance(ritual.finalEQState, trackName, trackHash);
    trackEvent('save_performance', { userId: auth.user.id });
    alert('Saved to library.');
  }, [auth.user, ritual.finalEQState, savePerformance, state.file, trackEvent]);

  const replay = useCallback(() => {
    trackEvent('ritual_replay');
    sessionStorage.removeItem(RECOVERY_PRINT_KEY);
    deleteBlob(RECOVERY_BLOB_KEY).catch(() => {});
    reset();
    navigate('/instrument');
  }, [navigate, reset, trackEvent]);

  const goHome = useCallback(() => {
    sessionStorage.removeItem(RECOVERY_PRINT_KEY);
    deleteBlob(RECOVERY_BLOB_KEY).catch(() => {});
    reset();
    navigate('/');
  }, [navigate, reset]);

  const handleSignOut = useCallback(async () => {
    await signOut();
  }, [signOut]);

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
          {auth.isLoading ? 'SYNCING...' : isLoggedIn ? `LOGGED IN: ${auth.user?.email}` : ''}
        </div>

        {/* Visualizer area (different placement for LO vs LI) */}
        <div className={`res-visualizer-screen ${isLoggedIn ? 'vs-li' : 'vs-lo'}`}>
          {currentPrint && (
            <img src={currentPrint} className="res-print-internal" alt="Sound Print" />
          )}
        </div>

        {/* Invisible hotspots */}
        <div className="res-interactive-layer">
          {isLoggedIn ? (
            <>
              <button className="hs hs-download" onClick={downloadSession} />
              <button className="hs hs-save" onClick={handleSave} />
              <button className="hs hs-replay-li" onClick={replay} />
              <button className="hs hs-home-li" onClick={goHome} />
              <button className="hs hs-signout-li" onClick={handleSignOut} />
            </>
          ) : (
            <>
              <button className="hs hs-google" onClick={() => safePersistAndRedirect('google')} />
              <button className="hs hs-discord" onClick={() => safePersistAndRedirect('discord')} />
              <button className="hs hs-replay-lo" onClick={replay} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResultPage;