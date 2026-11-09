/**
 * Desktop "This PC" models: Load starts the local server again after the app
 * was closed (the server stops with the app).
 */
const mockInvoke = jest.fn();
jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: any[]) => mockInvoke(...a),
}));

const mockServers: any[] = [];
const mockKeys: Record<string, string> = {};
const mockSelected: any[] = [];
jest.mock('../../../store/ServerStore', () => ({
  serverStore: {
    get servers() {
      return mockServers;
    },
    getApiKey: async (id: string) => mockKeys[id],
    setApiKey: async (id: string, k: string) => {
      mockKeys[id] = k;
    },
    fetchModelsForServer: async () => {},
    addUserSelectedModel: (serverId: string, remoteModelId: string) =>
      mockSelected.push({serverId, remoteModelId}),
    updateServer: (id: string, u: any) =>
      Object.assign(
        mockServers.find(s => s.id === id),
        u,
      ),
  },
}));

import {prepareThisPcModel, startOnThisPc} from '../thisPc.web';

const MODEL = 'C:\\Users\\me\\Downloads\\qwen-1b.gguf';

beforeEach(() => {
  mockInvoke.mockReset();
  mockServers.length = 0;
  mockServers.push(
    {id: 'pc', name: 'This PC', url: 'http://127.0.0.1:1111'},
    {
      id: 'gem',
      name: 'Gemini',
      url: 'https://generativelanguage.googleapis.com',
    },
  );
  mockKeys.pc = 'old-key';
  mockSelected.length = 0;
  // The page's own storage (the tests run without a page).
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  };
  (globalThis as any).__TAURI_INTERNALS__ = {};
});

afterEach(() => {
  delete (globalThis as any).__TAURI_INTERNALS__;
});

it('restarts the server for the model when the old one is gone', async () => {
  (globalThis as any).fetch = jest.fn(async (url: string) => {
    if (url.startsWith('http://127.0.0.1:1111')) {
      throw new TypeError('connection refused'); // stopped with the app
    }
    return {ok: true, json: async () => ({status: 'ok'})}; // new server ready
  });
  mockInvoke.mockResolvedValue({
    url: 'http://127.0.0.1:2222',
    apiKey: 'new-key',
  });
  await prepareThisPcModel('pc', MODEL);
  expect(mockInvoke).toHaveBeenCalledWith('model_server_start', {
    modelPath: MODEL,
    context: 8192,
    projectionPath: null,
  });
  expect(mockServers[0].url).toBe('http://127.0.0.1:2222');
  expect(mockKeys.pc).toBe('new-key');
});

it('does nothing when the server already serves that model', async () => {
  (globalThis as any).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({data: [{id: MODEL}]}),
  }));
  await prepareThisPcModel('pc', MODEL);
  expect(mockInvoke).not.toHaveBeenCalled();
});

it('leaves other servers alone', async () => {
  (globalThis as any).fetch = jest.fn();
  await prepareThisPcModel('gem', 'gemini-2.5-flash');
  expect(mockInvoke).not.toHaveBeenCalled();
  expect((globalThis as any).fetch).not.toHaveBeenCalled();
});

it('a downloaded model starts with its vision part, also after a restart', async () => {
  const OWN = '/pocketagent/Documents/models/qwen-4b.gguf';
  const VISION = '/pocketagent/Documents/models/mmproj.gguf';
  (globalThis as any).fetch = jest.fn(async (url: string) => {
    if (url.startsWith('http://127.0.0.1:1111')) {
      throw new TypeError('connection refused');
    }
    return {ok: true, json: async () => ({status: 'ok'})};
  });
  mockInvoke.mockResolvedValue({url: 'http://127.0.0.1:3333', apiKey: 'k'});
  const id = await startOnThisPc(OWN, VISION);
  expect(id).toBe('pc');
  expect(mockInvoke).toHaveBeenCalledWith('model_server_start', {
    modelPath: OWN,
    context: 8192,
    projectionPath: VISION,
  });
  // Listed under "This PC" by its own path, so Load can switch to it.
  expect(mockSelected).toEqual([{serverId: 'pc', remoteModelId: OWN}]);
  // The app closed (server gone): Load restarts it the same way.
  mockInvoke.mockClear();
  mockServers[0].url = 'http://127.0.0.1:1111';
  await prepareThisPcModel('pc', OWN);
  expect(mockInvoke).toHaveBeenCalledWith(
    'model_server_start',
    expect.objectContaining({modelPath: OWN, projectionPath: VISION}),
  );
});
