// src/pages/InstrumentPage.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';

import { useApp } from '../state/AppContext';
import { useAnalytics } from '../hooks/useAnalytics';
import { BAND_COLORS } from '../config/bandColors';
import audioEngine from '../audio/AudioEngine';
import { BandColumn } from '../components/BandColumn';
import { Ribbon } from '../components/Ribbon';

const MAX_BANDS = 36;
const MAX_ROWS = 36;
const RITUAL_DURATION_SEC = 36; // controls when ribbon appears (last 36s of track)

const InstrumentScene: React.FC<{
  activeRows: number[];
  handleInteraction: (uv: THREE.Vector2) => void;
  showRibbon: boolean;
}> = ({ activeRows, handleInteraction, showRibbon }) => {
  return (
    <group>
      {/* Invisible hit plane for pointer/touch input */}
      <mesh
        position={[0, 0, 0.1]}
        visible={false}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => handleInteraction(e.uv!)}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          if (e.buttons > 0 || e.pointerType === 'touch') {
            handleInteraction(e.uv!);
          }
        }}
      >
        <planeGeometry args={[2, 2]} />
        <meshBasicMaterial color="red" wireframe />
      </mesh>

      {/* Columns */}
      {BAND_COLORS.map((color, index) => (
        <BandColumn
          key={index}
          index={index}
          colorData={color}
          activeRow={activeRows[index]}
          maxRows={MAX_ROWS}
          maxBands={MAX_BANDS}
        />
      ))}

      {/* Ribbon appears only when showRibbon === true */}
      <Ribbon
        finalEQState={activeRows}
        maxBands={MAX_BANDS}
        maxRows={MAX_ROWS}
        isVisible={showRibbon}
      />
    </group>
  );
};

