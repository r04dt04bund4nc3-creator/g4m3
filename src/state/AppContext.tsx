// src/state/AppContext.tsx
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Session, AuthError } from '@supabase/supabase-js';

// ... (Interfaces remain the same) ...
interface AudioState {
  file: File | null;
  audioBuffer: AudioBuffer | null;
  isProcessing: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  recordingBlob: Blob | null;
}

interface RitualState {
  phase: 'upload' | 'ritual' | 'capture' | 'complete';
  countdown: number;
  soundPrintDataUrl: string | null;
  finalEQState: number[];
  isRecording: boolean;
}

interface AuthState {
  user: Session['user'] | null;
  isLoading: boolean;
  error: string | null;
}

interface AppContextType {
  audio: AudioState;
  state: AudioState; // Kept for backward compatibility
  ritual: RitualState;
  auth: AuthState;
  setFile: (file: File) => void;
  setAudioFile: (file: File) => void;
  setAudioBuffer: (buffer: AudioBuffer) => void;
  setPlaying: (playing: boolean) => void;
  updateCurrentTime: (time: number) => void;
  setRitualPhase: (phase: RitualState['phase']) => void;
  setCountdown: (count: number) => void;
  setSoundPrint: (data: any) => void;
  captureSoundPrint: (dataUrl: string) => void;
  saveRecording: (blob: Blob, finalEQ: number[]) => void;
  reset: () => void;
  signInWithDiscord: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithX: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  savePerformance: (gestureData: any, trackName: string, trackHash: string) => Promise<void>;
}

const initialAudioState: AudioState = {
  file: null,
  audioBuffer: null,
  isProcessing: false,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  recordingBlob: null,
};

const initialRitualState: RitualState = {
  phase: 'upload',
  countdown: 36,
  soundPrintDataUrl: null,
  finalEQState: [],
  isRecording: false,
};

const initialAuthState: AuthState = {
  user: null,
  isLoading: true,
  error: null,
};

const AppContext = createContext<AppContextType | null>(null);

