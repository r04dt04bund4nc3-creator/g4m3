// src/pages/ResultPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useAnalytics } from '../hooks/useAnalytics';
import { supabase } from '../lib/supabaseClient';
import { claimRitualArtifact } from '../lib/manifold';

// Assets
import loggedOutSkin from '../assets/result-logged-out.webp';
import loggedInSkin from '../assets/result-logged-in.webp';
import ritualSlots from '../assets/ritual-slots.webp';
import steamSlotsHub from '../assets/steam-slots-hub.webp';
import prize0 from '../assets/prize-0.webp';
import prize3 from '../assets/prize-3.webp';
import prize6 from '../assets/prize-6.webp';

import './ResultPage.css';

/** -------- IndexedDB helpers -------- */
const DB_NAME = 'G4BU5_DB';
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
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as Blob) ?? null);
    req.onerror = () => resolve(null);
  });
}

const RECOVERY_BLOB_KEY = 'res_recovery_blob';
const RECOVERY_PRINT_KEY = 'res_recovery_print';

type ResultView = 'summary' | 'slots' | 'prize-0' | 'prize-3' | 'prize-6' | 'hub';

type StreakState = {
  day: number;
  lastDate: string;
  nftClaimed: boolean;
  subscriptionActive: boolean;
};

// Timing constants
const REVEAL_DELAY_MS = 2000; // 2 seconds before tap is allowed
const ANNUAL_READING_TIME_MS = 30000; // 30 seconds to read annual offer

// Sacred copy - shorter, clearer, value-first
const PRIZE_TEXTS = {
  6: {
    title: 'MONTHLY KEEPER',
    headline: '$6/month · 1 NFT per month',
    body: 'Unlock the 216-artifact archive. Each month, claim one NFT at no extra cost. Artifact values rise monthly: #1 is $6, #216 is $1,296. Twelve months = $468 in claim value.',
    scarcity: 'Supply tightens: 216 mints → 215 → ... → 1.',
    cta: 'TAP TO SUBSCRIBE',
  },
  3: {
    title: 'ANNUAL ARCHIVIST',
    headline: '$36/year · The Big Deal',
    body: 'Access the full 216-artifact archive for one year. Claim one NFT each month. Total claim value over 12 months: $468, $2808 in two years, $16,848 in three years.',
    scarcity: 'Each artifact is rarer than the last: 216 mints for NFT #1 → 1 mint of NFT #216. Get there first!',
    cta: 'TAP TO BUILD',
  },
};

const ResultPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, ritual, auth, signOut, reset, signInWithDiscord, signInWithGoogle } = useApp();
  const { trackEvent } = useAnalytics();

  const [view, setView] = useState<ResultView>('summary');
  const [recoveredPrint, setRecoveredPrint] = useState<string | null>(null);
  const [recoveredBlob, setRecoveredBlob] = useState<Blob | null>(null);
  const [canProceed, setCanProceed] = useState(false);
  const [loadingStreak, setLoadingStreak] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [subscriptionTier, setSubscriptionTier] = useState<string | null>(null);

  const [streak, setStreak] = useState<StreakState>({
    day: 1,
    lastDate: new Date().toISOString().split('T')[0],
    nftClaimed: false,
    subscriptionActive: false,
  });

  const isLoggedIn = !!auth.user?.id;

  // Handle Stripe return
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const success = params.get('success') === 'true';
    const canceled = params.get('canceled') === 'true';
    const tier = params.get('tier');

    if (success) {
      setSubscriptionTier(tier || 'unknown');
      setIsConfirmed(true);
      setView('hub');
      setTimeout(() => {
        try { window.history.replaceState({}, '', '/result'); } catch {}
      }, 1500);
      setTimeout(() => setIsConfirmed(false), 4000);
    }

    if (canceled) {
      try { window.history.replaceState({}, '', '/result'); } catch {}
      setView('summary');
    }
  }, [location.search]);

  // Recover blobs/prints
  useEffect(() => {
    const run = async () => {
      const savedPrint = sessionStorage.getItem(RECOVERY_PRINT_KEY);
      if (savedPrint) setRecoveredPrint(savedPrint);
      const blob = await loadBlob(RECOVERY_BLOB_KEY);
      if (blob) setRecoveredBlob(blob);
    };
    run();
  }, []);

  // Prize reveal timer (2s delay before clickable)
  useEffect(() => {
    if (view.startsWith('prize-')) {
      setCanProceed(false);
      const timer = setTimeout(() => setCanProceed(true), REVEAL_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [view]);

  // Annual auto-resolve: 30s AFTER reveal is complete
  useEffect(() => {
    if (view !== 'prize-3' || !canProceed) return;
    
    const timer = setTimeout(() => {
      setView('hub');
      trackEvent('subscription_timeout', { tier: 'annual' });
    }, ANNUAL_READING_TIME_MS);
    
    return () => clearTimeout(timer);
  }, [view, canProceed, trackEvent]);

  // Fetch streak
  const fetchStreak = useCallback(async () => {
    if (!auth.user?.id) return;
    setLoadingStreak(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      let { data, error } = await supabase
        .from('user_streaks')
        .select('*')
        .eq('user_id', auth.user.id)
        .single();

      if (error && (error as any).code === 'PGRST116') {
        const { data: newData, error: insertError } = await supabase
          .from('user_streaks')
          .insert({
            user_id: auth.user.id,
            current_day: 1,
            last_visit: today,
            total_visits: 1,
            subscription_tier: null,
            subscription_status: null,
            nft_claimed: false,
          })
          .select()
          .single();
        if (insertError) throw insertError;
        data = newData;
      } else if (data) {
        const lastVisit = new Date(data.last_visit);
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - lastVisit.getTime());
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        let newDay = data.current_day;

        if (data.last_visit !== today) {
          if (diffDays === 1) newDay = Math.min(data.current_day + 1, 6);
          else if (diffDays > 1) newDay = 1;
          await supabase
            .from('user_streaks')
            .update({
              current_day: newDay,
              last_visit: today,
              total_visits: data.total_visits + 1,
            })
            .eq('user_id', auth.user.id);
        }
        data.current_day = newDay;
      }

      setStreak({
        day: data?.current_day || 1,
        lastDate: data?.last_visit || today,
        nftClaimed: data?.nft_claimed || false,
        subscriptionActive: data?.subscription_status === 'active',
      });
    } catch (err) {
      console.error('Streak sync error:', err);
    } finally {
      setLoadingStreak(false);
    }
  }, [auth.user?.id]);

  useEffect(() => {
    if (auth.user?.id) fetchStreak();
  }, [auth.user?.id, fetchStreak]);

  const effectiveBlob = state.recordingBlob ?? recoveredBlob ?? null;
  const currentPrint = ritual.soundPrintDataUrl || recoveredPrint;

  const handleSocialLogin = useCallback(
    async (provider: 'discord' | 'google') => {
      trackEvent('social_login_attempt', { provider });
      if (state.recordingBlob) {
        try { await saveBlob(RECOVERY_BLOB_KEY, state.recordingBlob); } catch (e) { console.warn(e); }
      }
      if (ritual.soundPrintDataUrl) {
        sessionStorage.setItem(RECOVERY_PRINT_KEY, ritual.soundPrintDataUrl);
      }
      if (provider === 'discord') await signInWithDiscord();
      else await signInWithGoogle();
    },
    [state.recordingBlob, ritual.soundPrintDataUrl, trackEvent, signInWithDiscord, signInWithGoogle]
  );

  const downloadAndSpin = useCallback(() => {
    if (!effectiveBlob) {
      alert('No recording found. Please try the ritual again.');
      return;
    }
    const url = URL.createObjectURL(effectiveBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `4B4KU5-session-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    trackEvent('download_and_spin');
    setView('slots');
  }, [effectiveBlob, trackEvent]);

  const handleClaim = async () => {
    if (!auth.user?.id) return;
    setClaiming(true);
    try {
      await claimRitualArtifact(auth.user.id);
      await supabase.from('user_streaks').update({ nft_claimed: true }).eq('user_id', auth.user.id);
      setStreak(prev => ({ ...prev, nftClaimed: true }));
      trackEvent('nft_claimed', { day: 6 });
    } catch (e) {
      console.error(e);
    } finally {
      setClaiming(false);
    }
  };

  // Stripe checkout via Vercel function
  const handleStripeCheckout = useCallback(
    async (tier: 'prize-6' | 'prize-3') => {
      if (!auth.user?.id) {
        alert('You must be logged in to subscribe.');
        return;
      }
      if (checkoutBusy) return;

      setCheckoutBusy(true);
      trackEvent('stripe_checkout_initiated', { tier });

      try {
        // Use window.location.origin so it works on preview deploys too
        const endpoint = `${window.location.origin}/api/create-checkout`;
        
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tier,
            user_id: auth.user.id,
            return_url: `${window.location.origin}/result`,
          }),
        });

        const json = await res.json();
        
        if (!res.ok) {
          throw new Error(json?.error || `Server error: ${res.status}`);
        }

        if (!json?.url) throw new Error('No checkout URL returned');

        window.location.href = json.url;
      } catch (err) {
        console.error('Checkout error:', err);
        alert((err as Error).message || 'Failed to open checkout. Please try again.');
      } finally {
        setCheckoutBusy(false);
      }
    },
    [auth.user?.id, checkoutBusy, trackEvent]
  );

  const goHome = useCallback(() => {
    reset();
    navigate('/');
  }, [navigate, reset]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    navigate('/');
  }, [navigate, signOut]);

  const dayText = useMemo(() => {
    if (loadingStreak) return 'ALIGNING PLANETARY GEARS...';
    if (streak.day === 6) {
      if (streak.nftClaimed) return 'CYCLE COMPLETE. ARTIFACT SECURED.';
      return 'DAY 6 OF 6: THE GATE IS OPEN.';
    }
    return `DAY ${streak.day} OF 6: RETURN TOMORROW TO STRENGTHEN THE SIGNAL.`;
  }, [streak, loadingStreak]);

  // HUB
  if (view === 'hub') {
    return (
      <div className={`res-page-root ${isConfirmed ? 'confirmed-state' : ''}`}>
        <div className="res-machine-container">
          <img src={steamSlotsHub} className="res-background-image" alt="Steam Slots Hub" />
          <div className="res-interactive-layer">
            {isConfirmed && (
              <div className="sacred-confirmation-overlay">
                <div className="confirmation-sigil" />
                <h1>CONFIRMED</h1>
                <p>
                  The offering is received.
                  <br />
                  Monthly claims are now open.
                  {subscriptionTier && <><br />Tier: {subscriptionTier}</>}
                </p>
                <button className="confirmation-cta" onClick={() => setIsConfirmed(false)}>
                  Continue
                </button>
              </div>
            )}
            <button className="hs hs-hub-home" onClick={goHome} aria-label="Return Home" />
          </div>
        </div>
      </div>
    );
  }

  // SLOTS
  if (view === 'slots') {
    return (
      <div className="res-page-root">
        <div className="res-machine-container">
          <img src={ritualSlots} className="res-background-image" alt="Slot Ritual" />
          <div className="res-interactive-layer">
            <button className="hs hs-slot-left" onClick={() => setView('prize-0')} aria-label="$0 Reward" />
            <button className="hs hs-slot-center" onClick={() => setView('prize-6')} aria-label="$6 Subscription" />
            <button className="hs hs-slot-right" onClick={() => setView('prize-3')} aria-label="$3 Subscription" />
          </div>
        </div>
      </div>
    );
  }

  const renderPrizeScreen = (tier: '6' | '3' | '0') => {
    const imgSrc = tier === '6' ? prize6 : tier === '3' ? prize3 : prize0;
    const showClaimBtn = tier === '0' && streak.day === 6 && !streak.nftClaimed;
    const textData = tier === '6' ? PRIZE_TEXTS[6] : tier === '3' ? PRIZE_TEXTS[3] : null;

    const handleClick = () => {
      if (!canProceed) return;
      if (showClaimBtn) return;
      if (tier === '6') return handleStripeCheckout('prize-6');
      if (tier === '3') return handleStripeCheckout('prize-3');
      setView('hub');
    };

    return (
      <div 
        className="res-page-root" 
        onClick={handleClick} 
        style={{ cursor: canProceed && !showClaimBtn ? 'pointer' : 'default' }}
      >
        <div className="res-machine-container">
          <img src={imgSrc} className="res-background-image" alt="Prize" />

          {tier === '0' && (
            <div className="prize-shelf-text legacy">{dayText}</div>
          )}

          {textData && (
            <div className="prize-shelf-text sacred-text-container">
              <h2 className="sacred-title">{textData.title}</h2>
              <div className="sacred-headline">{textData.headline}</div>
              <p className="sacred-body">{textData.body}</p>
              <p className="sacred-scarcity">{textData.scarcity}</p>
              {tier === '3' && canProceed && (
                <div className="auto-redirect-warning">
                  Auto-returning in {Math.round(ANNUAL_READING_TIME_MS / 1000)}s...
                </div>
              )}
              <div className="sacred-cta">
                {checkoutBusy ? 'OPENING CHECKOUT...' : textData.cta}
              </div>
            </div>
          )}

          {showClaimBtn && canProceed && (
            <div className="claim-container">
              <button
                className="manifold-claim-btn"
                onClick={(e) => { e.stopPropagation(); handleClaim(); }}
                disabled={claiming}
              >
                {claiming ? 'MINTING...' : 'CLAIM ARTIFACT'}
              </button>
              <div className="claim-subtext" onClick={(e) => { e.stopPropagation(); setView('hub'); }}>
                or return to hub
              </div>
            </div>
          )}

          {canProceed && !showClaimBtn && !textData && (
            <div className="tap-continue-hint">Tap to continue</div>
          )}
        </div>
      </div>
    );
  };

  if (view === 'prize-0') return renderPrizeScreen('0');
  if (view === 'prize-3') return renderPrizeScreen('3');
  if (view === 'prize-6') return renderPrizeScreen('6');

  // SUMMARY
  return (
    <div className="res-page-root">
      <div className="res-machine-container">
        <img src={isLoggedIn ? loggedInSkin : loggedOutSkin} className="res-background-image" alt="" draggable={false} />
        <div className="res-visualizer-screen">
          {currentPrint && <img src={currentPrint} className="res-print-internal" alt="Sound Print" />}
        </div>
        <div className="res-interactive-layer">
          {isLoggedIn ? (
            <>
              <button className="hs hs-home-li" onClick={goHome} aria-label="Return Home" />
              <button className="hs hs-download" onClick={downloadAndSpin} aria-label="Download & Spin" />
              <button className="hs hs-signout-li" onClick={handleSignOut} aria-label="Sign Out" />
            </>
          ) : (
            <>
              <button className="hs hs-discord" onClick={() => handleSocialLogin('discord')} aria-label="Login with Discord" />
              <button className="hs hs-home-lo" onClick={goHome} aria-label="Return Home" />
              <button className="hs hs-google" onClick={() => handleSocialLogin('google')} aria-label="Login with Google" />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResultPage;