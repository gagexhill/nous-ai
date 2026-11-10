/**
 * Voice analyser: turns live audio (the microphone or a narration file) into a
 * few prosody features the orb can follow, measured every animation frame with
 * the Web Audio API. Nothing leaves the browser.
 *
 *   level       loudness envelope, 0..1 (fast attack, slower release)
 *   pitch       intonation, -1..1: octaves above/below the speaker's running
 *               average pitch (rises read positive), 0 when unvoiced
 *   brightness  spectral centroid, 0..1 (sibilants and crisp consonants high)
 *   onset       syllable-onset pulse, 0..1, kicked by spectral flux and decaying
 *   voiced      a pitch was found this frame
 *
 * The browser's built-in speech synthesis does not expose its audio, so it
 * cannot feed this analyser; App falls back to word-boundary pulses for it.
 */

export type VoiceSource = 'mic' | 'file';

export interface VoiceFeatures {
  level: number;
  pitch: number;
  brightness: number;
  onset: number;
  voiced: boolean;
}

export const SILENT_FEATURES: Readonly<VoiceFeatures> = {
  level: 0,
  pitch: 0,
  brightness: 0,
  onset: 0,
  voiced: false,
};

const FFT_SIZE = 2048;
const PITCH_MIN_HZ = 70;
const PITCH_MAX_HZ = 400;
const PITCH_CLARITY = 0.6; // normalised autocorrelation needed to call a frame voiced
const LEVEL_FLOOR_DB = -58;
const LEVEL_CEIL_DB = -12;
const CENTROID_MAX_HZ = 6000;

export class VoiceAnalyser {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private routedToSpeakers = false;
  // Bumped by every stop(); an async start that sees a different value after an
  // await was superseded and backs out instead of attaching its source.
  private gen = 0;

  private time = new Float32Array(FFT_SIZE);
  private spec = new Float32Array(FFT_SIZE / 2);
  private prevSpec = new Float32Array(FFT_SIZE / 2);
  private fluxAvg = 0;
  private refLogPitch = 0; // running average log2(f0); 0 = not yet seen
  private voicedTime = 0; // seconds of voiced audio since the source started

  private readonly out: VoiceFeatures = { ...SILENT_FEATURES };

  /** Which source is feeding the analyser, or null when stopped. */
  active: VoiceSource | null = null;
  /** Name of the loaded narration file, if any. */
  fileName: string | null = null;