const InstrumentPage: React.FC = () => {
  const navigate = useNavigate();
  const { state, saveRecording, setAudioBuffer, captureSoundPrint } = useApp();
  const { trackEvent } = useAnalytics();

  const [isPlaying, setIsPlaying] = useState(false);
  const [activeRows, setActiveRows] = useState<number[]>(new Array(MAX_BANDS).fill(-1));
  const [showRibbon, setShowRibbon] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isDecoding, setIsDecoding] = useState(false);

  const requestRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const completedRef = useRef(false); // prevent double-complete

  // Kick back to landing if no file/buffer
  useEffect(() => {
    if (!state.file && !state.audioBuffer) {
      navigate('/');
    }
  }, [state.file, state.audioBuffer, navigate]);

  // Decode the uploaded file into an AudioBuffer (if needed)
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

  const handleInteraction = useCallback(
    (uv: THREE.Vector2) => {
      if (!isPlaying) return;

      const bandIndex = Math.floor(uv.x * MAX_BANDS);
      const rowIndex = Math.floor(uv.y * MAX_ROWS);

      if (
        bandIndex >= 0 &&
        bandIndex < MAX_BANDS &&
        rowIndex >= 0 &&
        rowIndex < MAX_ROWS
      ) {
        setActiveRows(prev => {
          const newRows = [...prev];
          newRows[bandIndex] = rowIndex;
          return newRows;
        });
        audioEngine.setBandGain(bandIndex, rowIndex);
      }
    },
    [isPlaying]
  );

  // ONE place that finalizes the ritual.
  const handleRitualComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;

    if (requestRef.current) cancelAnimationFrame(requestRef.current);

    trackEvent('ritual_complete', {
      durationPlayed: (Date.now() - startTimeRef.current) / 1000,
      bandsInteracted: activeRows.filter(r => r > -1).length,
    });

    // Capture the canvas as the Sound Print image
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      captureSoundPrint(dataUrl);
    }

    const blob = audioEngine.getRecordingBlob();
    if (blob) {
      saveRecording(blob, activeRows);
    }

    // Go straight to result/login gate
    navigate('/result');
  }, [activeRows, captureSoundPrint, saveRecording, navigate, trackEvent]);

  // Keeps timer + ribbon in sync with the audio buffer
  const updateLoop = useCallback(() => {
    if (!startTimeRef.current) return;

    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const duration = state.audioBuffer?.duration || 0;
    const remaining = Math.max(0, duration - elapsed);

    setTimeLeft(remaining);

    // This is your original behavior: show ribbon in last 36s of the track
    if (remaining <= RITUAL_DURATION_SEC && !showRibbon) {
      setShowRibbon(true);
    }

    // Keep looping while audio is playing; onended will call handleRitualComplete
    requestRef.current = requestAnimationFrame(updateLoop);
  }, [state.audioBuffer, showRibbon]);

  const startRitual = async () => {
    if (isPlaying || !state.audioBuffer) return;

    try {
      completedRef.current = false;
      await audioEngine.init();
      trackEvent('ritual_start');

      audioEngine.startPlayback(state.audioBuffer, () => {
        // Audio finished; finalize ritual
        handleRitualComplete();
      });

      setIsPlaying(true);
      startTimeRef.current = Date.now();
      requestRef.current = requestAnimationFrame(updateLoop);
    } catch (e) {
      console.error('Failed to start ritual:', e);
      trackEvent('ritual_error', { error: String(e) });
    }
  };

  useEffect(() => {
    return () => {
      audioEngine.stop();
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#050810',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 3D instrument */}
      <div
        style={{
          width: '100%',
          height: '100%',
          opacity: isPlaying ? 1 : 0,
          transition: 'opacity 1s ease-in',
        }}
      >
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 0, 1.4], fov: 60 }}
          style={{ touchAction: 'none' }}
        >
          <color attach="background" args={['#050810']} />
          <ambientLight intensity={0.2} />
          <pointLight position={[10, 10, 10]} intensity={0.5} />
          <InstrumentScene
            activeRows={activeRows}
            handleInteraction={handleInteraction}
            showRibbon={showRibbon}
          />
        </Canvas>
      </div>

      {/* Launch overlay */}
      {!isPlaying && (
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
            onClick={startRitual}
            disabled={!state.audioBuffer}
            aria-label="Start Ritual"
            style={{
              width: '28vmin',
              height: '28vmin',
              borderRadius: '50%',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: !state.audioBuffer ? 'wait' : 'pointer',
              boxShadow: !state.audioBuffer
                ? 'none'
                : '0 0 50px rgba(0, 255, 102, 0.4), inset 0 0 20px rgba(0, 255, 102, 0.2)',
              animation: !state.audioBuffer ? 'none' : 'pulse 3s infinite ease-in-out',
              transition: 'all 0.3s ease',
            }}
          />
          {!state.audioBuffer && (
            <div
              style={{
                position: 'absolute',
                color: 'rgba(0, 255, 102, 0.6)',
                fontFamily: 'monospace',
                fontSize: '12px',
                letterSpacing: '2px',
                pointerEvents: 'none',
              }}
            >
              INITIALIZING...
            </div>
          )}
          <style>{`
            @keyframes pulse {
              0% { transform: scale(1); box-shadow: 0 0 50px rgba(0, 255, 102, 0.4); }
              50% { transform: scale(1.02); box-shadow: 0 0 80px rgba(0, 255, 102, 0.7); }
              100% { transform: scale(1); box-shadow: 0 0 50px rgba(0, 255, 102, 0.4); }
            }
          `}</style>
        </div>
      )}

      {/* Countdown */}
      {isPlaying && (
        <div
          style={{
            position: 'absolute',
            bottom: '20px',
            right: '20px',
            fontFamily: 'monospace',
            color: timeLeft <= RITUAL_DURATION_SEC ? '#FF003C' : '#555',
            pointerEvents: 'none',
          }}
        >
          {timeLeft.toFixed(1)}s
        </div>
      )}
    </div>
  );
};

export default InstrumentPage;