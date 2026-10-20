const mockListeners = new Map<string, (event?: any) => void>();
const mockNative = {
  start: jest
    .fn()
    .mockResolvedValue({url: 'http://127.0.0.1:8765/v1', token: 'test-key'}),
  stop: jest.fn().mockResolvedValue(true),
  respond: jest.fn(),
};
const mockLease = {
  signal: new AbortController().signal,
  abort: jest.fn(),
  end: jest.fn(),
};
const mockModel = {
  activeContextSettings: {devices: ['HTP0'], n_gpu_layers: 99, n_ctx: 2048},
  context: {
    getFormattedChat: jest.fn().mockResolvedValue({prompt: 'formatted'}),
    tokenize: jest.fn().mockResolvedValue({tokens: [1, 2]}),
    completion: jest.fn().mockResolvedValue({text: 'answer', stopped_limit: 0}),
    stopCompletion: jest.fn().mockResolvedValue(undefined),
  },
  tryAcquireGeneration: jest.fn(() => mockLease),
};
jest.mock('react-native', () => ({
  Platform: {OS: 'android'},
  NativeModules: {LocalApi: mockNative},
  NativeEventEmitter: jest.fn(() => ({
    addListener: (name: string, fn: any) => {
      mockListeners.set(name, fn);
      return {remove: () => mockListeners.delete(name)};
    },
  })),
}));
jest.mock('../../../store', () => ({modelStore: mockModel}));
const {startLocalApi, stopLocalApi, getLocalApiSession} = require('../service');

const valid = JSON.stringify({
  model: 'local',
  messages: [{role: 'user', content: 'hello'}],
});
async function send(body = valid) {
  mockListeners.get('localApiRequest')!({
    id: 'request-1',
    path: '/v1/chat/completions',
    body,
  });
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}
beforeEach(async () => {
  jest.clearAllMocks();
  const controller = new AbortController();
  mockLease.signal = controller.signal;
  mockLease.abort.mockImplementation(() => controller.abort());
  mockModel.context.completion.mockResolvedValue({
    text: 'answer',
    stopped_limit: 0,
  });
  mockModel.activeContextSettings.devices = ['HTP0'];
  mockModel.context.tokenize.mockResolvedValue({tokens: [1, 2]});
  mockModel.tryAcquireGeneration.mockReturnValue(mockLease);
  await startLocalApi();
});
afterEach(async () => {
  await stopLocalApi();
});
it('uses only the caller prompt and ends the generation lease', async () => {
  await send();
  expect(mockModel.context.getFormattedChat).toHaveBeenCalledWith([
    {role: 'user', content: 'hello'},
  ]);
  expect(mockModel.context.completion).toHaveBeenCalledWith({
    prompt: 'formatted',
    n_predict: 256,
    temperature: 0.7,
  });
  expect(mockNative.respond).toHaveBeenCalledWith(
    'request-1',
    200,
    expect.stringContaining('answer'),
  );
  expect(mockLease.end).toHaveBeenCalledTimes(1);
});
it('rejects arbitrary file/tool arguments before touching the model', async () => {
  await send(
    JSON.stringify({
      model: 'local',
      messages: [{role: 'user', content: 'x'}],
      media_paths: ['/secret'],
    }),
  );
  expect(mockNative.respond).toHaveBeenCalledWith(
    'request-1',
    400,
    expect.any(String),
  );
  expect(mockModel.context.completion).not.toHaveBeenCalled();
});
it('rejects requests above the actual token budget', async () => {
  mockModel.context.tokenize.mockResolvedValue({tokens: Array(2048).fill(1)});
  await send();
  expect(mockNative.respond).toHaveBeenCalledWith(
    'request-1',
    413,
    expect.any(String),
  );
  expect(mockModel.context.completion).not.toHaveBeenCalled();
  expect(mockLease.end).toHaveBeenCalledTimes(1);
});
it('does not silently serve a CPU fallback', async () => {
  mockModel.activeContextSettings.devices = ['CPU'];
  await send();
  expect(mockNative.respond).toHaveBeenCalledWith(
    'request-1',
    503,
    expect.any(String),
  );
  expect(mockModel.context.completion).not.toHaveBeenCalled();
});
it('rejects a busy model without queueing prompts', async () => {
  mockModel.tryAcquireGeneration.mockReturnValue(null as any);
  await send();
  expect(mockNative.respond).toHaveBeenCalledWith(
    'request-1',
    429,
    expect.any(String),
  );
  expect(mockModel.context.completion).not.toHaveBeenCalled();
});
it('clears the UI key and listeners when stopped', async () => {
  expect(getLocalApiSession()?.token).toBe('test-key');
  await stopLocalApi();
  expect(getLocalApiSession()).toBeNull();
  expect(mockListeners.size).toBe(0);
});

it('cancels timed-out inference and suppresses its successful response', async () => {
  let finish!: (value: {text: string; stopped_limit: number}) => void;
  mockModel.context.completion.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await send();
  expect(mockModel.context.completion).toHaveBeenCalled();
  mockListeners.get('localApiCancel')!({id: 'request-1'});
  expect(mockModel.context.stopCompletion).toHaveBeenCalled();
  finish({text: 'late answer', stopped_limit: 0});
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
  expect(mockNative.respond).not.toHaveBeenCalled();
  expect(mockLease.end).toHaveBeenCalledTimes(1);
});
