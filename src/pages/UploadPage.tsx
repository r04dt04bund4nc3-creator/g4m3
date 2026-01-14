import React, { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import audioEngine from '../audio/AudioEngine'; // Default import
import { useAnalytics } from '../hooks/useAnalytics';

export const UploadPage: React.FC = () => {
  const { setFile, setAudioBuffer, setRitualPhase } = useApp();
  const { trackEvent } = useAnalytics();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setFile(file);

      try {
        const arrayBuffer = await file.arrayBuffer();
        
        await audioEngine.init();
        const ctx = audioEngine.getAudioContext();
        
        const AudioContextClass =
          window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = ctx || new AudioContextClass();

        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        // Analytics
        trackEvent('upload_success', {
          duration: audioBuffer.duration,
          fileName: file.name,
          fileType: file.type
        });

        setAudioBuffer(audioBuffer);
        setRitualPhase('ritual');
        navigate('/instrument');
      } catch (error) {
        console.error('Error decoding audio:', error);
        trackEvent('upload_error', { error: 'decode_failed' });
        alert('Could not decode MP3. Please try another file.');
      }
    },
    [setFile, setAudioBuffer, setRitualPhase, navigate, trackEvent]
  );

  const triggerFilePicker = () => {
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
      }}
    >
      <div
        className="upload-hotspot"
        onClick={triggerFilePicker}
        aria-hidden="true"
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />

      <button onClick={triggerFilePicker} className="sr-only">
        Upload audio to begin ritual
      </button>
    </div>
  );
};