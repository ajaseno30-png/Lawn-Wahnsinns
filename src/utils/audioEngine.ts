/**
 * Audio Engine supporting both User-Uploaded Audio Files and Built-in Ambient Melody
 */

export class AudioEngine {
  private audioElement: HTMLAudioElement | null = null;
  private synthCtx: AudioContext | null = null;
  private isSynthesized = false;
  private synthInterval: number | null = null;
  private duration = 40.0; // demo length
  private currentTime = 0;
  private isPlaying = false;
  private listeners: Set<(time: number, isPlaying: boolean) => void> = new Set();
  private animFrame: number | null = null;
  private currentFile: File | Blob | null = null;
  private cachedAudioBuffer: AudioBuffer | null = null;
  private decodeError: string | null = null;

  constructor() {
    this.audioElement = new Audio();
    this.audioElement.preload = 'auto';

    this.audioElement.addEventListener('timeupdate', () => {
      if (this.audioElement) {
        this.currentTime = this.audioElement.currentTime;
        this.notify();
      }
    });

    this.audioElement.addEventListener('ended', () => {
      this.isPlaying = false;
      this.notify();
    });

    this.audioElement.addEventListener('loadedmetadata', () => {
      if (this.audioElement && !isNaN(this.audioElement.duration)) {
        this.duration = this.audioElement.duration;
        this.notify();
      }
    });
  }

  public subscribe(cb: (time: number, isPlaying: boolean) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify() {
    this.listeners.forEach((cb) => cb(this.currentTime, this.isPlaying));
  }

  public async loadUserAudio(file: File | Blob, fileName?: string): Promise<string> {
    this.stopSynth();
    this.currentFile = file;
    this.cachedAudioBuffer = null;
    this.decodeError = null;
    const url = URL.createObjectURL(file);
    if (this.audioElement) {
      this.audioElement.src = url;
      this.audioElement.load();
      this.isSynthesized = false;
    }

    // Pre-decode audio buffer in background
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const arrayBuf = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuf);
      if (ctx.state !== 'closed') ctx.close().catch(() => {});
      if (!decoded || decoded.length === 0 || decoded.duration <= 0) {
        throw new Error('Decoded audio has 0 length or duration.');
      }
      this.cachedAudioBuffer = decoded;
    } catch (e: any) {
      console.error('Audio decode failure on load:', e);
      this.decodeError = e?.message || 'Format file audio tidak valid atau tidak didukung.';
    }

    return url;
  }

  public async getAudioBuffer(targetDuration?: number): Promise<AudioBuffer> {
    if (this.currentFile) {
      if (this.cachedAudioBuffer) {
        if (this.cachedAudioBuffer.length === 0 || this.cachedAudioBuffer.duration <= 0) {
          throw new Error('Audio decoding failed. Export cancelled: Audio buffer is empty or duration is zero.');
        }
        return this.cachedAudioBuffer;
      }

      if (this.decodeError) {
        throw new Error(`Audio decoding failed. Export cancelled: ${this.decodeError}`);
      }

      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        const arrayBuf = await this.currentFile.arrayBuffer();
        this.cachedAudioBuffer = await ctx.decodeAudioData(arrayBuf);
        if (ctx.state !== 'closed') ctx.close().catch(() => {});

        if (!this.cachedAudioBuffer || this.cachedAudioBuffer.length === 0 || this.cachedAudioBuffer.duration <= 0) {
          throw new Error('Audio decoding failed. Export cancelled: Decoded buffer has 0 length.');
        }

        return this.cachedAudioBuffer;
      } catch (e: any) {
        console.error('Fatal audio decode error in getAudioBuffer:', e);
        throw new Error(`Audio decoding failed. Export cancelled: ${e?.message || 'File audio tidak dapat di-decode.'}`);
      }
    }

    // Jika audio lagu user gagal atau belum ada, tapi bukan mode synthesizer demo
    if (!this.isSynthesized) {
      throw new Error('Audio decoding failed. Export cancelled: File audio belum dimuat atau tidak valid.');
    }

    // Render synthesizer demo audio menggunakan Audio Graph yang IDENTIK dengan live preview:
    // Triangle Oscillator + 800Hz Lowpass Filter + Exponential Gain Envelope (44100Hz Stereo)
    try {
      const demoBuffer = await this.renderDemoSynthOffline(targetDuration || this.duration);
      this.cachedAudioBuffer = demoBuffer;
      return demoBuffer;
    } catch (err: any) {
      console.error('Fatal demo synth rendering error:', err);
      throw new Error(`Audio decoding failed. Export cancelled: Gagal mensintesis audio demo (${err?.message})`);
    }
  }

  /**
   * Single source-of-truth offline renderer untuk synth demo track
   * Memastikan waveform, frekuensi, gain envelope, lowpass filter, dan stereo channel
   * 100% IDENTIK antara live playback dan hasil rekaman video.
   */
  private async renderDemoSynthOffline(targetDurationSec?: number): Promise<AudioBuffer> {
    const sampleRate = 44100;
    const duration = targetDurationSec && targetDurationSec > 0 ? targetDurationSec : this.duration || 38.0;
    const totalSamples = Math.max(1, Math.floor(sampleRate * duration));

    const OfflineCtx =
      window.OfflineAudioContext ||
      (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;

    if (OfflineCtx) {
      const offlineCtx = new OfflineCtx(2, totalSamples, sampleRate);
      const notes = [
        220, 261.63, 329.63, 392,       // Am7 (A3, C4, E4, G4)
        174.61, 220, 261.63, 329.63,   // Fmaj7 (F3, A3, C4, E4)
        196, 246.94, 293.66, 392,       // G6 (G3, B3, D4, G4)
        164.81, 207.65, 246.94, 329.63  // E7 (E3, G#3, B3, E4)
      ];

      const interval = 0.48;
      let noteIdx = 0;

      for (let t = 0; t < duration - 0.1; t += interval) {
        const freq = notes[noteIdx % notes.length];
        noteIdx++;

        const osc = offlineCtx.createOscillator();
        const filter = offlineCtx.createBiquadFilter();
        const gain = offlineCtx.createGain();

        // Exact parameters identical to triggerChime()
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, t);

        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.04, t + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(offlineCtx.destination);

        osc.start(t);
        osc.stop(t + 1.25);
      }

      return await offlineCtx.startRendering();
    }

    // Pure mathematical software synthesis fallback jika OfflineAudioContext diblokir
    // Menghasilkan sinyal audio triangle wave asli dengan exponential decay sehingga tidak hening/silent
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const synthBuf = ctx.createBuffer(2, totalSamples, sampleRate);
    if (ctx.state !== 'closed') ctx.close().catch(() => {});

    const left = synthBuf.getChannelData(0);
    const right = synthBuf.getChannelData(1);
    const notes = [
      220, 261.63, 329.63, 392,
      174.61, 220, 261.63, 329.63,
      196, 246.94, 293.66, 392,
      164.81, 207.65, 246.94, 329.63
    ];
    const interval = 0.48;
    let noteIdx = 0;

    for (let t = 0; t < duration - 0.1; t += interval) {
      const freq = notes[noteIdx % notes.length];
      noteIdx++;
      const startSample = Math.floor(t * sampleRate);
      const noteSampleLength = Math.floor(1.2 * sampleRate);
      const endSample = Math.min(totalSamples, startSample + noteSampleLength);

      for (let s = startSample; s < endSample; s++) {
        const timeInNote = (s - startSample) / sampleRate;
        const phase = (timeInNote * freq) % 1;
        const tri = 4 * Math.abs(phase - 0.5) - 1;
        const env = timeInNote < 0.05
          ? (timeInNote / 0.05) * 0.04
          : 0.04 * Math.exp(-3 * (timeInNote - 0.05));
        const val = tri * env;
        left[s] += val;
        right[s] += val;
      }
    }

    return synthBuf;
  }

  public getCurrentFile(): File | Blob | null {
    return this.currentFile;
  }

  public async initDemoAudio() {
    // If no user audio is loaded, synthesize a gentle lofi ambient musical piece
    this.isSynthesized = true;
    this.duration = 38.0;
  }

  public play() {
    this.isPlaying = true;
    if (!this.isSynthesized && this.audioElement && this.audioElement.src) {
      this.audioElement.play().catch((e) => console.warn('Audio play error:', e));
    } else {
      this.startSynthPlayback();
    }
    this.startProgressTicker();
  }

  public pause() {
    this.isPlaying = false;
    if (this.audioElement && !this.isSynthesized) {
      this.audioElement.pause();
    }
    this.stopSynthPlayback();
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    this.notify();
  }

  public seek(seconds: number) {
    this.currentTime = Math.max(0, Math.min(seconds, this.duration));
    if (this.audioElement && !this.isSynthesized) {
      this.audioElement.currentTime = this.currentTime;
    }
    this.notify();
  }

  public getCurrentTime(): number {
    return this.currentTime;
  }

  public getDuration(): number {
    if (!this.isSynthesized && this.audioElement && !isNaN(this.audioElement.duration) && this.audioElement.duration > 0) {
      return this.audioElement.duration;
    }
    return this.duration;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getAudioElement(): HTMLAudioElement | null {
    return this.audioElement;
  }

  private startProgressTicker() {
    let lastTime = performance.now();
    const tick = () => {
      if (!this.isPlaying) return;
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (this.isSynthesized) {
        this.currentTime += dt;
        if (this.currentTime >= this.duration) {
          this.currentTime = 0; // loop demo
        }
      } else if (this.audioElement) {
        this.currentTime = this.audioElement.currentTime;
      }

      this.notify();
      this.animFrame = requestAnimationFrame(tick);
    };

    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.animFrame = requestAnimationFrame(tick);
  }

  // Melodic synthesizer for the demo track
  private startSynthPlayback() {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!this.synthCtx) {
        this.synthCtx = new AudioCtx();
      }
      if (this.synthCtx.state === 'suspended') {
        this.synthCtx.resume();
      }

      // Play soft warm piano chords arpeggio
      const notes = [
        220, 261.63, 329.63, 392, // Am7 (A3, C4, E4, G4)
        174.61, 220, 261.63, 329.63, // Fmaj7 (F3, A3, C4, E4)
        196, 246.94, 293.66, 392, // G6 (G3, B3, D4, G4)
        164.81, 207.65, 246.94, 329.63 // E7 (E3, G#3, B3, E4)
      ];

      let noteIdx = 0;
      if (this.synthInterval) clearInterval(this.synthInterval);

      this.synthInterval = window.setInterval(() => {
        if (!this.isPlaying || !this.synthCtx) return;
        const freq = notes[noteIdx % notes.length];
        this.triggerChime(freq);
        noteIdx++;
      }, 480);
    } catch {
      // AudioContext fallback
    }
  }

  private triggerChime(freq: number) {
    if (!this.synthCtx) return;
    try {
      const osc = this.synthCtx.createOscillator();
      const gain = this.synthCtx.createGain();
      const filter = this.synthCtx.createBiquadFilter();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, this.synthCtx.currentTime);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, this.synthCtx.currentTime);

      gain.gain.setValueAtTime(0.0001, this.synthCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.04, this.synthCtx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.synthCtx.currentTime + 1.2);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.synthCtx.destination);

      osc.start();
      osc.stop(this.synthCtx.currentTime + 1.25);
    } catch {
      // ignore
    }
  }

  private stopSynthPlayback() {
    if (this.synthInterval) {
      clearInterval(this.synthInterval);
      this.synthInterval = null;
    }
  }

  private stopSynth() {
    this.stopSynthPlayback();
    if (this.synthCtx) {
      try {
        this.synthCtx.close();
      } catch {
        // ignore
      }
      this.synthCtx = null;
    }
  }

  public destroy() {
    this.pause();
    this.stopSynth();
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = '';
      this.audioElement = null;
    }
    this.listeners.clear();
  }
}
