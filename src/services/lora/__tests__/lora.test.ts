import * as RNFS from '@dr.pogodin/react-native-fs';
import {pick} from '@react-native-documents/picker';
import {loadLlamaModelInfo} from 'llama.rn';

import {modelStore} from '../../../store';
import {loraStore} from '../../../store/LoraStore';
import {ModelOrigin} from '../../../utils/types';
import {
  activeLoraFor,
  adapterFileName,
  addAdapterFile,
  chooseAdapter,
  loraLabelFor,
  removeAdapter,
} from '..';

const model = {
  id: 'qwen',
  name: 'Qwen3 1.7B',
  origin: ModelOrigin.LOCAL,
  ggufMetadata: {architecture: 'qwen3'},
} as any;

const applyLoraChoice = jest.fn(async (_id: string) => {});

beforeEach(() => {
  (modelStore as any).applyLoraChoice = applyLoraChoice;
  applyLoraChoice.mockClear();
  loraStore.adapters = [];
  loraStore.choices = {};
  loraStore.pcModels = {};
  (RNFS.exists as jest.Mock).mockImplementation(async (p: string) =>
    p.endsWith('/models/lora'),
  );
  (RNFS.copyFile as jest.Mock).mockClear();
  (RNFS.unlink as jest.Mock).mockClear();
  (RNFS.stat as jest.Mock).mockResolvedValue({size: 35_000_000});
});

it('adds a picked adapter into the app folder, under its model', async () => {
  (pick as jest.Mock).mockResolvedValueOnce([
    {uri: 'content://downloads/my-style.gguf', name: 'my-style.gguf'},
  ]);
  (loadLlamaModelInfo as jest.Mock).mockResolvedValueOnce({
    'general.type': 'adapter',
    'general.architecture': 'qwen3',
  });
  const added = await addAdapterFile(model);
  expect(RNFS.copyFile).toHaveBeenCalledWith(
    'content://downloads/my-style.gguf',
    '/path/to/documents/models/lora/my-style.gguf',
  );
  expect(added).toMatchObject({
    name: 'my-style',
    modelId: 'qwen',
    architecture: 'qwen3',
    size: 35_000_000,
  });
  expect(loraStore.adaptersFor('qwen')).toHaveLength(1);
});

it('refuses an adapter made for another kind of model (and a model file)', async () => {
  (pick as jest.Mock).mockResolvedValueOnce([
    {uri: 'content://x', name: 'llama-style.gguf'},
  ]);
  (loadLlamaModelInfo as jest.Mock).mockResolvedValueOnce({
    'general.type': 'adapter',
    'general.architecture': 'llama',
  });
  await expect(addAdapterFile(model)).rejects.toThrow(/for a llama model/);
  // Only the app's own copy is removed.
  expect(RNFS.unlink).toHaveBeenCalledWith(
    '/path/to/documents/models/lora/llama-style.gguf',
  );
  (pick as jest.Mock).mockResolvedValueOnce([
    {uri: 'content://y', name: 'model.gguf'},
  ]);
  (loadLlamaModelInfo as jest.Mock).mockResolvedValueOnce({
    'general.type': 'model',
  });
  await expect(addAdapterFile(model)).rejects.toThrow(/not an adapter/);
  expect(loraStore.adapters).toEqual([]);
  // Not a .gguf: nothing copied.
  (pick as jest.Mock).mockResolvedValueOnce([{uri: 'x', name: 'notes.txt'}]);
  (RNFS.copyFile as jest.Mock).mockClear();
  await expect(addAdapterFile(model)).rejects.toThrow(/\.gguf/);
  expect(RNFS.copyFile).not.toHaveBeenCalled();
});

it('desktop: the file details cannot be read, so the chosen model stands', async () => {
  (pick as jest.Mock).mockResolvedValueOnce([
    {uri: '/pocketagent/Caches/import/ab12-v2.gguf', name: 'v2.gguf'},
  ]);
  (loadLlamaModelInfo as jest.Mock).mockRejectedValueOnce(
    new Error('Reading model details on this device'),
  );
  // A second version of the same name gets its own file.
  (RNFS.exists as jest.Mock).mockImplementation(
    async (p: string) => p.endsWith('/models/lora') || p.endsWith('/v2.gguf'),
  );
  const added = await addAdapterFile(model);
  expect(added?.fileName).toBe('v2-2.gguf');
});

it('file names are kept plain', () => {
  expect(adapterFileName('C:\\Users\\me\\..\\my style.gguf')).toBe(
    'my style.gguf',
  );
  expect(adapterFileName('../../x:y,z.GGUF')).toBe('x-y-z.gguf');
  expect(adapterFileName('.gguf')).toBe('adapter.gguf');
});

it('choosing, changing strength and Off are remembered and applied at once', async () => {
  loraStore.add({
    id: 'a1',
    name: 'my-style',
    fileName: 'my-style.gguf',
    size: 1,
    addedAt: '2026-11-15',
    modelId: 'qwen',
  });
  await chooseAdapter('qwen', 'a1');
  expect(loraStore.choices.qwen).toEqual({adapterId: 'a1', scale: 1});
  expect(applyLoraChoice).toHaveBeenLastCalledWith('qwen');
  await chooseAdapter('qwen', 'a1', 0.8);
  expect(loraLabelFor(model)).toBe('+ my-style (0.8)');
  await chooseAdapter('qwen', null);
  expect(loraLabelFor(model)).toBe('');
  expect(applyLoraChoice).toHaveBeenCalledTimes(3);
  await expect(chooseAdapter('other', 'a1')).rejects.toThrow();
});

it('removing the active adapter goes back to the plain model', async () => {
  const a = {
    id: 'a1',
    name: 'my-style',
    fileName: 'my-style.gguf',
    size: 1,
    addedAt: '2026-11-15',
    modelId: 'qwen',
  };
  loraStore.add(a);
  loraStore.setChoice('qwen', 'a1', 0.5);
  await removeAdapter(a);
  expect(loraStore.activeFor('qwen')).toBeUndefined();
  expect(applyLoraChoice).toHaveBeenCalledWith('qwen');
  expect(RNFS.unlink).toHaveBeenCalledWith(
    '/path/to/documents/models/lora/my-style.gguf',
  );
});

it('desktop: the This PC model shows the adapter of the model it runs; other servers none', () => {
  loraStore.add({
    id: 'a1',
    name: 'my-style',
    fileName: 'my-style.gguf',
    size: 1,
    addedAt: '2026-11-15',
    modelId: 'qwen',
  });
  loraStore.setChoice('qwen', 'a1', 0.6);
  loraStore.rememberPcModel('/pocketagent/Documents/models/q.gguf', 'qwen');
  const pc = {
    id: 'pc//pocketagent/Documents/models/q.gguf',
    origin: ModelOrigin.REMOTE,
    author: 'This PC',
    remoteModelId: '/pocketagent/Documents/models/q.gguf',
  } as any;
  expect(loraLabelFor(pc)).toBe('+ my-style (0.6)');
  expect(activeLoraFor({...pc, author: 'Home PC'})).toBeUndefined();
});
