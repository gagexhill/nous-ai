/**
 * ControlPanel — minimal dependency-free HUD.
 *
 * An Orb/Face switch picks the view. Voice controls (microphone, narration file,
 * typed speech) and the state preview apply to both views. The Face view adds
 * the morph button and scrub, the displacement waves and solid (occluding) fill
 * toggles, and non-destructive FLAME region hiding. Sits above the canvas with
 * its own pointer events so it doesn't fight OrbitControls.
 */

import { useRef, useState } from 'react';
import { FLAME_REGIONS, ALWAYS_HIDDEN_REGIONS } from '../../face/flameMesh';
import { ORB_STATES, type OrbState } from '../../face/orbState';
import type { VoiceSource } from '../../face/voiceAnalyser';

// Hideable regions = all FLAME regions minus the ones that are always hidden
// (internal eyeball geometry the user never needs to toggle).
/** The two views: the voice-reactive orb, or the face it forms into. */
export type View = 'orb' | 'face';

const HIDEABLE_REGIONS = FLAME_REGIONS.filter(
  (r) => !(ALWAYS_HIDDEN_REGIONS as readonly string[]).includes(r),
);

interface ControlPanelProps {
  view: View;
  onView: (v: View) => void;
  faceAvailable: boolean;
  faceStatus: string;
  micSupported: boolean;
  /** Live voice source feeding the analyser, or null. */
  voiceSource: VoiceSource | null;
  voiceFile: string | null;
  voiceError: string | null;
  /** A source that is starting (e.g. waiting on the microphone prompt), or null. */
  voicePending: VoiceSource | null;
  onStartMic: () => void;
  onStartFile: (file: File) => void;
  onStopVoice: () => void;
  wavesOn: boolean;
  onWaves: (v: boolean) => void;
  fillOn: boolean;
  onFill: (v: boolean) => void;
  forming: boolean;
  scrub: number | null;
  onScrub: (v: number) => void;
  onToggleForm: () => void;
  hiddenRegions: ReadonlySet<string>;
  onToggleRegion: (region: string) => void;
  localVoiceAvailable: boolean;
  speaking: boolean;
  onSpeak: (text: string) => void;
  onStopSpeech: () => void;
  /** Effective state (live voice or speech overrides the preview). */
  orbState: OrbState;
  previewState: OrbState;
  onPreviewState: (s: OrbState) => void;
}

const button: React.CSSProperties = {
  width: '100%',
  minHeight: 48,
  padding: '5px 8px',
  marginBottom: 6,
  background: 'rgba(193, 61, 10, 0.25)',
  border: '1px solid rgba(193, 61, 10, 0.6)',
  borderRadius: 5,
  color: '#f0d8c8',
  font: 'inherit',
  cursor: 'pointer',
};

const field: React.CSSProperties = {
  width: '100%',
  minHeight: 48,
  boxSizing: 'border-box',
  marginBottom: 6,
  padding: '4px 6px',
  background: 'rgba(0, 0, 0, 0.35)',
  border: '1px solid rgba(193, 61, 10, 0.45)',
  borderRadius: 5,
  color: '#f0d8c8',
  font: 'inherit',
  userSelect: 'text',
};

const panel: React.CSSProperties = {
  position: 'fixed',
  top: 16,
  left: 16,
  zIndex: 10,
  width: 210,
  maxWidth: 'calc(100% - 32px)',
  padding: '12px 14px',
  background: 'rgba(20, 12, 8, 0.82)',
  border: '1px solid rgba(193, 61, 10, 0.45)',
  borderRadius: 8,
  color: '#f0d8c8',
  font: '12px/1.5 system-ui, sans-serif',
  backdropFilter: 'blur(4px)',
  pointerEvents: 'auto',
  userSelect: 'none',
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  boxSizing: 'border-box',
};

const heading: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  color: '#cab3a7',
  margin: '10px 0 4px',
};

const note: React.CSSProperties = { fontSize: 11, color: '#cab3a7' };