// Helper for storage
const blobToDataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const dataURLToBlob = (dataUrl: string) => {
  try {
    const [meta, base64] = dataUrl.split(',');
    const mime = /data:(.*?);/.exec(meta)?.[1] ?? 'application/octet-stream';
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch (e) {
    console.error("Failed to convert dataURL to blob", e);
    return null;
  }
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [audio, setAudio] = useState<AudioState>(initialAudioState);
  const [ritual, setRitual] = useState<RitualState>(initialRitualState);
  const [auth, setAuth] = useState<AuthState>(initialAuthState);

  const restorePostAuthState = useCallback(() => {
    try {
      const sp = sessionStorage.getItem('g4m3_sound_print');
      if (sp) {
        setRitual(prev => ({ ...prev, soundPrintDataUrl: sp, phase: 'complete' }));
      }
      const rec = sessionStorage.getItem('g4m3_recording_data_url');
      if (rec) {
        const blob = dataURLToBlob(rec);
        if (blob) setAudio(prev => ({ ...prev, recordingBlob: blob }));
      }
      const fileName = sessionStorage.getItem('g4m3_filename');
      if (fileName) {
        setAudio(prev => ({ ...prev, file: new File([], fileName) }));
      }
      const eq = sessionStorage.getItem('g4m3_final_eq');
      if (eq) {
        setRitual(prev => ({ ...prev, finalEQState: JSON.parse(eq) }));
      }
    } catch (e) {
      console.warn('Post-auth restore failed:', e);
    }
  }, []);

  useEffect(() => {
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth({ user: session?.user || null, isLoading: false, error: null });
      if (session?.user) restorePostAuthState();
    });

    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuth({ user: session?.user || null, isLoading: false, error: null });
      if (session?.user) restorePostAuthState();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [restorePostAuthState]);

  const persistBeforeOAuth = useCallback(async () => {
    try {
      if (audio.recordingBlob) {
        const dataUrl = await blobToDataURL(audio.recordingBlob);
        // Safety check: Don't try to store if it's likely to crash sessionStorage
        if (dataUrl.length < 4000000) { 
          sessionStorage.setItem('g4m3_recording_data_url', dataUrl);
        } else {
          console.warn("Recording too large for sessionStorage. Consider IndexedDB.");
        }
      }
      if (ritual.soundPrintDataUrl) {
        sessionStorage.setItem('g4m3_sound_print', ritual.soundPrintDataUrl);
      }
      if (audio.file?.name) {
        sessionStorage.setItem('g4m3_filename', audio.file.name);
      }
      if (ritual.finalEQState?.length) {
        sessionStorage.setItem('g4m3_final_eq', JSON.stringify(ritual.finalEQState));
      }
      sessionStorage.setItem('post-auth-redirect', 'result');
    } catch (e) {
      console.warn('Persist before OAuth failed (likely quota exceeded):', e);
    }
  }, [audio.recordingBlob, audio.file?.name, ritual.soundPrintDataUrl, ritual.finalEQState]);

  const signInWithDiscord = useCallback(async () => {
    setAuth(prev => ({ ...prev, error: null }));
    await persistBeforeOAuth();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setAuth(prev => ({ ...prev, error: error.message }));
  }, [persistBeforeOAuth]);

  const signInWithGoogle = useCallback(async () => {
    setAuth(prev => ({ ...prev, error: null }));
    await persistBeforeOAuth();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setAuth(prev => ({ ...prev, error: error.message }));
  }, [persistBeforeOAuth]);

  const signInWithX = useCallback(async () => {
    setAuth(prev => ({ ...prev, error: null }));
    await persistBeforeOAuth();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'twitter',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setAuth(prev => ({ ...prev, error: error.message }));
  }, [persistBeforeOAuth]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    setAuth(prev => ({ ...prev, error: null }));
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) setAuth(prev => ({ ...prev, error: result.error.message }));
    return result;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Sign out error:', error);
    reset(); // Clean up state on signout
  }, []);

  const saveRecording = useCallback(async (blob: Blob, finalEQ: number[]) => {
    setAudio(prev => ({ ...prev, recordingBlob: blob }));
    setRitual(prev => ({ ...prev, finalEQState: finalEQ, phase: 'capture', isRecording: false }));
    try {
      const dataUrl = await blobToDataURL(blob);
      if (dataUrl.length < 4000000) {
        sessionStorage.setItem('g4m3_recording_data_url', dataUrl);
      }
      sessionStorage.setItem('g4m3_final_eq', JSON.stringify(finalEQ));
    } catch (e) {
      console.warn('Persist recording locally failed:', e);
    }
  }, []);

  const captureSoundPrint = useCallback((dataUrl: string) => {
    setRitual(prev => ({ ...prev, soundPrintDataUrl: dataUrl, phase: 'complete' }));
    try {
      sessionStorage.setItem('g4m3_sound_print', dataUrl);
    } catch (e) {
      console.warn('Persist sound print failed:', e);
    }
  }, []);

  const savePerformance = useCallback(async (gestureData: any, trackName: string, trackHash: string) => {
    // Optimization: Use context state instead of calling getUser() network request
    if (!auth.user) {
        console.error("Cannot save performance: No authenticated user.");
        return;
    }

    const { error } = await supabase.from('performances').insert({
      user_id: auth.user.id,
      track_name: trackName,
      track_hash: trackHash,
      gesture_data: gestureData,
      thumbnail_data_url: ritual.soundPrintDataUrl,
    });

    if (error) console.error('Error saving performance:', error);
  }, [auth.user, ritual.soundPrintDataUrl]);

  // UI helpers
  const setSoundPrint = useCallback((data: any) => { if (data?.dataUrl) captureSoundPrint(data.dataUrl); }, [captureSoundPrint]);
  const setFile = useCallback((file: File) => { setAudio(prev => ({ ...prev, file, isProcessing: true })); }, []);
  const setAudioBuffer = useCallback((buffer: AudioBuffer) => {
    setAudio(prev => ({ ...prev, audioBuffer: buffer, isProcessing: false, duration: buffer.duration }));
  }, []);
  const setPlaying = useCallback((playing: boolean) => { setAudio(prev => ({ ...prev, isPlaying: playing })); }, []);
  const updateCurrentTime = useCallback((time: number) => { setAudio(prev => ({ ...prev, currentTime: time })); }, []);
  const setRitualPhase = useCallback((phase: RitualState['phase']) => { setRitual(prev => ({ ...prev, phase })); }, []);
  const setCountdown = useCallback((count: number) => { setRitual(prev => ({ ...prev, countdown: count })); }, []);

  const reset = useCallback(() => {
    setAudio(initialAudioState);
    setRitual(initialRitualState);
    try {
      sessionStorage.removeItem('g4m3_sound_print');
      sessionStorage.removeItem('g4m3_recording_data_url');
      sessionStorage.removeItem('g4m3_filename');
      sessionStorage.removeItem('g4m3_final_eq');
      sessionStorage.removeItem('post-auth-redirect');
    } catch { /* ignore */ }
  }, []);

  return (
    <AppContext.Provider value={{
      audio,
      state: audio, // Backward compatibility
      ritual,
      auth,
      setFile,
      setAudioFile: setFile,
      setAudioBuffer,
      setPlaying,
      updateCurrentTime,
      setRitualPhase,
      setCountdown,
      setSoundPrint,
      captureSoundPrint,
      saveRecording,
      reset,
      signInWithDiscord,
      signInWithGoogle,
      signInWithX,
      signInWithEmail,
      signOut,
      savePerformance,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}