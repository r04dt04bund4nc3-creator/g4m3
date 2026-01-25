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
  shouldRedirectToResult: boolean; // New flag for client-side redirection
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
  clearRedirectFlag: () => void;
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
  shouldRedirectToResult: false,
};

const initialAuthState: AuthState = {
  user: null,
  isLoading: true,
  error: null,
};

const AppContext = createContext<AppContextType | null>(null);

// Helpers to persist/restore the ephemeral state across OAuth
const blobToDataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const dataURLToBlob = (dataUrl: string) => {
  const [meta, base64] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(meta)?.[1] ?? 'application/octet-stream';
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [audio, setAudio] = useState<AudioState>(initialAudioState);
  const [ritual, setRitual] = useState<RitualState>(initialRitualState);
  const [auth, setAuth] = useState<AuthState>(initialAuthState);

  // Restore ephemeral post-ritual state if we come back from OAuth
  const restorePostAuthState = useCallback(() => {
    try {
      const sp = sessionStorage.getItem('g4m3_sound_print');
      if (sp) {
        setRitual(prev => ({ ...prev, soundPrintDataUrl: sp, phase: 'complete' }));
      }
      const rec = sessionStorage.getItem('g4m3_recording_data_url');
      if (rec) {
        const blob = dataURLToBlob(rec);
        setAudio(prev => ({ ...prev, recordingBlob: blob }));
      }
      const fileName = sessionStorage.getItem('g4m3_filename');
      if (fileName) {
        const file = new File([], fileName);
        setAudio(prev => ({ ...prev, file }));
      }
      const eq = sessionStorage.getItem('g4m3_final_eq');
      if (eq) {
        setRitual(prev => ({ ...prev, finalEQState: JSON.parse(eq) }));
      }
      
      // Check if we need to redirect
      const redirectTarget = sessionStorage.getItem('post-auth-redirect');
      if (redirectTarget === 'result') {
        setRitual(prev => ({ ...prev, shouldRedirectToResult: true }));
        sessionStorage.removeItem('post-auth-redirect');
        
        // Clean up the URL hash so the user doesn't see access_token=...
        if (window.location.hash.includes('access_token')) {
            window.history.replaceState(null, '', window.location.pathname);
        }
      }
    } catch (e) {
      console.warn('Post-auth restore failed:', e);
    }
  }, []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth(prev => ({ ...prev, user: session?.user || null, isLoading: false, error: null }));
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuth(prev => ({ ...prev, user: session?.user || null, isLoading: false, error: null }));
      restorePostAuthState();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [restorePostAuthState]);

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
    setRitual(prev => ({
      ...prev,
      soundPrintDataUrl: dataUrl,
      phase: 'complete',
    }));
    try {
      if (dataUrl) sessionStorage.setItem('g4m3_sound_print', dataUrl);
    } catch (e) {
      console.warn('Persist sound print failed:', e);
    }
  }, []);

  const setSoundPrint = useCallback(
    (data: any) => {
      if (data?.dataUrl) captureSoundPrint(data.dataUrl);
    },
    [captureSoundPrint],
  );

  const saveRecording = useCallback(
    async (blob: Blob, finalEQ: number[]) => {
      setAudio(prev => ({ ...prev, recordingBlob: blob }));
      setRitual(prev => ({ ...prev, finalEQState: finalEQ, phase: 'capture', isRecording: false }));
      try {
        if (blob) {
          const dataUrl = await blobToDataURL(blob);
          sessionStorage.setItem('g4m3_recording_data_url', dataUrl);
        }
        if (finalEQ?.length) {
          sessionStorage.setItem('g4m3_final_eq', JSON.stringify(finalEQ));
        }
      } catch (e) {
        console.warn('Persist recording failed:', e);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setAudio(initialAudioState);
    setRitual(initialRitualState);
    try {
      sessionStorage.removeItem('g4m3_sound_print');
      sessionStorage.removeItem('g4m3_recording_data_url');
      sessionStorage.removeItem('g4m3_filename');
      sessionStorage.removeItem('g4m3_final_eq');
      sessionStorage.removeItem('post-auth-redirect');
    } catch {
      /* ignore */
    }
  }, []);

  const clearRedirectFlag = useCallback(() => {
    setRitual(prev => ({ ...prev, shouldRedirectToResult: false }));
  }, []);

  // Important: Use Origin (Root) to avoid sub-path 404s in dev environments
  const getRedirectUrl = () => {
    return window.location.origin;
  };

  const persistBeforeOAuth = useCallback(async () => {
    try {
      if (audio.recordingBlob) {
        const dataUrl = await blobToDataURL(audio.recordingBlob);
        sessionStorage.setItem('g4m3_recording_data_url', dataUrl);
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
      console.warn('Persist before OAuth failed:', e);
    }
  }, [audio.recordingBlob, audio.file?.name, ritual.soundPrintDataUrl, ritual.finalEQState]);

  const signInWithDiscord = useCallback(async () => {
    try {
      setAuth(prev => ({ ...prev, error: null }));
      await persistBeforeOAuth();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'discord',
        options: { redirectTo: getRedirectUrl() },
      });
      if (error) throw error;
    } catch (err: any) {
      setAuth(prev => ({ ...prev, error: err.message }));
    }
  }, [persistBeforeOAuth]);

  const signInWithGoogle = useCallback(async () => {
    try {
      setAuth(prev => ({ ...prev, error: null }));
      await persistBeforeOAuth();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: getRedirectUrl() },
      });
      if (error) throw error;
    } catch (err: any) {
      setAuth(prev => ({ ...prev, error: err.message }));
    }
  }, [persistBeforeOAuth]);

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
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from('performances').insert({
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
    [ritual.soundPrintDataUrl],
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
        clearRedirectFlag,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

// Optional: Custom Hook for components to auto-redirect
export function useAuthRedirect(navigate: (path: string) => void) {
  const { ritual, clearRedirectFlag } = useContext(AppContext)!;
  
  useEffect(() => {
    if (ritual.shouldRedirectToResult) {
      clearRedirectFlag();
      navigate('/result');
    }
  }, [ritual.shouldRedirectToResult, clearRedirectFlag, navigate]);
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}

export const useAppContext = useApp;