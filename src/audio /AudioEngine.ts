// src/audio/AudioEngine.ts
export class AudioEngine {
  private audioCtx: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private mediaRecorder: MediaRecorder | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private recordedChunks: Blob[] = [];
  
  private readonly MAX_BANDS = 36;
  private readonly MAX_ROWS = 36;

  async init(): Promise<void> {
    if (this.audioCtx && this.audioCtx.state === 'running') return;
    
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass();
    }
    
    if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
    }

    this.eqFilters = [];
    let previousNode: AudioNode | null = null;

    for (let i = 0; i < this.MAX_BANDS; i++) {
      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = 20 * Math.pow(2, i / 3);
      filter.Q.value = 1.4;
      filter.gain.value = 0;

      if (previousNode) {
        previousNode.connect(filter);
      }
      
      this.eqFilters.push(filter);
      previousNode = filter;
    }
  }

  setBandGain(bandIndex: number, rowIndex: number) {
    if (!this.audioCtx || !this.eqFilters[bandIndex]) return;
    
    const gainDB = (rowIndex / (this.MAX_ROWS - 1) * 36) - 18;
    this.eqFilters[bandIndex].gain.setTargetAtTime(
      gainDB, 
      this.audioCtx.currentTime, 
      0.1
    );
  }

  startPlayback(buffer: AudioBuffer, onEnded: () => void) {
    if (!this.audioCtx || this.eqFilters.length === 0) return;

    this.sourceNode = this.audioCtx.createBufferSource();
    this.sourceNode.buffer = buffer;
    this.sourceNode.connect(this.eqFilters[0]);
    
    this.destinationNode = this.audioCtx.createMediaStreamDestination();
    const lastFilter = this.eqFilters[this.MAX_BANDS - 1];
    
    lastFilter.connect(this.audioCtx.destination);
    lastFilter.connect(this.destinationNode);

    this.recordedChunks = [];
    
    try {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
            ? 'audio/webm;codecs=opus' 
            : 'audio/webm';
            
        this.mediaRecorder = new MediaRecorder(this.destinationNode.stream, { mimeType });
        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.recordedChunks.push(e.data);
        };
        this.mediaRecorder.start(100);
    } catch (e) {
        console.warn('MediaRecorder failed', e);
    }

    this.sourceNode.onended = () => {
        this.stopRecording();
        onEnded();
    };

    this.sourceNode.start(0);
  }

  stop() {
    if (this.sourceNode) {
        try { this.sourceNode.stop(); } catch(e) {}
        this.sourceNode = null;
    }
    this.stopRecording();
  }

  stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
    }
  }

  getRecordingBlob(): Blob {
    return new Blob(this.recordedChunks, { type: 'audio/webm' });
  }

  getAudioContext(): AudioContext | null {
    return this.audioCtx;
  }
}

// Named export
export const audioEngine = new AudioEngine();
// DEFAULT EXPORT (Fixes the "Not Seen" error)
export default audioEngine;