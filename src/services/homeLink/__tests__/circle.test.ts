import {Alert, NativeModules} from 'react-native';

import {
  describeNews,
  homePcKeys,
  passRemovalsOn,
  takeCircleNews,
  tellRemoval,
} from '../circle';
import type {ServerConfig} from '../../../utils/types';

jest.mock('../homeLink', () => ({
  pcStatus: jest.fn(async () => ({ok: true, running: false, apiKey: null})),
}));

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

const server = (id: string, name: string, pc?: string): ServerConfig => ({
  id,
  name,
  url: 'http://127.0.0.1:1',
  ...(pc && {homeLinkPc: pc}),
});

function store(servers: ServerConfig[]) {
  const s = {
    servers,
    removeServer: jest.fn((id: string) => {
      s.servers = s.servers.filter(x => x.id !== id);
    }),
  };
  return s;
}

describe('device circle stage 2: removal notices (screens)', () => {
  afterEach(() => {
    delete (NativeModules as any).HomeLink;
    jest.clearAllMocks();
  });

  it('lists the Home PCs once each', () => {
    expect(
      homePcKeys([
        server('1', 'Desktop', A),
        server('2', 'Desktop again', A),
        server('3', 'Cloud'),
        server('4', 'Laptop', B),
      ]),
    ).toEqual([A, B]);
  });

  it('asks the native side to sign a removal, without the removed key as a Home PC', async () => {
    const circle = jest.fn(async () => JSON.stringify({ok: true}));
    (NativeModules as any).HomeLink = {circle};
    await expect(
      tellRemoval(B, [server('1', 'Desktop', A), server('2', 'Laptop', B)]),
    ).resolves.toEqual({ok: true, news: undefined});
    expect(JSON.parse((circle.mock.calls[0] as any)[0])).toEqual({
      op: 'remove',
      key: B,
      homePcs: [A],
    });
  });

  it('never throws, and says so without the native side', async () => {
    await expect(tellRemoval(A, [])).resolves.toEqual({
      ok: false,
      error: 'The home link is not in this build',
    });
    (NativeModules as any).HomeLink = {circle: async () => 'not json'};
    expect((await tellRemoval(A, [])).ok).toBe(false);
    await expect(takeCircleNews(store([]))).resolves.toEqual([]);
  });

  it('a removal from another device removes the Home PC here and tells the user, without asking', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const news = [
      {removed: B, by: A, at: 1},
      // Not used here: nothing to remove, nothing to say.
      {removed: C, by: A, at: 1},
    ];
    const circle = jest.fn(async () => JSON.stringify({ok: true, news}));
    (NativeModules as any).HomeLink = {circle};
    const s = store([server('1', 'Desktop', A), server('2', 'Laptop', B)]);
    await expect(takeCircleNews(s)).resolves.toEqual(news);
    expect(JSON.parse((circle.mock.calls[0] as any)[0])).toEqual({
      op: 'news',
      homePcs: [A, B],
    });
    expect(s.removeServer).toHaveBeenCalledWith('2');
    expect(s.removeServer).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, body] = alert.mock.calls[0];
    expect(title).toBe('Removed on another of your devices');
    expect(body).toBe(
      '“Desktop” removed “Laptop” from your devices; removed here too.',
    );
    // An alert with no buttons: nothing to answer.
    expect(alert.mock.calls[0].length).toBe(2);
  });

  it('does not tell twice what the PC told already', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (NativeModules as any).HomeLink = {
      circle: async () =>
        JSON.stringify({
          ok: true,
          news: [{removed: B, by: A, at: 1, told: true}],
        }),
    };
    const s = store([server('2', 'Laptop', B)]);
    await takeCircleNews(s);
    expect(s.removeServer).toHaveBeenCalledWith('2');
    expect(alert).not.toHaveBeenCalled();
  });

  it('names devices as best it can', () => {
    expect(
      describeNews(
        {removed: C, by: A, at: 1, byName: 'Desktop', removedName: 'Pixel 8'},
        [],
      ),
    ).toBe('“Desktop” removed “Pixel 8” from your devices; removed here too.');
    expect(describeNews({removed: C, by: B, at: 1}, [])).toBe(
      '“Another of your devices” removed “a device (cccccccccc…)” from your devices; removed here too.',
    );
  });

  it('passes notices on with each Home PC’s status round trip', async () => {
    const {pcStatus} = require('../homeLink');
    (NativeModules as any).HomeLink = {
      circle: async () => JSON.stringify({ok: true, news: []}),
    };
    await passRemovalsOn(
      store([server('1', 'Desktop', A), server('2', 'Laptop', B)]),
    );
    expect(pcStatus.mock.calls.map((c: string[]) => c[0])).toEqual([A, B]);
  });
});
