// src/pages/UploadPage.tsx
import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { audioEngine } from '../audio/AudioEngine'; // named import, matches your AudioEngine.ts
import { useAnalytics } from '../hooks/useAnalytics';

export const UploadPage: React.FC = () => {
  const { setFile, setAudioBuffer, setRitualPhase } = useApp();
  const { trackEvent } = useAnalytics();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // allow re‑selecting the same file later
      event.target.value = '';

      setIsProcessing(true);
      setFile(file);

      // log the attempt immediately (shows up even if decode fails)
      trackEvent('upload_attempt', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'unknown',
        userAgent: navigator.userAgent,
        platform: navigator.platform,
      });

      try {
        // IMPORTANT for iOS: initialize / resume AudioContext right after the user action
        await audioEngine.init();
        const ctx = audioEngine.getAudioContext();
        if (!ctx) throw new Error('AudioContext not available');

        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        trackEvent('upload_success', {
          duration: audioBuffer.duration,
          fileName: file.name,
          fileType: file.type,
        });

        setAudioBuffer(audioBuffer);
        setRitualPhase('ritual');
        navigate('/instrument');
      } catch (error: any) {
        console.error('Error decoding audio:', error);
        trackEvent('upload_error', {
          error: error?.message || 'decode_failed',
          fileType: file.type,
        });
        alert(
          "This file couldn't be decoded on your device. Try a different MP3 or standard audio file."
        );
        setIsProcessing(false);
      }
    },
    [setFile, setAudioBuffer, setRitualPhase, navigate, trackEvent]
  );

  const triggerFilePicker = () => {
    if (isProcessing) return; // don't let them start another while decoding
    fileInputRef.current?.click();
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        backgroundImage: "url('/ritual-bg-v2.jpg')",
        backgroundSize: 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundColor: '#000',
        cursor: isProcessing ? 'wait' : 'default',
      }}
    >
      {/* Processing overlay so testers know something is happening */}
      {isProcessing && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            color: '#00ff66',
            fontFamily: 'monospace',
            textAlign: 'center',
            padding: '1rem',
          }}
        >
          <div style={{ marginBottom: '0.5rem' }}>DECODING AUDIO…</div>
          <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>
            If your track is long, this can take a few seconds.
          </div>
        </div>
      )}

      {/* Invisible click target */}
      <div
        className="upload-hotspot"
        onClick={triggerFilePicker}
        aria-hidden="true"
        style={{ pointerEvents: isProcessing ? 'none' : 'auto' }}
      />

      {/* Actual file input, hidden */}
      <input
        ref={fileInputRef}
        type="file"
        // Expanded list so iPadOS stops greying out MP3s
        accept=".mp3,audio/mpeg,audio/mp3,.wav,audio/wav,.m4a,audio/x-m4a,audio/*,video/*"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />
    </div>
  );
};