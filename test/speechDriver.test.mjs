import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cancelSpeech, hasLocalVoice, speak, subscribeToVoices } from '../src/face/speechDriver.ts';

const local = { name: 'synthetic-local-voice', lang: 'en-US', localService: true };
const remote = { name: 'synthetic-remote-voice', lang: 'en-GB', localService: false };
const text = 'Synthetic speech test. No real data.';
const noHandlers = { onStart() {}, onBoundary() {}, onEnd() {} };

function installSpeechFixture(t, voices) {
  const synth = new EventTarget();
  const submitted = [];
  synth.getVoices = () => voices;
  synth.cancel = () => {};
  synth.speak = (utterance) => submitted.push(utterance);
  globalThis.window = { speechSynthesis: synth };
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
      this.voice = null;
    }
  };
  t.after(() => {
    delete globalThis.window;
    delete globalThis.SpeechSynthesisUtterance;
  });
  return { submitted, synth };
}

test('empty and remote-only voice inventories never submit an utterance', (t) => {
  const voices = [];
  const { submitted } = installSpeechFixture(t, voices);
  for (const voice of [null, remote, { ...remote, localService: undefined }]) {
    if (voice) voices.splice(0, voices.length, voice);
    assert.equal(hasLocalVoice(), false);
    assert.equal(speak(text, noHandlers), false);
    assert.equal(submitted.length, 0);
  }
});

test('every sentence receives an explicit local voice and cancellation suppresses stale events', (t) => {
  const { submitted } = installSpeechFixture(t, [remote, local]);
  const events = [];
  assert.equal(hasLocalVoice(), true);
  assert.equal(speak(text, {
    onStart: () => events.push('start'),
    onBoundary: () => events.push('boundary'),
    onEnd: () => events.push('end'),
  }), true);
  assert.equal(submitted.length, 2);
  for (const utterance of submitted) assert.equal(utterance.voice, local);
  submitted[0].onstart();
  submitted[0].onboundary();
  cancelSpeech();
  submitted[1].onend();
  assert.deepEqual(events, ['start', 'boundary', 'boundary']);
});

test('a delayed local voice inventory updates subscribers and can be unsubscribed', (t) => {
  const voices = [remote];
  const { synth, submitted } = installSpeechFixture(t, voices);
  const availability = [];
  const unsubscribe = subscribeToVoices(() => availability.push(hasLocalVoice()));
  voices.push({ ...local, lang: 'fr-FR' });
  synth.dispatchEvent(new Event('voiceschanged'));
  assert.equal(speak(text, noHandlers), true);
  assert.equal(submitted[0].voice, voices[1]);
  unsubscribe();
  voices.pop();
  synth.dispatchEvent(new Event('voiceschanged'));
  assert.deepEqual(availability, [true]);
  assert.equal(speak(text, noHandlers), false);
  assert.equal(submitted.length, 2);
});