function Row({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 48, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function ViewSwitch({
  view,
  onView,
  faceAvailable,
}: {
  view: View;
  onView: (v: View) => void;
  faceAvailable: boolean;
}): React.ReactElement {
  const opt = (v: View, label: string): React.ReactElement => (
    <button
      type="button"
      aria-pressed={view === v}
      disabled={v === 'face' && !faceAvailable}
      onClick={() => onView(v)}
      style={{
        ...button,
        marginBottom: 0,
        background: view === v ? 'rgba(193, 61, 10, 0.7)' : 'rgba(193, 61, 10, 0.15)',
        fontWeight: view === v ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="View" style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      {opt('orb', 'Orb')}
      {opt('face', 'Face')}
    </div>
  );
}

export function ControlPanel({
  view,
  onView,
  faceAvailable,
  faceStatus,
  micSupported,
  voiceSource,
  voiceFile,
  voiceError,
  voicePending,
  onStartMic,
  onStartFile,
  onStopVoice,
  wavesOn,
  onWaves,
  fillOn,
  onFill,
  forming,
  scrub,
  onScrub,
  onToggleForm,
  hiddenRegions,
  onToggleRegion,
  localVoiceAvailable,
  speaking,
  onSpeak,
  onStopSpeech,
  orbState,
  previewState,
  onPreviewState,
}: ControlPanelProps): React.ReactElement {
  const scrubPct = scrub === null ? (forming ? 100 : 0) : Math.round(scrub * 100);
  const [speechText, setSpeechText] = useState('Hello. I am Nous.');
  const fileInput = useRef<HTMLInputElement>(null);
  const live = voiceSource !== null || voicePending !== null || speaking;
  // While a source is starting or running, its button cancels or stops it.
  const micBusy = voiceSource === 'mic' || voicePending === 'mic';
  const fileBusy = voiceSource === 'file' || voicePending === 'file';
  const micLabel =
    voicePending === 'mic'
      ? '… Waiting for permission (cancel)'
      : voiceSource === 'mic'
        ? '■ Stop microphone'
        : '🎙 Microphone';
  const fileLabel =
    voicePending === 'file'
      ? '… Starting (cancel)'
      : voiceSource === 'file'
        ? '■ Stop narration'
        : '📂 Play narration file';

  return (
    <aside aria-label="Viewer controls" style={panel}>
      <h1 style={{ fontWeight: 600, fontSize: 16, margin: 0 }}>Nous</h1>
      <ViewSwitch view={view} onView={onView} faceAvailable={faceAvailable} />
      <p role="status" style={{ ...note, margin: faceStatus ? '6px 0' : 0 }}>{faceStatus}</p>

      {view === 'face' && (
        <>
          <h2 style={heading}>Form (orb ⇄ face)</h2>
          <button type="button" onClick={onToggleForm} style={button}>
            {forming ? '● Return to orb' : '▶ Form face'}
          </button>
          <input
            type="range"
            aria-label="Morph scrub"
            min={0}
            max={100}
            value={scrubPct}
            onChange={(e) => onScrub(Number(e.target.value) / 100)}
            style={{ width: '100%', minHeight: 48 }}
          />
          <div style={note}>
            {scrub === null ? (forming ? 'face' : 'orb (living)') : `${scrubPct}% → face`}
          </div>
        </>
      )}

      <h2 style={heading}>Listen</h2>
      <button
        type="button"
        onClick={() => (micBusy ? onStopVoice() : onStartMic())}
        disabled={!micSupported}
        style={{ ...button, opacity: micSupported ? 1 : 0.4 }}
      >
        {micLabel}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="audio/*"
        aria-label="Narration audio file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // allow picking the same file again
          if (file) onStartFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => (fileBusy ? onStopVoice() : fileInput.current?.click())}
        style={button}
      >
        {fileLabel}
      </button>
      {voiceFile && (
        <div style={{ ...note, overflowWrap: 'anywhere' }} title={voiceFile}>
          playing: {voiceFile}
        </div>
      )}
      {voiceError && (
        <div role="alert" style={{ fontSize: 10, color: '#ffb08a' }}>
          {voiceError}
        </div>
      )}

      <h2 style={heading}>Speak</h2>
      <textarea
        aria-label="Text to speak"
        value={speechText}
        onChange={(e) => setSpeechText(e.target.value)}
        rows={2}
        disabled={!localVoiceAvailable}
        style={{ ...field, resize: 'vertical' }}
      />
      <button
        type="button"
        onClick={() => (speaking ? onStopSpeech() : onSpeak(speechText))}
        disabled={!speaking && (!localVoiceAvailable || !speechText.trim())}
        style={button}
      >
        {speaking ? '■ Stop' : '🔊 Speak'}
      </button>
      <div role="status" style={note}>
        {!localVoiceAvailable && 'No local speech voice is available in this browser.'}
      </div>

      <h2 style={heading}>State</h2>
      <select
        aria-label="Orb state preview"
        value={previewState}
        onChange={(e) => onPreviewState(e.target.value as OrbState)}
        disabled={live}
        style={field}
      >
        {ORB_STATES.filter((s) => s !== 'speaking').map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <div style={note} data-testid="orb-state">
        now: {orbState}
      </div>

      {view === 'face' && (
        <>
          <h2 style={heading}>Surface</h2>
          <Row label="Displacement waves" checked={wavesOn} onChange={onWaves} />
          <Row label="Solid fill (opaque)" checked={fillOn} onChange={onFill} />

          <h2 style={heading}>Hide regions</h2>
          {HIDEABLE_REGIONS.map((r) => (
            <Row
              key={r}
              label={r.replace(/_/g, ' ')}
              checked={hiddenRegions.has(r)}
              onChange={() => onToggleRegion(r)}
            />
          ))}
        </>
      )}
    </aside>
  );
}
