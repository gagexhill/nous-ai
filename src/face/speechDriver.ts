/**
 * Speak through a local browser voice and report events so the orb can pulse.
 */

export interface SpeechHandlers {
  onStart: () => void;
  onBoundary: () => void;
  onEnd: () => void;
}

// Each speak() call gets a generation; callbacks from a cancelled run are ignored.
let generation = 0;

function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function hasLocalVoice(): boolean {
  return pickVoice() !== undefined;
}

export function subscribeToVoices(change: () => void): () => void {
  if (!speechSupported()) return () => {};
  const synth = window.speechSynthesis;
  synth.addEventListener('voiceschanged', change);
  return () => synth.removeEventListener('voiceschanged', change);
}

/**
 * Split into sentences, guarding common abbreviations so "Dr. Smith" stays whole.
 * Short utterances also avoid Chrome cutting off long ones mid-sentence.
 */
export function splitSentences(text: string): string[] {
  const clean = text.replace(/[*_#`~]/g, '').trim();
  if (!clean) return [];
  const mark = '\x01';
  const abbrev =
    /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|approx|est|vol|no|pp|p|fig|ref|dept|govt|Dept|Govt|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\./g;
  const guarded = clean.replace(abbrev, (_, a: string) => a + mark);
  return guarded
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map((s) => s.replace(new RegExp(mark, 'g'), '.').trim())
    .filter((s) => s.length > 0);
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  if (!speechSupported()) return undefined;
  const voices = window.speechSynthesis.getVoices().filter((voice) => voice.localService === true);
  return voices.find((voice) => /^en[-_](GB|UK)$/i.test(voice.lang))
    ?? voices.find((voice) => /^en(?:[-_]|$)/i.test(voice.lang))
    ?? voices[0];
}

export function cancelSpeech(): void {
  generation++;
  if (speechSupported()) window.speechSynthesis.cancel();
}

/** Speak text; returns false when nothing could be spoken. */
export function speak(text: string, handlers: SpeechHandlers): boolean {
  const voice = pickVoice();
  if (!voice) return false;
  const sentences = splitSentences(text);
  if (!sentences.length) return false;

  cancelSpeech();
  const gen = generation;
  const live = (): boolean => gen === generation;
  let started = false;
  let ended = false;
  const finish = (): void => {
    if (!live() || ended) return;
    ended = true;
    handlers.onEnd();
  };

  sentences.forEach((sentence, i) => {
    const u = new SpeechSynthesisUtterance(sentence);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 1.0;
    u.pitch = 0.95;
    u.onstart = () => {
      if (!live()) return;
      if (!started) {
        started = true;
        handlers.onStart();
      }
      handlers.onBoundary();
    };
    u.onboundary = () => {
      if (live()) handlers.onBoundary();
    };
    u.onerror = finish;
    if (i === sentences.length - 1) u.onend = finish;
    window.speechSynthesis.speak(u);
  });
  return true;
}
