import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { useNavigate } from 'react-router-dom';

import { useApp } from '../state/AppContext';
import { useAnalytics } from '../hooks/useAnalytics';
import audioEngine from '../audio/AudioEngine';
import { FlowFieldInstrument } from '../components/FlowFieldInstrument';

const MAX_BANDS = 36;
const MAX_ROWS = 36;

const InstrumentPage: React.FC = () => {
  const navigate = useNavigate();
  const { state, saveRecording, setAudioBuffer, captureSoundPrint } = useApp();
  const { trackEvent } = useAnalytics();

  const [isPlaying, setIsPlaying] = useState(false);
  const [isIntroPlaying, setIsIntroPlaying] = useState(false);
  const [activeRows, setActiveRows] = useState<number[]>(new Array(MAX_BANDS).fill(-1));
  const [isDecoding, setIsDecoding] = useState(false);

  const [pointer01, setPointer01] = useState<{ x: number; y: number; down: boolean }>({
    x: 0.5,
    y: 0.5,
    down: false,
  });

  const stageRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!state.file && !state.audioBuffer) {
      navigate('/');
    }
  }, [state.file, state.audioBuffer, navigate]);

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

  const handleRitualComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    if (requestRef.current) cancelAnimationFrame(requestRef.current);

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

  const updateLoop = useCallback(() => {
    if (!startTimeRef.current) return;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const duration = state.audioBuffer?.duration || 0;
    if (duration > 0 && elapsed > duration + 1) {
       handleRitualComplete();
    }
    requestRef.current = requestAnimationFrame(updateLoop);
  }, [state.audioBuffer, handleRitualComplete]);

  const beginActualPlayback = async () => {
    if (!state.audioBuffer) return;
    try {
      completedRef.current = false;
      await audioEngine.init();
      const canvas = document.querySelector('canvas');
      const videoStream = canvas ? (canvas as any).captureStream(30) : null;
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

  useEffect(() => {
    return () => {
      audioEngine.stop();
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

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

      <div style={{ width: '100%', height: '100%', opacity: isPlaying ? 1 : 0, transition: 'opacity 1s ease-in' }}>
        <Canvas
          dpr={[1, 2]}
          gl={{ 
            // FIXED: preserveDrawingBuffer
            preserveDrawingBuffer: true,
            antialias: false,
            alpha: false
          }}
          orthographic 
          camera={{ zoom: 1, position: [0, 0, 1] }}
          style={{ position: 'absolute', inset: 0 }}
        >
          <FlowFieldInstrument 
            pointer01={pointer01} 
            downcountProgress={0}
            simDriftStrength={0.15}
            simAdvectStrength={0.012}
            simBlurAmount={0.12}
            simDecayLow={0.992}
            simDecayHigh={0.980}
            sparkCoreRadius={0.008}
            sparkAuraRadius={0.025}
            sparkStrengthStrength={0.6}
            sparkAuraStrength={0.08}
            powderStrength={0.35}
          />
        </Canvas>
      </div>

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
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
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
        </div>
      )}
    </div>
  );
};

export default InstrumentPage;