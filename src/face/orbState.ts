/**
 * Orb states and their tints.
 *
 * The state tints the particle palette toward a warm hue. Idle has no tint, so
 * the resting look is the original blood orange. Listening is set while the
 * microphone feeds the voice analyser; speaking during narration playback or
 * browser speech. Thinking has no live producer yet (no host); the HUD can
 * preview it.
 */

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

export const ORB_STATES: readonly OrbState[] = ['idle', 'listening', 'thinking', 'speaking'];

/** Linear RGB tint and how far (0..1) the palette moves toward it. */
export const ORB_TINTS: Record<OrbState, { color: [number, number, number]; mix: number }> = {
  idle: { color: [0.76, 0.24, 0.04], mix: 0 },
  listening: { color: [1.0, 0.62, 0.16], mix: 0.45 }, // amber-gold
  thinking: { color: [0.4, 0.04, 0.01], mix: 0.6 }, // deep ember
  // Kept modest: the speech pulse already brightens points via displacement.
  speaking: { color: [1.0, 0.55, 0.22], mix: 0.3 }, // hot orange
};
