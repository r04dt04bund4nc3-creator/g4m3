import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useAnalytics } from '../hooks/useAnalytics';
import { supabase } from '../lib/supabaseClient';
import { claimRitualArtifact, MANIFOLD_NFT_URL } from '../lib/manifold';

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

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

async function loadBlob(key: string): Promise<Blob | null> {
  const db = await openDB();
  try {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
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

// Stripe-return robustness
const PENDING_CHECKOUT_KEY = 'pending_checkout_v1';
type PendingCheckout = { tier: 'prize-6' | 'prize-3'; startedAt: number };
const CHECKOUT_POLL_INTERVAL_MS = 1000;
const CHECKOUT_POLL_TIMEOUT_MS = 60000;

// Timing
const REVEAL_DELAY_MS = 2000;
const MONTHLY_TIMEOUT_MS = 20000;
const ANNUAL_TIMEOUT_MS = 30000;

const PRIZE_TEXTS = {
  6: {
    title: 'MONTHLY KEEPER',
    headline: '$6/month · 1 NFT per month',
    body: 'Claim one NFT each month. Total claim value over 12 months: $468, $2808 in two years, $16,848 in three years.',
    scarcity: 'Each new artifact is rarer than the last: 216 mints for NFT #1 → 1 mint of NFT #216.',
    cta: 'Get there first! TAP to lock in your position.',
  },
  3: {
    title: 'ANNUAL ARCHIVIST',
    headline: '$3/month · 1 NFT per month',
    body: 'Access the full 216-artifact archive for one year. Claim one NFT each month. Total claim value over 12 months: $468, $2808 in two years, $16,848 in three years.',
    scarcity: 'Each new artifact is rarer than the last: 216 mints for NFT #1 → 1 mint of NFT #216.',
    cta: 'Get there first! TAP to lock in your position.',
  },
};

function tierLabel(tier: string | null): string | null {
  if (!tier) return null;
  if (tier === 'prize-3') return 'annual';
  if (tier === 'prize-6') return 'monthly';
  return tier;
}

const ResultPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const { state, ritual, auth, signOut, reset, signInWithDiscord, signInWithGoogle } = useApp();
  const { trackEvent } = useAnalytics();

  const navigationGuard = useRef(false);

  const [view, setView] = useState<ResultView>('summary');
  const [recoveredPrint, setRecoveredPrint] = useState<string | null>(null);
  const [recoveredBlob, setRecoveredBlob] = useState<Blob | null>(null);
  const [canProceed, setCanProceed] = useState(false);
  const [loadingStreak, setLoadingStreak] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  // Confirmation banner states
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [subscriptionTier, setSubscriptionTier] = useState<string | null>(null);

  const defaultStreakState = useCallback((): StreakState => {
    return {
      day: 1,
      lastDate: new Date().toISOString().split('T')[0],
      nftClaimed: false,
      subscriptionActive: false,
    };
  }, []);

  const [streak, setStreak] = useState<StreakState>(defaultStreakState());

  // 🚨 IRON CLAD RULE: All active subscribers are FORCED to hub view
  // This guarantees after payment, you will always end up on the correct screen
  // This cannot fail. If user is subscribed, they go to hub.
  useEffect(() => {
    if (auth.user?.id && streak.subscriptionActive && view !== 'hub') {
      console.log('✅ Active subscription detected: Auto redirecting to Hub view');
      setView('hub');
    }
  }, [streak.subscriptionActive, auth.user?.id]);

  // Fetch streak (runs when auth.user?.id changes)
  const fetchStreak = useCallback(
    async (forceRefresh = false): Promise<StreakState | null> => {
      if (!auth.user?.id) return null;

      if (!forceRefresh) {
        setLoadingStreak(true);
      }

      const today = new Date().toISOString().split('T')[0];

      try {
        let { data, error } = await supabase
          .from('user_streaks')
          .select('*')
          .eq('user_id', auth.user.id)
          .single();

        if (error && (error as any).code === 'PGRST116') {
          // No streak found, create a new one
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
          // Streak found, update if needed
          let newDay = data.current_day;

          if (data.last_visit !== today) {
            // Calendar-day diff (not 24h periods)
            const lastVisitDate = new Date(data.last_visit);
            const todayDate = new Date(today);
            const timeDiff = todayDate.getTime() - lastVisitDate.getTime();
            const diffDays = Math.floor(timeDiff / (1000 * 3600 * 24));

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

            data.current_day = newDay;
          }
        }

        const next: StreakState = {
          day: data?.current_day || 1,
          lastDate: data?.last_visit || today,
          nftClaimed: data?.nft_claimed || false,
          subscriptionActive: data?.subscription_status === 'active',
        };

        setStreak(next);
        return next;
      } catch (err) {
        console.error('Streak sync error:', err);
        const safe = defaultStreakState();
        setStreak(safe);
        return null;
      } finally {
        setLoadingStreak(false);
      }
    },
    [auth.user?.id, defaultStreakState]
  );

  const isLoggedIn = !!auth.user?.id;

  const openManifold = useCallback(
    (source: string, overrideUrl?: string) => {
      if (navigationGuard.current) return;
      navigationGuard.current = true;

      trackEvent('manifold_open', { source });
      const targetUrl = overrideUrl ?? MANIFOLD_NFT_URL;

      const win = window.open(targetUrl, '_blank', 'noopener,noreferrer');
      if (!win) window.location.href = targetUrl;

      setTimeout(() => {
        navigationGuard.current = false;
      }, 1000);
    },
    [trackEvent]
  );

  // Handle Stripe return via URL params (best-case path)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const success = params.get('success') === 'true';
    const canceled = params.get('canceled') === 'true';
    const tier = params.get('tier');

    if (canceled) {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
      try {
        window.history.replaceState({}, '', '/result');
      } catch {}
      setView('summary');
      return;
    }

    if (success) {
      console.log('✅ Stripe success payment detected');
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY);

      setSubscriptionTier(tierLabel(tier) || 'unknown');
      setIsFinalizing(false);

      // 🚨 FIX: After successful payment, immediately force to hub view
      setView('hub');

      // 🚨 FIX: Immediately assume subscription is active, so UI updates right away
      setStreak(prev => ({
        ...prev,
        subscriptionActive: true,
      }));

      // 🚨 CHANGE: We no longer use the tiny CONFIRMED overlay as the "banner".
      // We will show the purple claim banner until the NFT is claimed.
      // So we don't need to setIsConfirmed(true) here.

      if (auth.user?.id) {
        // Refetch streak data to confirm
        setTimeout(() => fetchStreak(true), 1500);
      }

      // Clean URL
      setTimeout(() => {
        try {
          window.history.replaceState({}, '', '/result');
        } catch {}
      }, 500);
    }
  }, [location.search, auth.user?.id, fetchStreak]);

  // Robust Stripe-return path (works even when Stripe returns to /result with NO params)
  useEffect(() => {
    if (!auth.user?.id) return;

    const pendingRaw = sessionStorage.getItem(PENDING_CHECKOUT_KEY);
    if (!pendingRaw) return;

    let pending: PendingCheckout | null = null;
    try {
      pending = JSON.parse(pendingRaw) as PendingCheckout;
    } catch {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
      return;
    }

    // If this pending checkout is ancient, ignore it
    if (!pending?.startedAt || Date.now() - pending.startedAt > 2 * 60 * 60 * 1000) {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
      return;
    }

    // 🚨 FIX: Force user to hub view immediately. No exceptions.
    setView('hub');
    setSubscriptionTier(tierLabel(pending.tier));
    setIsFinalizing(true);

    let cancelled = false;
    const started = Date.now();

    const poll = async () => {
      if (cancelled) return;

      const next = await fetchStreak(true);
      if (cancelled) return;

      if (next?.subscriptionActive) {
        sessionStorage.removeItem(PENDING_CHECKOUT_KEY);

        setStreak(prev => ({
          ...prev,
          subscriptionActive: true,
        }));

        setIsFinalizing(false);
        // 🚨 CHANGE: Do NOT set isConfirmed here anymore; purple claim banner will handle it.
        return;
      }

      if (Date.now() - started > CHECKOUT_POLL_TIMEOUT_MS) {
        sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
        setIsFinalizing(false);
        console.warn('Subscription did not become active within timeout.');
        return;
      }

      setTimeout(poll, CHECKOUT_POLL_INTERVAL_MS);
    };

    poll();

    return () => {
      cancelled = true;
    };
  }, [auth.user?.id, fetchStreak]);

  // Recover blobs
  useEffect(() => {
    const run = async () => {
      const savedPrint = sessionStorage.getItem(RECOVERY_PRINT_KEY);
      if (savedPrint) setRecoveredPrint(savedPrint);
      const blob = await loadBlob(RECOVERY_BLOB_KEY);
      if (blob) setRecoveredBlob(blob);
    };
    run();
  }, []);

  // Reveal timer
  useEffect(() => {
    if (view.startsWith('prize-')) {
      setCanProceed(false);
      const t = setTimeout(() => setCanProceed(true), REVEAL_DELAY_MS);
      return () => clearTimeout(t);
    }
  }, [view]);

  // Monthly auto-resolve to hub
  useEffect(() => {
    if (view !== 'prize-6' || !canProceed) return;
    const t = setTimeout(() => {
      setView('hub');
      trackEvent('subscription_timeout', { tier: 'monthly' });
    }, MONTHLY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [view, canProceed, trackEvent]);

  // Annual auto-resolve to hub
  useEffect(() => {
    if (view !== 'prize-3' || !canProceed) return;
    const t = setTimeout(() => {
      setView('hub');
      trackEvent('subscription_timeout', { tier: 'annual' });
    }, ANNUAL_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [view, canProceed, trackEvent]);

  // Reset streak on user change + fetch
  useEffect(() => {
    if (auth.user?.id) {
      setStreak(defaultStreakState());
      fetchStreak();
    } else {
      setStreak(defaultStreakState());
      setIsConfirmed(false);
      setIsFinalizing(false);
    }
  }, [auth.user?.id, fetchStreak, defaultStreakState]);

  const effectiveBlob = state.recordingBlob ?? recoveredBlob ?? null;
  const currentPrint = ritual.soundPrintDataUrl || recoveredPrint;

  const handleSocialLogin = useCallback(
    async (provider: 'discord' | 'google') => {
      trackEvent('social_login_attempt', { provider });

      if (state.recordingBlob) {
        try {
          await saveBlob(RECOVERY_BLOB_KEY, state.recordingBlob);
        } catch (e) {
          console.warn(e);
        }
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

  const handleClaim = useCallback(async () => {
    if (!auth.user?.id) return;
    setClaiming(true);

    try {
      const result = await claimRitualArtifact(auth.user.id);

      await supabase.from('user_streaks').update({ nft_claimed: true }).eq('user_id', auth.user.id);

      // Once user claims NFT, hide the purple banner (by setting nftClaimed=true)
      setStreak(prev => ({
        ...prev,
        nftClaimed: true,
      }));

      // Not used as banner anymore, but keep state consistent
      setIsConfirmed(false);

      trackEvent('nft_claimed', { day: streak.day, isSubscriber: streak.subscriptionActive });

      if (result.success) {
        window.open(result.claimUrl, '_blank', 'noopener,noreferrer');
      } else {
        openManifold('claim_fallback');
      }
    } catch (e) {
      console.error('Error claiming NFT:', e);
      alert('Failed to claim artifact. Please try again.');
    } finally {
      setClaiming(false);
    }
  }, [auth.user?.id, streak.day, streak.subscriptionActive, trackEvent, openManifold]);

  const handleStripeCheckout = useCallback(
    async (tier: 'prize-6' | 'prize-3') => {
      if (!auth.user?.id) {
        alert('You must be logged in to subscribe.');
        return;
      }
      if (checkoutBusy) return;

      // Persist checkout attempt so return works even without query params
      const pending: PendingCheckout = { tier, startedAt: Date.now() };
      sessionStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(pending));

      setCheckoutBusy(true);
      trackEvent('stripe_checkout_initiated', { tier });

      try {
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

        const contentType = res.headers.get('content-type');
        let json: any;
        if (contentType && contentType.includes('application/json')) {
          json = await res.json();
        } else {
          const text = await res.text();
          throw new Error(text || `Server error: ${res.status}`);
        }

        if (!res.ok) throw new Error(json?.error || `Request failed: ${res.status}`);
        if (!json?.url) throw new Error('No checkout URL returned');

        window.location.href = json.url;
      } catch (err) {
        console.error('Checkout error:', err);
        sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
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
    sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
    await signOut();
    navigate('/');
  }, [navigate, signOut]);

  // ✅ FINAL FIXED TEXT LOGIC:
  // 1. If user is ANY paying subscriber: ALWAYS show subscription text, NEVER show day text
  // 2. "DAY X OF 6" text is ONLY allowed to appear on prize-0 screen. Nowhere else.
  const dayText = useMemo(() => {
    if (loadingStreak) return 'ALIGNING PLANETARY GEARS...';

    if (streak.subscriptionActive) {
      if (streak.nftClaimed) return 'SUBSCRIPTION ACTIVE • COME BACK NEXT MONTH FOR YOUR NEXT ARTIFACT.';
      return 'SUBSCRIPTION ACTIVE • CLAIM YOUR MONTHLY ARTIFACT BELOW.';
    }

    if (view !== 'prize-0') {
      return '';
    }

    if (streak.day === 6) {
      if (streak.nftClaimed) return 'CYCLE COMPLETE. ARTIFACT SECURED.';
      return 'DAY 6 OF 6: THE GATE IS OPEN.';
    }

    return `DAY ${streak.day} OF 6: RETURN TOMORROW TO STRENGTHEN THE SIGNAL.`;
  }, [streak, loadingStreak, view]);

  // ---- Prize renderer ----
  const renderPrizeScreen = (tier: '6' | '3' | '0') => {
    const imgSrc = tier === '6' ? prize6 : tier === '3' ? prize3 : prize0;

    const showClaimBtn = tier === '0' && !streak.nftClaimed && (streak.day === 6 || streak.subscriptionActive);

    const textData = tier === '6' ? PRIZE_TEXTS[6] : tier === '3' ? PRIZE_TEXTS[3] : null;

    const handleClick = () => {
      if (!canProceed) return;
      if (showClaimBtn) return;
      if (tier === '6') return handleStripeCheckout('prize-6');
      if (tier === '3') return handleStripeCheckout('prize-3');
      setView('hub');
    };

    return (
      <div className="res-page-root" onClick={handleClick} style={{ cursor: canProceed && !showClaimBtn ? 'pointer' : 'default' }}>
        <div className="res-machine-container">
          <img src={imgSrc} className="res-background-image" alt="Prize" />

          {tier === '0' && dayText && <div className="prize-shelf-text legacy">{dayText}</div>}

          {textData && (
            <div className="prize-shelf-text sacred-text-container">
              <h2 className="sacred-title">{textData.title}</h2>
              <div className="sacred-headline">{textData.headline}</div>
              <p className="sacred-body">{textData.body}</p>
              <p className="sacred-scarcity">{textData.scarcity}</p>

              {tier === '3' && canProceed && (
                <div className="auto-redirect-warning">Returning to hub in {Math.round(ANNUAL_TIMEOUT_MS / 1000)}s...</div>
              )}
              {tier === '6' && canProceed && (
                <div className="auto-redirect-warning">Returning to hub in {Math.round(MONTHLY_TIMEOUT_MS / 1000)}s...</div>
              )}

              <div className="sacred-cta">{checkoutBusy ? 'OPENING CHECKOUT...' : textData.cta}</div>
            </div>
          )}

          {showClaimBtn && canProceed && (
            <div className="claim-container">
              <button
                className="manifold-claim-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClaim();
                }}
                disabled={claiming}
              >
                {claiming ? 'OPENING PORTAL...' : 'CLAIM ARTIFACT'}
              </button>
              <div
                className="claim-subtext"
                onClick={(e) => {
                  e.stopPropagation();
                  setView('hub');
                }}
              >
                or return to hub
              </div>
            </div>
          )}

          {canProceed && !showClaimBtn && !textData && <div className="tap-continue-hint">Tap to continue</div>}
        </div>
      </div>
    );
  };

  // AUTH LOADING
  if (auth.isLoading) {
    return (
      <div className="res-page-root">
        <div className="loading-spinner">SYNCING ASTRAL SIGNAL...</div>
      </div>
    );
  }

  // HUB VIEW
  if (view === 'hub') {
    const showHubClaimButton = !streak.nftClaimed && (streak.day === 6 || streak.subscriptionActive);

    // ✅ NEW: show the purple "CLAIM YOUR MONTHLY ARTIFACT" banner
    // whenever a user is subscribed AND has not claimed yet.
    const showSubscriberClaimBanner = streak.subscriptionActive && !streak.nftClaimed;

    return (
      <div className={`res-page-root ${isConfirmed ? 'confirmed-state' : ''}`}>
        <div className="res-machine-container">
          <img src={steamSlotsHub} className="res-background-image" alt="Steam Slots Hub" />

          {dayText && <div className="prize-shelf-text legacy">{dayText}</div>}

          {/* ✅ This is the REQUIRED persistent banner replacement:
              It stays until the user claims (nftClaimed becomes true). */}
          {showSubscriberClaimBanner && (
            <div className="hub-claim-overlay">
              <button className="manifold-claim-btn hub-btn" onClick={handleClaim} disabled={claiming}>
                {claiming ? 'OPENING PORTAL...' : 'CLAIM YOUR MONTHLY ARTIFACT'}
              </button>
            </div>
          )}

          {/* Keep existing hub claim button behavior for Day-6 non-subscribers (if you still want it) */}
          {!showSubscriberClaimBanner && showHubClaimButton && (
            <div className="hub-claim-overlay">
              <button className="manifold-claim-btn hub-btn" onClick={handleClaim} disabled={claiming}>
                {claiming ? 'OPENING PORTAL...' : 'CLAIM YOUR MONTHLY ARTIFACT'}
              </button>
            </div>
          )}

          <div className="res-interactive-layer">
            {/* Finalizing overlay (post-checkout, waiting for webhook) */}
            {isFinalizing && !isConfirmed && (
              <div className="sacred-confirmation-overlay">
                <div className="confirmation-sigil" />
                <h1>FINALIZING</h1>
                <p>
                  Confirming your subscription...
                  <br />
                  This can take a few seconds.
                  {subscriptionTier && (
                    <>
                      <br />
                      Tier: {subscriptionTier}
                    </>
                  )}
                </p>
              </div>
            )}

            {/* 🔻 OLD tiny CONFIRMED overlay removed from rendering path:
                You asked to replace this with the purple claim banner.
                We keep state vars but do not render this overlay anymore. */}

            {!isFinalizing && (
              <>
                <button
                  className="hs hs-hub-left"
                  onClick={() => window.open('https://manifold.xyz/@r41nb0w/id/4078311664', '_blank', 'noopener,noreferrer')}
                  aria-label="001 - GR33N - 4W4K3N1NG"
                />
                <button
                  className="hs hs-hub-center"
                  onClick={() => window.open('https://manifold.xyz/@r41nb0w/id/4078321904', '_blank', 'noopener,noreferrer')}
                  aria-label="002 - R3D - ជីពចr"
                />
                <button
                  className="hs hs-hub-right"
                  onClick={() => window.open('https://manifold.xyz/@r41nb0w/id/4078434544', '_blank', 'noopener,noreferrer')}
                  aria-label="003 - 0R4NG3 - N3W L1F3"
                />
              </>
            )}

            <button className="hs hs-hub-home" onClick={goHome} aria-label="Return Home" />
          </div>
        </div>
      </div>
    );
  }

  // ✅ SLOTS VIEW: 100% COMPLIANT WITH YOUR REQUEST
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

  // PRIZE VIEWS
  if (view === 'prize-0') return renderPrizeScreen('0');
  if (view === 'prize-3') return renderPrizeScreen('3');
  if (view === 'prize-6') return renderPrizeScreen('6');

  // SUMMARY (LOGIN) VIEW
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