  private ensureContext(): { ctx: AudioContext; analyser: AnalyserNode } {
    if (!this.ctx || !this.analyser) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0; // envelopes are smoothed here instead
    }
    return { ctx: this.ctx, analyser: this.analyser };
  }

  /** Throws an AbortError when a later start, stop or dispose superseded request `my`. */
  private checkCurrent(my: number): void {
    if (my !== this.gen) throw new DOMException('Superseded by a newer voice request', 'AbortError');
  }

  /**
   * Listen to the microphone. Must be called from a user gesture. Throws if
   * denied, or an AbortError if stop() or another start ran while it waited.
   */
  async startMic(): Promise<void> {
    this.stop();
    const my = this.gen;
    const { ctx, analyser } = this.ensureContext();
    await ctx.resume();
    this.checkCurrent(my);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
    if (my !== this.gen) {
      // Superseded while the permission prompt was open: release the device.
      stream.getTracks().forEach((t) => t.stop());
      this.checkCurrent(my);
    }
    this.stream = stream;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser); // not routed to the speakers: no feedback loop
    this.source = src;
    this.resetTracking();
    this.active = 'mic';
  }

  /**
   * Play a narration file through the speakers while analysing it. Must be
   * called from a user gesture. Resolves once playback starts; `onEnded` fires
   * when the file finishes on its own. Throws an AbortError if superseded.
   */
  async startFile(file: File, onEnded: () => void): Promise<void> {
    this.stop();
    const my = this.gen;
    const { ctx, analyser } = this.ensureContext();
    await ctx.resume();
    this.checkCurrent(my);
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    this.objectUrl = url;
    this.audio = audio;
    const src = ctx.createMediaElementSource(audio);
    src.connect(analyser);
    analyser.connect(ctx.destination);
    this.routedToSpeakers = true;
    this.source = src;
    audio.addEventListener('ended', () => {
      if (this.audio === audio) {
        this.stop();
        onEnded();
      }
    });
    this.resetTracking();
    this.active = 'file';
    this.fileName = file.name;
    try {
      await audio.play();
    } catch (err) {
      // A newer request already stopped this one; report that, not the pause.
      this.checkCurrent(my);
      throw err;
    }
    this.checkCurrent(my);
  }

  /** Stop the current source. Also supersedes any start still waiting. */
  stop(): void {
    this.gen++;
    this.source?.disconnect();
    this.source = null;
    // Only file playback routes the analyser to the speakers; drop that link.
    if (this.analyser && this.routedToSpeakers) this.analyser.disconnect();
    this.routedToSpeakers = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.active = null;
    this.fileName = null;
  }

  /** Stop and release the audio context entirely (component unmount). */
  async dispose(): Promise<void> {
    this.stop();
    const ctx = this.ctx;
    this.ctx = null;
    this.analyser = null;
    if (ctx) await ctx.close();
  }

  private resetTracking(): void {
    this.prevSpec.fill(0);
    this.fluxAvg = 0;
    this.refLogPitch = 0;
    this.voicedTime = 0;
    Object.assign(this.out, SILENT_FEATURES);
  }

  /** Measure the current frame. `dt` is seconds since the last call. */
  read(dt: number): Readonly<VoiceFeatures> {
    const a = this.analyser;
    const ctx = this.ctx;
    if (!a || !ctx || !this.active) {
      const k = Math.exp(-dt * 8);
      this.out.level *= k;
      this.out.onset *= k;
      this.out.pitch *= k;
      this.out.brightness *= k;
      this.out.voiced = false;
      return this.out;
    }
    const sr = ctx.sampleRate;

    // Loudness: RMS in dB mapped to 0..1, fast attack and slower release.
    a.getFloatTimeDomainData(this.time);
    let sum = 0;
    for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i];
    const rms = Math.sqrt(sum / this.time.length);
    const db = 20 * Math.log10(rms + 1e-9);
    const target = clamp01((db - LEVEL_FLOOR_DB) / (LEVEL_CEIL_DB - LEVEL_FLOOR_DB));
    const rate = target > this.out.level ? 30 : 7;
    this.out.level += (target - this.out.level) * (1 - Math.exp(-dt * rate));

    // Spectrum (dB per bin) → brightness (centroid) and onsets (positive flux).
    a.getFloatFrequencyData(this.spec);
    const binHz = sr / FFT_SIZE;
    const maxBin = Math.min(this.spec.length, Math.floor(CENTROID_MAX_HZ / binHz));
    let wSum = 0;
    let mSum = 0;
    let flux = 0;
    for (let i = 1; i < maxBin; i++) {
      const mag = Math.pow(10, this.spec[i] / 20);
      wSum += mag * i * binHz;
      mSum += mag;
      const d = mag - this.prevSpec[i];
      if (d > 0) flux += d;
      this.prevSpec[i] = mag;
    }
    const gate = target > 0.08; // ignore room noise
    const centroid = mSum > 0 ? wSum / mSum : 0;
    const bTarget = gate ? clamp01(centroid / CENTROID_MAX_HZ) : 0;
    this.out.brightness += (bTarget - this.out.brightness) * (1 - Math.exp(-dt * 12));

    this.fluxAvg += (flux - this.fluxAvg) * (1 - Math.exp(-dt * 2));
    this.out.onset *= Math.exp(-dt * 7);
    if (gate && this.fluxAvg > 0 && flux > this.fluxAvg * 1.8) {
      this.out.onset = Math.max(this.out.onset, clamp01((flux / this.fluxAvg - 1.8) / 2 + 0.5));
    }

    // Pitch: normalised autocorrelation over the speech range.
    const f0 = gate ? detectPitch(this.time, sr) : 0;
    let pTarget = 0;
    this.out.voiced = f0 > 0;
    if (f0 > 0) {
      const lp = Math.log2(f0);
      if (this.refLogPitch === 0) this.refLogPitch = lp;
      // The reference settles fast over the first moments of voice (one onset
      // frame can mislead it), then drifts slowly, so the orb follows the melody
      // of speech rather than the speaker's absolute register.
      this.voicedTime += dt;
      const refRate = this.voicedTime < 0.6 ? 5 : 0.4;
      this.refLogPitch += (lp - this.refLogPitch) * (1 - Math.exp(-dt * refRate));
      pTarget = Math.max(-1, Math.min(1, (lp - this.refLogPitch) * 2)); // ±half-octave → ±1
    }
    this.out.pitch += (pTarget - this.out.pitch) * (1 - Math.exp(-dt * (f0 > 0 ? 10 : 3)));

    return this.out;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Fundamental frequency in Hz, or 0 when the frame is not clearly voiced. Exported for checks. */
export function detectPitch(buf: Float32Array, sampleRate: number): number {
  const minLag = Math.floor(sampleRate / PITCH_MAX_HZ);
  const maxLag = Math.min(buf.length >> 1, Math.ceil(sampleRate / PITCH_MIN_HZ));
  const n = buf.length - maxLag;
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += buf[i] * buf[i];
  if (e0 <= 0) return 0;

  let bestLag = -1;
  let best = 0;
  let prev = 0;
  let prevPrev = 0;
  const corr = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    let e1 = 0;
    for (let i = 0; i < n; i++) {
      const y = buf[i + lag];
      c += buf[i] * y;
      e1 += y * y;
    }
    const r = e1 > 0 ? c / Math.sqrt(e0 * e1) : 0;
    corr[lag] = r;
    // Take the first strong local peak: later peaks are octave errors.
    if (lag > minLag + 1 && prev > PITCH_CLARITY && prev >= prevPrev && prev >= r) {
      bestLag = lag - 1;
      best = prev;
      break;
    }
    prevPrev = prev;
    prev = r;
  }
  if (bestLag < 0 || best < PITCH_CLARITY) return 0;
  // Parabolic interpolation around the peak for sub-sample precision.
  const y0 = corr[bestLag - 1];
  const y1 = corr[bestLag];
  const y2 = corr[bestLag + 1];
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  return sampleRate / (bestLag + shift);
}
