/**
 * The real speed of each model on this device (words per second while it
 * writes, from the runner's own timings), remembered after the first
 * replies and shown next to the model ("Find the fit"). Kept on this device
 * only: a model's speed on the phone says nothing about the PC.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {makeAutoObservable, runInAction} from 'mobx';

import type {CompletionTimings} from './completionTypes';

const KEY = '@pocketagent/model-speed/v1';
/** Shorter replies say little about speed. */
export const MIN_TOKENS = 16;
/** The average follows the latest replies (drivers, settings change). */
const MAX_WEIGHT = 10;

export interface ModelSpeed {
  /** Tokens per second while writing. */
  tokensPerSecond: number;
  replies: number;
}

/** The new average after one more reply, or null if it doesn't count. */
export function nextSpeed(
  before: ModelSpeed | undefined,
  timings: CompletionTimings | undefined,
): ModelSpeed | null {
  const rate = timings?.predicted_per_second;
  const n = timings?.predicted_n ?? 0;
  if (!rate || !Number.isFinite(rate) || rate <= 0 || n < MIN_TOKENS) {
    return null;
  }
  if (!before) {
    return {tokensPerSecond: rate, replies: 1};
  }
  const weight = Math.min(before.replies, MAX_WEIGHT);
  return {
    tokensPerSecond: (before.tokensPerSecond * weight + rate) / (weight + 1),
    replies: before.replies + 1,
  };
}

/** "12 tokens/s", "3.4 tokens/s". */
export function formatSpeed(speed: ModelSpeed | undefined): string {
  if (!speed) {
    return '';
  }
  const v = speed.tokensPerSecond;
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} tokens/s`;
}

class ModelSpeedStore {
  speeds: Record<string, ModelSpeed> = {};
  private loaded: Promise<void> | null = null;

  constructor() {
    makeAutoObservable<ModelSpeedStore, 'loaded'>(this, {loaded: false});
  }

  load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = Promise.resolve()
        .then(() => AsyncStorage.getItem(KEY))
        .then(raw => {
          const saved = raw ? JSON.parse(raw) : null;
          if (saved && typeof saved === 'object') {
            runInAction(() => {
              this.speeds = {...saved, ...this.speeds};
            });
          }
        })
        .catch(() => {});
    }
    return this.loaded;
  }

  speedOf(modelId: string | undefined): ModelSpeed | undefined {
    return modelId ? this.speeds[modelId] : undefined;
  }

  async record(
    modelId: string | undefined,
    timings: CompletionTimings | undefined,
  ): Promise<void> {
    if (!modelId) {
      return;
    }
    await this.load();
    const next = nextSpeed(this.speeds[modelId], timings);
    if (!next) {
      return;
    }
    runInAction(() => {
      this.speeds = {...this.speeds, [modelId]: next};
    });
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(this.speeds));
    } catch {
      // Not saved this time; the next reply tries again.
    }
  }
}

export const modelSpeedStore = new ModelSpeedStore();
