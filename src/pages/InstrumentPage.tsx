import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { useNavigate } from 'react-router-dom';
import { ethers } from 'ethers'; // 👈 Added for blockchain check

import { useApp } from '../state/AppContext';
import { useAnalytics } from '../hooks/useAnalytics';
import audioEngine from '../audio/AudioEngine';
import { FlowFieldInstrument } from '../components/FlowFieldInstrument';

const MAX_BANDS = 36;
const MAX_ROWS = 36;

// 🟢 NFT CONFIGURATION
const CONTRACT_ADDRESS = "0xd186eF10DB75AbcC9Ba0EdAa1F92c97530Eb741F";
const BASE_RPC = "https://mainnet.base.org";
// This is the slug for your Manifold collection. 
// You can find it in your Manifold Studio URL.
const MANIFOLD_SLUG = "r41nb0w"; 

const InstrumentPage: React.FC = () => {
  const navigate = useNavigate();
  const { state, saveRecording, setAudioBuffer, captureSoundPrint } = useApp();
  const { trackEvent } = useAnalytics();

  const [isPlaying, setIsPlaying] = useState(false);
  const [isIntroPlaying, setIsIntroPlaying] = useState(false);
  const [activeRows, setActiveRows] = useState<number[]>(new Array(MAX_BANDS).fill(-1));
  const [isDecoding, setIsDecoding] = useState(false);

  // -- NFT Reward State --
  const [allowance, setAllowance] = useState<number>(0);
  const [isCheckingAllowance, setIsCheckingAllowance] = useState(false);

  // Pointer state 0..1
  const [pointer01, setPointer01] = useState<{ x: number; y: number; down: boolean }>({
    x: 0.5,
    y: 0.5,
    down: false,
  });

  const stageRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const completedRef = useRef(false);

  // -- Lifecycle: Redirect if no audio --
  useEffect(() => {
    if (!state.file && !state.audioBuffer) {
      navigate('/');
    }
  }, [state.file, state.audioBuffer, navigate]);

  // -- Lifecycle: Check NFT Allowance --
  useEffect(() => {
    const checkNFTAllowance = async () => {
      // Assuming state.user.wallet_address is where your user's wallet is stored
      // If your app stores it elsewhere, update 'state.user?.wallet_address'
      const userWallet = (state as any).user?.wallet_address;
      
      if (userWallet && !isCheckingAllowance) {
        setIsCheckingAllowance(true);
        try {
          const provider = new ethers.JsonRpcProvider(BASE_RPC);
          const contract = new ethers.Contract(
            CONTRACT_ADDRESS,
            ["function maxAllowlistMint(address) view returns (uint256)"],
            provider
          );
          const count = await contract.maxAllowlistMint(userWallet);
          setAllowance(Number(count));
        } catch (err) {
          console.error('NFT Allowance check failed:', err);
        } finally {
          setIsCheckingAllowance(false);
        }
      }
    };
    checkNFTAllowance();
  }, [state, isCheckingAllowance]);

  // -- Lifecycle: Decode Audio --
  useEffect(() => {
    const decodeAudio = async () => {
      if (state.file && !state.audioBuffer && !isDecoding) {
        setIsDecoding(true);
        try {
          const arrayBuffer = await state.file.arrayBuffer();
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const tempCtx = new AudioContextClass();
          const decoded = await tempCtx.decodeAudioData(arrayBuffer);
          setAudioBuffer(decoded);
        } catch (err) {
          console.error('Decoding failed:', err);
          trackEvent('decode_error');
        } finally {
          setIsDecoding(false);
        }
      }
    };
    decodeAudio();
  }, [state.file, state.audioBuffer, isDecoding, setAudioBuffer, trackEvent]);

  // -- Audio Interaction Logic --
  const applyInteraction01 = useCallback(
    (x01: number, y01: number) => {
      if (!isPlaying) return;

      const bandIndex = Math.min(MAX_BANDS - 1, Math.max(0, Math.floor(x01 * MAX_BANDS)));
      const rowIndex = Math.min(MAX_ROWS - 1, Math.max(0, Math.floor(y01 * MAX_ROWS)));

      setActiveRows(prev => {
        if (prev[bandIndex] === rowIndex) return prev;
        const next = [...prev];
        next[bandIndex] = rowIndex;
        return next;
      });

      audioEngine.setBandGain(bandIndex, rowIndex);
    },
    [isPlaying]
  );

  // -- Ritual Completion --
  const handleRitualComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;

    if (requestRef.current) cancelAnimationFrame(requestRef.current);

    // Capture SoundPrint
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      captureSoundPrint(dataUrl);
    }

    const blob = audioEngine.getRecordingBlob();
    if (blob) {
      saveRecording(blob, activeRows);
    }

    trackEvent('ritual_complete', {
      durationPlayed: (Date.now() - startTimeRef.current) / 1000,
    });

    navigate('/result');
  }, [activeRows, captureSoundPrint, saveRecording, navigate, trackEvent]);

  // -- Game Loop --
  const updateLoop = useCallback(() => {
    if (!startTimeRef.current) return;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const duration = state.audioBuffer?.duration || 0;

    if (duration > 0 && elapsed > duration + 1) {
      handleRitualComplete();
    }

    requestRef.current = requestAnimationFrame(updateLoop);
  }, [state.audioBuffer, handleRitualComplete]);

  // -- Start Sequence --
  const beginActualPlayback = async () => {
    if (!state.audioBuffer) return;
    try {
      completedRef.current = false;
      await audioEngine.init();

      const canvas = document.querySelector('canvas');
      const videoStream = canvas ? (canvas as HTMLCanvasElement).captureStream(30) : null;

      audioEngine.startPlayback(state.audioBuffer, videoStream, (blob) => {
        if (blob) saveRecording(blob, activeRows);
        handleRitualComplete();
      });

      setIsPlaying(true);
      startTimeRef.current = Date.now();
      requestRef.current = requestAnimationFrame(updateLoop);
      trackEvent('ritual_start');
    } catch (e) {
      console.error('Failed to start ritual:', e);
    }
  };

  const handleLaunchClick = () => {
    if (isPlaying || isIntroPlaying || !state.audioBuffer) return;
    setIsIntroPlaying(true);
    trackEvent('intro_video_start');
  };

  const handleClaimNFT = () => {
    const userWallet = (state as any).user?.wallet_address;
    if (!userWallet) return;

    // Manifold Link Constructor
    const claimUrl = `https://manifold.xyz/c/${MANIFOLD_SLUG}?function=allowListMint&args=[{"value":"${userWallet}","type":"address"},{"value":"1","type":"uint256"}]`;
    
    trackEvent('nft_claim_click');
    window.open(claimUrl, '_blank');
  };

  useEffect(() => {
    return () => {
      audioEngine.stop();
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  // -- Input Normalization --
  const updateFromPointerEvent = (e: React.PointerEvent) => {
    const el = stageRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const x01 = (e.clientX - r.left) / r.width;
    const y01Top = (e.clientY - r.top) / r.height;
    const y01 = 1 - y01Top;

    const cx = Math.min(1, Math.max(0, x01));
    const cy = Math.min(1, Math.max(0, y01));

    setPointer01(prev => ({ ...prev, x: cx, y: cy }));
    if (pointer01.down) applyInteraction01(cx, cy);
  };

  return (
    <div
      ref={stageRef}
      style={{
        width: '100vw',
        height: '100dvh',
        background: '#050810',
        position: 'relative',
        overflow: 'hidden',
        touchAction: 'none',
      }}
    >
      {isIntroPlaying && (
        <video
          src="/intro-dissolve.mp4"
          autoPlay
          muted
          playsInline
          preload="auto"
          onEnded={() => {
            setIsIntroPlaying(false);
            beginActualPlayback();
          }}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 100,
            background: '#050810',
          }}
        />
      )}

      {/* R3F CANVAS - VISUAL INSTRUMENT */}
      <div style={{ width: '100%', height: '100%', opacity: isPlaying ? 1 : 0, transition: 'opacity 1s ease-in' }}>
        <Canvas
          dpr={[1, 2]}
          gl={{
            preserveDrawingBuffer: true,
            antialias: false,
            alpha: false,
          }}
          orthographic
          camera={{ zoom: 1, position: [0, 0, 1] }}
          style={{ position: 'absolute', inset: 0 }}
        >
          <FlowFieldInstrument pointer01={pointer01} countdownProgress={0} />
        </Canvas>
      </div>

      {/* FULL-SCREEN INPUT LAYER */}
      {isPlaying && !isIntroPlaying && (
        <div
          style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: 'crosshair' }}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            const el = stageRef.current!;
            const r = el.getBoundingClientRect();
            const x01 = (e.clientX - r.left) / r.width;
            const y01 = 1 - (e.clientY - r.top) / r.height;
            const cx = Math.min(1, Math.max(0, x01));
            const cy = Math.min(1, Math.max(0, y01));

            setPointer01({ x: cx, y: cy, down: true });
            applyInteraction01(cx, cy);
          }}
          onPointerMove={updateFromPointerEvent}
          onPointerUp={() => setPointer01(prev => ({ ...prev, down: false }))}
          onPointerCancel={() => setPointer01(prev => ({ ...prev, down: false }))}
        />
      )}

      {/* LAUNCH SCREEN */}
      {!isPlaying && !isIntroPlaying && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: "url('/ritual-launch-bg.jpg')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column', // Changed to column to stack Claim button
            alignItems: 'center',
            justifyContent: 'center',
            gap: '20px'
          }}
        >
          {/* Pulsing Ritual Start Button */}
          <button
            onClick={handleLaunchClick}
            disabled={!state.audioBuffer}
            style={{
              width: '28vmin',
              height: '28vmin',
              borderRadius: '50%',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: !state.audioBuffer ? 'wait' : 'pointer',
              boxShadow: !state.audioBuffer ? 'none' : '0 0 50px rgba(0, 255, 102, 0.4)',
              animation: !state.audioBuffer ? 'none' : 'pulse 3s infinite ease-in-out',
            }}
          />

          {/* 🎁 NFT CLAIM BUTTON (Only shows if allowance > 0) */}
          {allowance > 0 && (
            <button
              onClick={handleClaimNFT}
              style={{
                padding: '12px 24px',
                background: 'rgba(0, 255, 102, 0.2)',
                border: '1px solid #00ff66',
                color: '#00ff66',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                letterSpacing: '2px',
                textTransform: 'uppercase',
                backdropFilter: 'blur(10px)',
                marginTop: '40px'
              }}
            >
              🎁 Claim Monthly NFT Reward
            </button>
          )}

          <style>{`@keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.02); } 100% { transform: scale(1); } }`}</style>
        </div>
      )}
    </div>
  );
};

export default InstrumentPage;