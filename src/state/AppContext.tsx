// src/state/AppContext.tsx
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Session, AuthError } from '@supabase/supabase-js';

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
  state: AudioState;
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

export function AppProvider({ children }: { children: ReactNode }) {
  const [audio, setAudio] = useState<AudioState>(initialAudioState);
  const [ritual, setRitual] = useState<RitualState>(initialRitualState);
  const [auth, setAuth] = useState<AuthState>(initialAuthState);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth(prev => ({ ...prev, user: session?.user || null, isLoading: false, error: null }));
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuth(prev => ({ ...prev, user: session?.user || null, isLoading: false, error: null }));
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const setFile = useCallback((file: File) => {
    setAudio(prev => ({ ...prev, file, isProcessing: true }));
  }, []);

  const setAudioFile = setFile;

  const setAudioBuffer = useCallback((buffer: AudioBuffer) => {
    setAudio(prev => ({
      ...prev,
      audioBuffer: buffer,
      isProcessing: false,
      duration: buffer.duration,
    }));
  }, []);

  const setPlaying = useCallback((playing: boolean) => {
    setAudio(prev => ({ ...prev, isPlaying: playing }));
  }, []);

  const updateCurrentTime = useCallback((time: number) => {
    setAudio(prev => ({ ...prev, currentTime: time }));
  }, []);

  const setRitualPhase = useCallback((phase: RitualState['phase']) => {
    setRitual(prev => ({ ...prev, phase }));
  }, []);

  const setCountdown = useCallback((count: number) => {
    setRitual(prev => ({ ...prev, countdown: count }));
  }, []);

  const captureSoundPrint = useCallback((dataUrl: string) => {
    console.log('Sound Print captured:', dataUrl.slice(0, 50) + '...');
    setRitual(prev => ({
      ...prev,
      soundPrintDataUrl: dataUrl,
      phase: 'complete',
    }));
  }, []);

  const setSoundPrint = useCallback((data: any) => {
    if (data.dataUrl) captureSoundPrint(data.dataUrl);
  }, [captureSoundPrint]);

  const saveRecording = useCallback((blob: Blob, finalEQ: number[]) => {
    setAudio(prev => ({ ...prev, recordingBlob: blob }));
    setRitual(prev => ({ ...prev, finalEQState: finalEQ, phase: 'capture', isRecording: false }));
  }, []);

  const reset = useCallback(() => {
    setAudio(initialAudioState);
    setRitual(initialRitualState);
  }, []);

  // --- Auth Functions ---

  const signInWithDiscord = useCallback(async () => {
    try {
      setAuth(prev => ({ ...prev, error: null }));
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'discord',
      }); // Supabase uses Site URL
      if (error) throw error;
    } catch (err: any) {
      setAuth(prev => ({ ...prev, error: err.message }));
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    try {
      setAuth(prev => ({ ...prev, error: null }));
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
      }); // Supabase uses Site URL
      if (error) throw error;
    } catch (err: any) {
      setAuth(prev => ({ ...prev, error: err.message }));
    }
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    setAuth(prev => ({ ...prev, error: null }));
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuth(prev => ({ ...prev, error: error.message }));
    }
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Sign out error:', error);
  }, []);

  const savePerformance = useCallback(
    async (gestureData: any, trackName: string, trackHash: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('performances')
        .insert({
          user_id: user.id,
          track_name: trackName,
          track_hash: trackHash,
          gesture_data: gestureData,
          thumbnail_data_url: ritual.soundPrintDataUrl || null,
        });

      if (error) {
        console.error('Error saving performance:', error);
      }
    },
    [ritual.soundPrintDataUrl]
  );

  return (
    <AppContext.Provider
      value={{
        audio,
        state: audio,
        ritual,
        auth,
        setFile,
        setAudioFile,
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
        signInWithEmail,
        signOut,
        savePerformance,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}

export const useAppContext = useApp;