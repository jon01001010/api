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

export interface SegmenterOptions {
  sampleRate?: number;
  /** Pause that ends an utterance. */
  silenceMs?: number;
  /** Shorter sounds (clicks, bumps) are ignored. */
  minSpeechMs?: number;
  /** Longest utterance kept; longer ones are cut here. */
  maxMs?: number;
  /** Audio kept from just before speech starts, so the first word isn't clipped. */
  preRollMs?: number;
  minLevel?: number;
}

/**
 * Continuous version of the endpointer for always-on listening: cuts the
 * stream into utterances (speech followed by a pause) and hands each one
 * over as 16-bit PCM bytes. The background level adapts slowly while
 * nobody is speaking.
 */
export function createSegmenter(
  onUtterance: (audio: Uint8Array) => void,
  options: SegmenterOptions = {},
) {
  const {
    sampleRate = 16000,
    silenceMs = 700,
    minSpeechMs = 300,
    maxMs = 8000,
    preRollMs = 400,
    minLevel = 0.012,
  } = options;
  let noise = minLevel / 2.5;
  let preRoll: Uint8Array[] = [];
  let preRollMsNow = 0;
  let current: Uint8Array[] | null = null;
  let speechMs = 0;
  let silentMs = 0;
  let totalMs = 0;
  let level = 0;

  const flush = () => {
    const chunks = current;
    const enough = speechMs >= minSpeechMs;
    current = null;
    speechMs = 0;
    silentMs = 0;
    totalMs = 0;
    if (!chunks || !enough) {
      return;
    }
    const size = chunks.reduce((n, c) => n + c.length, 0);
    const audio = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      audio.set(c, at);
      at += c.length;
    }
    onUtterance(audio);
  };

  return {
    get level() {
      return level;
    },
    /** Feed one chunk of 16-bit PCM bytes. */
    push(bytes: Uint8Array) {
      const samples = new Int16Array(
        bytes.buffer,
        bytes.byteOffset,
        Math.floor(bytes.length / 2),
      );
      const ms = (samples.length / sampleRate) * 1000;
      level = rms(samples);
      // Background level: follows quieter sounds quickly and louder ones
      // slowly, so a steady fan or traffic becomes "background" within
      // seconds while normal speech stays above it.
      noise += (level - noise) * (level < noise ? 0.3 : 0.02);
      const threshold = Math.max(minLevel, Math.min(noise * 2.5, 0.08));
      const loud = level >= threshold;

      if (!current) {
        if (loud) {
          current = [...preRoll, bytes];
          preRoll = [];
          preRollMsNow = 0;
          speechMs = ms;
          totalMs = ms;
        } else {
          preRoll.push(bytes);
          preRollMsNow += ms;
          while (preRollMsNow > preRollMs && preRoll.length > 1) {
            const dropped = preRoll.shift()!;
            preRollMsNow -= (dropped.length / 2 / sampleRate) * 1000;
          }
        }
        return;
      }
      current.push(bytes);
      totalMs += ms;
      if (loud) {
        speechMs += ms;
        silentMs = 0;
      } else {
        silentMs += ms;
      }
      if (silentMs >= silenceMs || totalMs >= maxMs) {
        flush();
      }
    },
    /** Drop anything half-heard (e.g. when pausing). */
    reset() {
      current = null;
      preRoll = [];
      preRollMsNow = 0;
      speechMs = 0;
      silentMs = 0;
      totalMs = 0;
    },
  };
}
