import * as RNFS from '@dr.pogodin/react-native-fs';

import {VoiceStore} from '../VoiceStore';
import * as models from '../../services/voice/whisperModels';

const a = {repo: 'r/a', file: 'ggml-a.bin'};
const b = {repo: 'r/b', file: 'ggml-b.bin'};

describe('VoiceStore', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('downloads, picks the first model, and tracks progress', async () => {
    const store = new VoiceStore();
    let seen = -1;
    jest
      .spyOn(models, 'downloadWhisperModel')
      .mockImplementation(async (m, onProgress) => {
        onProgress?.(0.5);
        seen = store.downloads[models.whisperModelId(m)];
        return {...m, path: '/p', size: 1};
      });
    await store.download(a);
    expect(seen).toBe(0.5);
    expect(store.downloads).toEqual({});
    expect(store.selectedModel?.file).toBe('ggml-a.bin');
    await store.download(b);
    expect(store.selectedModel?.file).toBe('ggml-a.bin');
    store.selectModel(b);
    expect(store.selectedModel?.file).toBe('ggml-b.bin');
  });

  it('clears progress when a download fails', async () => {
    const store = new VoiceStore();
    jest
      .spyOn(models, 'downloadWhisperModel')
      .mockRejectedValue(new Error('offline'));
    await expect(store.download(a)).rejects.toThrow('offline');
    expect(store.downloads).toEqual({});
    expect(store.models).toEqual([]);
  });

  it('removing the model in use falls back to another', async () => {
    const store = new VoiceStore();
    jest.spyOn(models, 'deleteWhisperModel').mockResolvedValue();
    store.models = [
      {...a, path: '/a', size: 1},
      {...b, path: '/b', size: 1},
    ];
    store.selectModel(a);
    await store.remove(a);
    expect(store.selectedModelId).toBe('r/b/ggml-b.bin');
  });

  it('forgets models whose files are gone', async () => {
    const store = new VoiceStore();
    store.models = [
      {...a, path: '/a', size: 1},
      {...b, path: '/b', size: 1},
    ];
    (RNFS.exists as jest.Mock).mockImplementation(async (p: string) =>
      p.endsWith('ggml-b.bin'),
    );
    await store.verifyModels();
    expect(store.models.map(m => m.file)).toEqual(['ggml-b.bin']);
  });
});
