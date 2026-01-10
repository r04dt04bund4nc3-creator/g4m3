import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';

// Internal Logic & State
import { useApp } from '../state/AppContext';
import { audioEngine } from '../audio/AudioEngine';
import { BAND_COLORS } from '../config/bandColors';

// Components
import { BandColumn } from '../components/BandColumn';
import { Ribbon } from '../components/Ribbon';

// Constants
const MAX_BANDS = 36;
const MAX_ROWS = 36;
const RITUAL_DURATION_SEC = 36; // Duration of the Ribbon phase

// --- SCENE COMPONENT (Handles 3D Logic) ---
const InstrumentScene: React.FC<{
  activeRows: number[];
  handleInteraction: (uv: THREE.Vector2) => void;
  showRibbon: boolean;
}> = ({ activeRows, handleInteraction, showRibbon }) => {
  
  // An invisible plane that captures all touch/mouse events
  // It spans from -1 to 1 in both X and Y, matching the BandColumn coordinate system
  return (
    <group>
      {/* 1. The Interaction Layer */}
      <mesh
        position={[0, 0, 0.1]} // Slightly in front
        visible={false} // Invisible but interactive
        onPointerDown={(e) => handleInteraction(e.uv!)}
        onPointerMove={(e) => {
          // Only trigger if mouse is down or it's a touch drag
          if (e.buttons > 0 || e.pointerType === 'touch') {
            handleInteraction(e.uv!);
          }
        }}
      >
        <planeGeometry args={[2, 2]} />
        <meshBasicMaterial color="red" wireframe />
      </mesh>

      {/* 2. The Visual Columns */}
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

      {/* 3. The Ritual Ribbon (Appears at the end) */}
      <Ribbon
        finalEQState={activeRows}
        maxBands={MAX_BANDS}
        maxRows={MAX_ROWS}
        isVisible={showRibbon}
      />
    </group>
  );
};

// --- MAIN PAGE COMPONENT ---
const InstrumentPage: React.FC = () => {
  const navigate = useNavigate();
  const { state, saveRecording } = useApp();
  
  // State
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeRows, setActiveRows] = useState<number[]>(new Array(MAX_BANDS).fill(-1));
  const [showRibbon, setShowRibbon] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);

  // Refs for animation loop management
  const requestRef = useRef<number>();
  const startTimeRef = useRef<number>(0);

  // 1. Redirect if no file
  useEffect(() => {
    if (!state.file && !state.audioBuffer) {
      navigate("/");
    }
  }, [state.file, state.audioBuffer, navigate]);

  // 2. Interaction Handler (Maps 0-1 UV coords to Band/Row indices)
  const handleInteraction = useCallback((uv: THREE.Vector2) => {
    if (!isPlaying) return;

    // UV.x (0 to 1) -> Band Index (0 to 35)
    const bandIndex = Math.floor(uv.x * MAX_BANDS);
    
    // UV.y (0 to 1) -> Row Index (0 to 35)
    const rowIndex = Math.floor(uv.y * MAX_ROWS);

    if (bandIndex >= 0 && bandIndex < MAX_BANDS && rowIndex >= 0 && rowIndex < MAX_ROWS) {
      // 1. Update Visual State
      setActiveRows(prev => {
        const newRows = [...prev];
        newRows[bandIndex] = rowIndex;
        return newRows;
      });

      // 2. Update Audio Engine
      audioEngine.setBandGain(bandIndex, rowIndex);
    }
  }, [isPlaying]);

  // 3. Game Loop / Timer
  const updateLoop = useCallback(() => {
    if (!startTimeRef.current) return;

    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const duration = state.audioBuffer?.duration || 0;
    const remaining = Math.max(0, duration - elapsed);

    setTimeLeft(remaining);

    // Trigger Ribbon if within the final window
    if (remaining <= RITUAL_DURATION_SEC && !showRibbon) {
      setShowRibbon(true);
    }

    requestRef.current = requestAnimationFrame(updateLoop);
  }, [state.audioBuffer, showRibbon]);

  // 4. Start Sequence
  const startRitual = async () => {
    if (isPlaying || !state.audioBuffer) return;

    try {
      await audioEngine.init();
      
      // Start playback logic
      audioEngine.startPlayback(state.audioBuffer, () => {
        // ON END:
        handleRitualComplete();
      });

      setIsPlaying(true);
      startTimeRef.current = Date.now();
      requestRef.current = requestAnimationFrame(updateLoop);

    } catch (e) {
      console.error("Failed to start audio engine", e);
    }
  };

  const handleRitualComplete = () => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    const blob = audioEngine.getRecordingBlob();
    
    // Save recording + visual state to context
    saveRecording(blob, activeRows);
    
    // Navigate to results
    navigate("/result"); // Assuming you have a result page or back to /sound-print logic
  };

  // Cleanup
  useEffect(() => {
    return () => {
      audioEngine.stop();
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', position: 'relative' }}>
      
      {/* 3D CANVAS */}
      <Canvas
        dpr={[1, 2]} // Optimize pixel ratio for tablets
        camera={{ position: [0, 0, 1.4], fov: 60 }} // Camera tuned to fit the -1 to 1 plane
        style={{ touchAction: 'none' }} // Prevents scrolling on mobile while playing
      >
        <color attach="background" args={['#050810']} />
        
        {/* Simple Lights */}
        <ambientLight intensity={0.2} />
        <pointLight position={[10, 10, 10]} intensity={0.5} />
        
        {/* The Instrument Logic */}
        <InstrumentScene 
            activeRows={activeRows} 
            handleInteraction={handleInteraction}
            showRibbon={showRibbon}
        />
      </Canvas>

      {/* OVERLAY: BLACK START SCREEN */}
      {!isPlaying && (
        <div 
          onClick={startRitual}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'black',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 50
          }}
        >
          <div style={{ textAlign: 'center', color: '#333' }}>
            {/* Minimalist prompt as per "Dark Screen" request */}
            <p style={{ fontFamily: 'monospace', letterSpacing: '2px' }}>
              TAP TO BEGIN RITUAL
            </p>
          </div>
        </div>
      )}

      {/* HUD: Time Display (Optional, keeps user grounded) */}
      {isPlaying && (
        <div style={{
          position: 'absolute',
          bottom: '20px',
          right: '20px',
          fontFamily: 'monospace',
          color: timeLeft <= RITUAL_DURATION_SEC ? '#FF003C' : '#555',
          pointerEvents: 'none'
        }}>
          {timeLeft.toFixed(1)}s
        </div>
      )}
    </div>
  );
};

export default InstrumentPage;
