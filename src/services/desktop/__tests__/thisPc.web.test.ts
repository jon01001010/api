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
jest.mock('../../../store/ServerStore', () => ({
  serverStore: {
    get servers() {
      return mockServers;
    },
    getApiKey: async (id: string) => mockKeys[id],
    setApiKey: async (id: string, k: string) => {
      mockKeys[id] = k;
    },
    updateServer: (id: string, u: any) =>
      Object.assign(
        mockServers.find(s => s.id === id),
        u,
      ),
  },
}));

import {prepareThisPcModel} from '../thisPc.web';

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
