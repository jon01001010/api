/**
 * LoRA adapters: small .gguf files that change a model's style without
 * changing the model file (the first part of "daily personal training").
 *
 * Each adapter belongs to one model and lives in the app's own folder
 * (`Documents/models/lora`), added through the same file import as models.
 * Per model, at most one adapter is active, with a strength (0–1). "Off" goes
 * back to the plain model; keeping several dated adapters makes switching
 * back an instant rollback. Running them: src/services/lora.
 */
import {makeAutoObservable, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as RNFS from '@dr.pogodin/react-native-fs';

export interface LoraAdapter {
  id: string;
  /** Shown to the user ("my-style"): the file name without `.gguf`. */
  name: string;
  /** The file in the adapters folder (a name, never a path). */
  fileName: string;
  size: number;
  /** When it was added (ISO time), so dated versions can be told apart. */
  addedAt: string;
  /** The model it belongs to. */
  modelId: string;
  /** Read from the file when the phone can (`general.architecture`). */
  architecture?: string;
}

export interface LoraChoice {
  adapterId: string;
  /** Strength, 0–1. */
  scale: number;
}

/** What a model runs with: the adapter's real file and its strength. */
export interface ActiveLora {
  adapter: LoraAdapter;
  path: string;
  scale: number;
}

/** The app's own folder for adapters (phone and desktop alike). */
export const loraDir = (): string =>
  `${RNFS.DocumentDirectoryPath}/models/lora`;

/** Strength kept between 0 and 1 (1 when missing or broken). */
export const clampScale = (scale: unknown): number => {
  const n = typeof scale === 'number' && Number.isFinite(scale) ? scale : 1;
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
};

/** A plain file name: no folders, no `..`, a .gguf ending. */
export const isPlainAdapterName = (fileName: string): boolean =>
  /^[^/\\:,"]+\.gguf$/i.test(fileName) &&
  ![...fileName].some(c => c.charCodeAt(0) < 0x20) &&
  !fileName.startsWith('.');

/** "+ my-style (0.8)" for a choice, or '' for none. */
export const loraLabel = (active?: {
  adapter: {name: string};
  scale: number;
}): string =>
  active ? `+ ${active.adapter.name} (${clampScale(active.scale)})` : '';

export class LoraStore {
  adapters: LoraAdapter[] = [];
  /** Model id → its active adapter. No entry: Off. */
  choices: Record<string, LoraChoice> = {};
  /**
   * Desktop: the model file a "This PC" model runs → the model's id here, so
   * the adapter chosen for the model follows it there.
   */
  pcModels: Record<string, string> = {};
  /** The last adapter problem per model (not kept across starts). */
  problems: Record<string, string> = {};

  constructor() {
    makeAutoObservable(this);
    makePersistable(this, {
      name: 'LoraStore',
      properties: ['adapters', 'choices', 'pcModels'],
      storage: AsyncStorage,
    }).catch(() => {});
  }

  /** A model's adapters, newest first. */
  adaptersFor(modelId: string): LoraAdapter[] {
    return this.adapters
      .filter(a => a.modelId === modelId)
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  pathOf(adapter: LoraAdapter): string {
    return `${loraDir()}/${adapter.fileName}`;
  }

  /** The adapter a model runs with, or undefined for Off. */
  activeFor(modelId: string | undefined): ActiveLora | undefined {
    if (!modelId) {
      return undefined;
    }
    const choice = this.choices[modelId];
    const adapter =
      choice && this.adapters.find(a => a.id === choice.adapterId);
    if (
      !choice ||
      !adapter ||
      adapter.modelId !== modelId ||
      !isPlainAdapterName(adapter.fileName)
    ) {
      return undefined;
    }
    return {
      adapter,
      path: this.pathOf(adapter),
      scale: clampScale(choice.scale),
    };
  }

  /** Choose a model's adapter (null: Off). Returns false if it isn't its own. */
  setChoice(modelId: string, adapterId: string | null, scale?: number) {
    if (adapterId === null) {
      delete this.choices[modelId];
      delete this.problems[modelId];
      return true;
    }
    const adapter = this.adapters.find(a => a.id === adapterId);
    if (!adapter || adapter.modelId !== modelId) {
      return false;
    }
    const before = this.choices[modelId];
    this.choices[modelId] = {
      adapterId,
      scale: clampScale(scale ?? before?.scale ?? 1),
    };
    delete this.problems[modelId];
    return true;
  }

  setProblem(modelId: string, problem?: string) {
    if (problem) {
      this.problems[modelId] = problem;
    } else {
      delete this.problems[modelId];
    }
  }

  add(adapter: LoraAdapter) {
    if (!isPlainAdapterName(adapter.fileName)) {
      throw new Error('Not an adapter file name');
    }
    this.adapters = [
      ...this.adapters.filter(a => a.fileName !== adapter.fileName),
      adapter,
    ];
  }

  /** Forget an adapter (its choice too). The caller removes the file. */
  forget(adapterId: string) {
    this.adapters = this.adapters.filter(a => a.id !== adapterId);
    for (const [modelId, choice] of Object.entries(this.choices)) {
      if (choice.adapterId === adapterId) {
        delete this.choices[modelId];
      }
    }
  }

  /** Desktop: remember which model a "This PC" model file is. */
  rememberPcModel(modelPath: string, modelId: string) {
    if (this.pcModels[modelPath] !== modelId) {
      runInAction(() => {
        this.pcModels[modelPath] = modelId;
      });
    }
  }

  /** Desktop: the adapter for a "This PC" model file, if one is chosen. */
  activeForPcModel(modelPath: string): ActiveLora | undefined {
    return this.activeFor(this.pcModels[modelPath]);
  }
}

export const loraStore = new LoraStore();
