/**
 * Voice history for the orb's outward rings.
 *
 * App pushes one sample per 1/WAVE_RATE s (newest at index 0); FaceParticles
 * uploads both arrays as shader uniforms. A point on the orb reads the sample
 * matching its angular distance from the point facing the viewer, so sound
 * entering at the centre reaches the silhouette after about half the history
 * and the far pole after all of it.
 */

export const WAVE_SAMPLES = 64;
/** Samples per second: 64 samples at 60 Hz is about 1.07 s from centre to far pole. */
export const WAVE_RATE = 60;

export interface VoiceWave {
  /** Ring strength, newest first. */
  level: Float32Array;
  /** Ring brightness (crisp consonants), newest first. */
  bright: Float32Array;
}

export function createVoiceWave(): VoiceWave {
  return { level: new Float32Array(WAVE_SAMPLES), bright: new Float32Array(WAVE_SAMPLES) };
}

/** Shift the history one step older and put the new sample at the centre. */
export function pushVoiceWave(w: VoiceWave, level: number, bright: number): void {
  w.level.copyWithin(1, 0, WAVE_SAMPLES - 1);
  w.bright.copyWithin(1, 0, WAVE_SAMPLES - 1);
  w.level[0] = level;
  w.bright[0] = bright;
}
