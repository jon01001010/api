/**
 * Decides when the user has finished speaking, from the loudness of the
 * incoming audio (16-bit mono PCM). No model needed:
 * - learns the background noise level in the first moments,
 * - waits for speech (louder than the background),
 * - stops after a pause in speech, or when nothing was said, or at a cap.
 */
export interface EndpointerOptions {
  sampleRate?: number;
  /** Pause after speech that ends the turn. */
  silenceMs?: number;
  /** Give up when no speech starts within this time. */
  noSpeechMs?: number;
  /** Hard cap on one utterance. */
  maxMs?: number;
  /** Minimum speech before a pause counts as the end. */
  minSpeechMs?: number;
  /** Lowest loudness (0–1 RMS) that counts as speech. */
  minLevel?: number;
}

export type EndpointState = 'waiting' | 'speaking' | 'done' | 'no-speech';

export interface Endpointer {
  /** Feed samples; returns the state after them. */
  push(samples: Int16Array): EndpointState;
  /** Latest loudness, 0–1, for a level meter. */
  readonly level: number;
}

export function rms(samples: Int16Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

export function createEndpointer(options: EndpointerOptions = {}): Endpointer {
  const {
    sampleRate = 16000,
    silenceMs = 1200,
    noSpeechMs = 8000,
    maxMs = 30000,
    minSpeechMs = 250,
    minLevel = 0.012,
  } = options;
  const calibrationMs = 300;
  let elapsedMs = 0;
  let noiseSum = 0;
  let noiseCount = 0;
  let speechMs = 0;
  let silentMs = 0;
  let state: EndpointState = 'waiting';
  let level = 0;

  return {
    get level() {
      return level;
    },
    push(samples: Int16Array) {
      if (state === 'done' || state === 'no-speech') {
        return state;
      }
      const ms = (samples.length / sampleRate) * 1000;
      elapsedMs += ms;
      level = rms(samples);
      if (elapsedMs <= calibrationMs) {
        noiseSum += level;
        noiseCount++;
      }
      const noise = noiseCount ? noiseSum / noiseCount : 0;
      // Capped so speech heard while calibrating (talking right after the
      // tap) doesn't raise the bar above normal speech.
      const threshold = Math.max(minLevel, Math.min(noise * 2.5, 0.08));
      const loud = level >= threshold;

      if (loud) {
        speechMs += ms;
        silentMs = 0;
        if (speechMs >= minSpeechMs) {
          state = 'speaking';
        }
      } else if (state === 'speaking') {
        silentMs += ms;
        if (silentMs >= silenceMs) {
          state = 'done';
        }
      }
      if (state === 'waiting' && elapsedMs >= noSpeechMs) {
        state = 'no-speech';
      }
      if (elapsedMs >= maxMs) {
        state = state === 'speaking' ? 'done' : 'no-speech';
      }
      return state;
    },
  };
}
