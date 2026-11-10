/**
 * App — stage for the reactive orb/face + the HUD.
 *
 * Two views share one particle system: Orb (the resting orb, voice-reactive) and
 * Face (the orb forms into the FLAME face: fill + particles, with the morph,
 * scrub, surface and region controls). Switching views runs the morph.
 * OrbitControls spins it.
 *
 * One loop owns amplitudeRef and voiceRef. A live voice source (microphone or a
 * narration file, see face/voiceAnalyser.ts) drives them from the audio itself:
 * loudness and syllable onsets swell the orb, intonation stretches it, brightness
 * lights it. Without one, the browser speech driver gives a word-boundary pulse
 * (its audio is not exposed), and at rest the orb breathes slowly. The orb state
 * becomes "listening" on the microphone and "speaking" during playback or speech.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { OrbitControls } from '@react-three/drei';
import { ReactorCanvas } from './components/reactor/ReactorCanvas';
import { FaceParticles } from './components/face/FaceParticles';
import { ControlPanel, type View } from './components/ui/ControlPanel';
import { createVoiceWave, pushVoiceWave, WAVE_RATE } from './face/voiceWave';
import type { OrbState } from './face/orbState';
import { loadFlameGeometry, type ParticleGeometry } from './face/flameMesh';
import { cancelSpeech, hasLocalVoice, speak, subscribeToVoices } from './face/speechDriver';
import {
  SILENT_FEATURES,
  VoiceAnalyser,
  type VoiceFeatures,
  type VoiceSource,
} from './face/voiceAnalyser';

const micSupported =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

// Swell spring: natural frequency 9 rad/s, damping ratio 0.55, so the orb
// overshoots a little and settles like something soft rather than snapping.
const SWELL_STIFFNESS = 81; // ω²
const SWELL_DAMPING = 9.9; // 2ζω

function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Permission was denied.';
    if (err.name === 'NotFoundError') return 'No microphone was found.';
    if (err.name === 'NotSupportedError') return 'This file type cannot be played.';
    return `${err.name}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export default function App(): React.ReactElement {
  const amplitudeRef = useRef<number>(0);
  const voiceRef = useRef<VoiceFeatures>({ ...SILENT_FEATURES });

  // Live voice input (microphone or narration file), created on first use.
  const analyserRef = useRef<VoiceAnalyser | null>(null);
  const [voiceSource, setVoiceSource] = useState<VoiceSource | null>(null);
  const [voiceFile, setVoiceFile] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Orb state: the HUD preview, overridden while a voice source or speech runs.
  const [previewState, setPreviewState] = useState<OrbState>('idle');
  const [speaking, setSpeaking] = useState(false);
  const localVoiceAvailable = useSyncExternalStore(subscribeToVoices, hasLocalVoice);
  const orbState: OrbState =
    voiceSource === 'mic'
      ? 'listening'
      : voiceSource === 'file' || speaking
        ? 'speaking'
        : previewState;
  const orbStateRef = useRef<OrbState>(orbState);
  orbStateRef.current = orbState;
  const speakingRef = useRef(false);
  speakingRef.current = speaking;
  const pulseRef = useRef(0);
  const swellVelRef = useRef(0);
  // 0..1: how much the voice speeds up the surface's flowing wave pattern.
  const flowRef = useRef(0);
  // Voice history for the outward rings on the orb, sampled at WAVE_RATE.
  const waveRef = useRef(createVoiceWave());
  const waveClockRef = useRef(0);

  // Each start or stop takes a new request id. A start that resolves (or fails)
  // after a newer request ignores itself, so a slow permission prompt can never
  // override what the user did meanwhile.
  const requestRef = useRef(0);
  const [voicePending, setVoicePending] = useState<VoiceSource | null>(null);

  const stopVoice = useCallback(() => {
    requestRef.current++;
    analyserRef.current?.stop();
    setVoiceSource(null);
    setVoiceFile(null);
    setVoicePending(null);
  }, []);

  const handleSpeak = useCallback((text: string) => {
    stopVoice();
    setVoiceError(null);
    const ok = speak(text, {
      onStart: () => setSpeaking(true),
      onBoundary: () => {
        pulseRef.current = 0.6;
      },
      onEnd: () => setSpeaking(false),
    });
    if (!ok) setSpeaking(false);
  }, [stopVoice]);

  const handleStop = useCallback(() => {
    cancelSpeech();
    setSpeaking(false);
  }, []);

  /** Common start: cancel speech and any current source, then mark pending. */
  const beginRequest = (source: VoiceSource): { req: number; a: VoiceAnalyser } => {
    const req = ++requestRef.current;
    cancelSpeech();
    setSpeaking(false);
    setVoiceError(null);
    setVoiceSource(null);
    setVoiceFile(null);
    setVoicePending(source);
    return { req, a: (analyserRef.current ??= new VoiceAnalyser()) };
  };

  const startMic = useCallback(async () => {
    const { req, a } = beginRequest('mic');
    try {
      await a.startMic();
      if (req !== requestRef.current) return;
      setVoiceSource('mic');
    } catch (err) {
      if (req !== requestRef.current) return; // superseded: the newer request owns the UI
      a.stop();
      setVoiceError(`Microphone unavailable. ${describeError(err)}`);
    } finally {
      if (req === requestRef.current) setVoicePending(null);
    }
  }, []);

  const startFile = useCallback(async (file: File) => {
    const { req, a } = beginRequest('file');
    try {
      await a.startFile(file, () => {
        if (req !== requestRef.current) return;
        setVoiceSource(null);
        setVoiceFile(null);
      });
      if (req !== requestRef.current) return;
      setVoiceFile(file.name);
      setVoiceSource('file');
    } catch (err) {
      if (req !== requestRef.current) return;
      a.stop();
      setVoiceError(`Could not play ${file.name}. ${describeError(err)}`);
    } finally {
      if (req === requestRef.current) setVoicePending(null);
    }
  }, []);

  useEffect(
    () => () => {
      cancelSpeech();
      analyserRef.current
        ?.dispose()
        .catch((err: unknown) => console.error('[App] audio context close failed:', err));
    },
    [],
  );

  // Shaping state. Waves off + fill on while dialing in the face.
  const [wavesOn, setWavesOn] = useState(false);
  const [fillOn, setFillOn] = useState(true);
  const [hiddenRegions, setHiddenRegions] = useState<ReadonlySet<string>>(new Set());

  // Morph control: the orb is the rest state; `forming` morphs it into the face.
  // scrub = null follows `forming`; a number 0..1 is a manual scrub override.
  const [forming, setForming] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);

  const toggleForm = useCallback(() => {
    setScrub(null); // release any manual scrub and animate to the new target
    setForming((f) => !f);
  }, []);

  // View switch: Orb returns to the resting orb; Face forms the face. Both run
  // the same reversible morph, so switching mid-morph reverses smoothly.
  const [view, setView] = useState<View>('orb');
  const [faceGeometry, setFaceGeometry] = useState<ParticleGeometry | null>(null);
  const [faceStatus, setFaceStatus] = useState('Checking for local face assets…');
  useEffect(() => {
    const request = new AbortController();
    loadFlameGeometry(request.signal).then((geometry) => {
      if (request.signal.aborted) return;
      setFaceGeometry(geometry);
      setFaceStatus(geometry ? '' : 'Face mode needs local FLAME assets. Orb mode is ready.');
    }).catch((error: unknown) => {
      if (request.signal.aborted) return;
      console.warn('[Nous] Could not load face assets:', error);
      setFaceStatus('Face assets could not be loaded. Orb mode is ready.');
    });
    return () => request.abort();
  }, []);

  const changeView = useCallback((v: View) => {
    if (v === 'face' && !faceGeometry) return;
    setView(v);
    setScrub(null);
    setForming(v === 'face');
  }, [faceGeometry]);

  const toggleRegion = useCallback((region: string) => {
    setHiddenRegions((prev) => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  }, []);

  // Amplitude: a live voice source drives it from the audio (loudness plus
  // syllable onsets); otherwise speech adds a pulse per word boundary that decays
  // between words; at rest it breathes (a slow sine).
  useEffect(() => {
    let raf = 0;
    let start = 0;
    let last = 0;
    const tick = (t: number): void => {
      if (start === 0) start = last = t;
      const elapsed = (t - start) / 1000;
      const dt = (t - last) / 1000;
      last = t;
      const analyser = analyserRef.current;
      const f = analyser ? analyser.read(dt) : SILENT_FEATURES;
      Object.assign(voiceRef.current, f);
      let target: number;
      let flowTarget: number;
      let ring: number; // what enters the centre of the orb this moment
      let ringBright: number;
      if (analyser?.active) {
        pulseRef.current = 0;
        target = 0.12 + f.level * 0.3;
        flowTarget = f.level;
        ring = Math.min(1.2, f.level * 0.8 + f.onset * 0.4);
        ringBright = f.brightness;
      } else if (speakingRef.current) {
        pulseRef.current *= Math.exp(-dt * 6);
        target = 0.25;
        flowTarget = 0.5;
        ring = pulseRef.current;
        ringBright = 0.3 * pulseRef.current;
      } else {
        pulseRef.current = 0;
        target = 0.09 + 0.09 * Math.sin(elapsed * (Math.PI / 4));
        flowTarget = 0;
        ring = 0;
        ringBright = 0;
      }
      // Feed the ring history at a fixed rate, so rings travel at the same speed
      // whatever the frame rate.
      waveClockRef.current += Math.min(dt, 0.25);
      while (waveClockRef.current >= 1 / WAVE_RATE) {
        waveClockRef.current -= 1 / WAVE_RATE;
        pushVoiceWave(waveRef.current, ring, ringBright);
      }
      // The swell follows its target through a soft, slightly underdamped spring,
      // so syllables roll through the orb instead of popping it. Substeps keep the
      // spring stable on slow frames.
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = Math.min(dt, 0.1) / steps;
      for (let i = 0; i < steps; i++) {
        const accel =
          SWELL_STIFFNESS * (target - amplitudeRef.current) - SWELL_DAMPING * swellVelRef.current;
        swellVelRef.current += accel * h;
        amplitudeRef.current += swellVelRef.current * h;
      }
      // Flow: how fast the surface pattern travels. Eased, never stepped.
      flowRef.current += (flowTarget - flowRef.current) * (1 - Math.exp(-dt * 2.5));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a0a' }}>
      <ReactorCanvas>
        <FaceParticles
          faceGeometry={faceGeometry}
          amplitudeRef={amplitudeRef}
          flowRef={flowRef}
          waveRef={waveRef}
          orbStateRef={orbStateRef}
          voiceRef={voiceRef}
          wavesOn={wavesOn}
          fillOn={fillOn}
          hiddenRegions={hiddenRegions}
          forming={forming}
          scrub={scrub}
        />
        {/* Drag to spin; scroll to zoom. Pan disabled so the face stays centered. */}
        <OrbitControls
          makeDefault
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.9}
          minDistance={1.6}
          maxDistance={8}
        />
      </ReactorCanvas>

      <ControlPanel
        view={view}
        onView={changeView}
        faceAvailable={faceGeometry !== null}
        faceStatus={faceStatus}
        micSupported={micSupported}
        voiceSource={voiceSource}
        voiceFile={voiceFile}
        voiceError={voiceError}
        voicePending={voicePending}
        onStartMic={startMic}
        onStartFile={startFile}
        onStopVoice={stopVoice}
        wavesOn={wavesOn}
        onWaves={setWavesOn}
        fillOn={fillOn}
        onFill={setFillOn}
        forming={forming}
        scrub={scrub}
        onScrub={setScrub}
        onToggleForm={toggleForm}
        hiddenRegions={hiddenRegions}
        onToggleRegion={toggleRegion}
        localVoiceAvailable={localVoiceAvailable}
        speaking={speaking}
        onSpeak={handleSpeak}
        onStopSpeech={handleStop}
        orbState={orbState}
        previewState={previewState}
        onPreviewState={setPreviewState}
      />
    </div>
  );
}
