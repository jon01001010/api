import {makeAutoObservable, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as RNFS from '@dr.pogodin/react-native-fs';

import {
  deleteWhisperModel,
  downloadWhisperModel,
  whisperModelId,
  whisperModelPath,
  type DownloadedWhisperModel,
  type WhisperModelRef,
} from '../services/voice/whisperModels';

export type VoiceInputState = 'idle' | 'listening' | 'transcribing';

/**
 * Voice input settings and live state: which Whisper model turns speech
 * into text, conversation mode, and whether the mic is listening.
 */
export class VoiceStore {
  /** Downloaded speech-to-text models. */
  models: DownloadedWhisperModel[] = [];
  /** Id (repo/file) of the model used for voice input. */
  selectedModelId: string | null = null;
  /** After a spoken answer, listen again for the next question. */
  conversationMode = false;
  /** Spoken language for Whisper ('auto' detects it). */
  language = 'auto';
  /** Listen for the wake phrase, also in the background. */
  wakeEnabled = false;
  wakePhrase = 'Hey Agent';

  state: VoiceInputState = 'idle';
  /** Mic loudness 0–1 while listening. */
  level = 0;
  /** Download progress 0–1 by model id. */
  downloads: Record<string, number> = {};
  isSheetOpen = false;
  /** Wake word: what the background listener is doing (not persisted). */
  wakeStatus: 'off' | 'listening' | 'paused' | 'error' = 'off';
  wakeError: string | null = null;
  /** What Whisper wrote down for the last utterance the wake word checked. */
  lastHeard: string | null = null;

  constructor() {
    makeAutoObservable(this, {}, {autoBind: true});
    makePersistable(this, {
      name: 'VoiceStore',
      properties: [
        'models',
        'selectedModelId',
        'conversationMode',
        'language',
        'wakeEnabled',
        'wakePhrase',
      ],
      storage: AsyncStorage,
    }).catch(() => {});
  }

  get selectedModel(): DownloadedWhisperModel | undefined {
    return (
      this.models.find(m => whisperModelId(m) === this.selectedModelId) ??
      this.models[0]
    );
  }

  openSheet() {
    this.isSheetOpen = true;
  }

  closeSheet() {
    this.isSheetOpen = false;
  }

  setState(state: VoiceInputState) {
    this.state = state;
    if (state !== 'listening') {
      this.level = 0;
    }
  }

  setLevel(level: number) {
    this.level = level;
  }

  setConversationMode(on: boolean) {
    this.conversationMode = on;
  }

  setWakeEnabled(on: boolean) {
    this.wakeEnabled = on;
  }

  setWakeStatus(status: VoiceStore['wakeStatus'], error: string | null = null) {
    this.wakeStatus = status;
    this.wakeError = error;
  }

  setLastHeard(text: string | null) {
    this.lastHeard = text;
  }

  setWakePhrase(phrase: string) {
    this.wakePhrase = phrase.trim() || 'Hey Agent';
  }

  setLanguage(language: string) {
    this.language = language;
  }

  selectModel(m: WhisperModelRef) {
    this.selectedModelId = whisperModelId(m);
  }

  isDownloaded(m: WhisperModelRef): boolean {
    return this.models.some(d => whisperModelId(d) === whisperModelId(m));
  }

  async download(m: WhisperModelRef, authToken?: string | null) {
    const id = whisperModelId(m);
    if (id in this.downloads) {
      return;
    }
    this.downloads = {...this.downloads, [id]: 0};
    try {
      const done = await downloadWhisperModel(
        m,
        fraction =>
          runInAction(() => {
            this.downloads = {...this.downloads, [id]: fraction};
          }),
        authToken,
      );
      runInAction(() => {
        this.models = [
          ...this.models.filter(d => whisperModelId(d) !== id),
          done,
        ];
        if (!this.selectedModelId) {
          this.selectedModelId = id;
        }
      });
    } finally {
      runInAction(() => {
        const rest = {...this.downloads};
        delete rest[id];
        this.downloads = rest;
      });
    }
  }

  async remove(m: WhisperModelRef) {
    await deleteWhisperModel(m);
    runInAction(() => {
      const id = whisperModelId(m);
      this.models = this.models.filter(d => whisperModelId(d) !== id);
      if (this.selectedModelId === id) {
        this.selectedModelId = this.models[0]
          ? whisperModelId(this.models[0])
          : null;
      }
    });
  }

  /** Drop models whose files are gone (e.g. app data cleared). */
  async verifyModels() {
    const present: DownloadedWhisperModel[] = [];
    for (const m of this.models) {
      if (await RNFS.exists(whisperModelPath(m))) {
        present.push({...m, path: whisperModelPath(m)});
      }
    }
    runInAction(() => {
      this.models = present;
    });
  }
}

export const voiceStore = new VoiceStore();
