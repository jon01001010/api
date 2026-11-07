import {NativeModules} from 'react-native';

import {serverStore} from '../../../store/ServerStore';

const PC = 'c'.repeat(64);

describe('a "Home PC" server reopens its tunnel before use', () => {
  afterEach(() => {
    delete (NativeModules as any).HomeLink;
  });

  it('updates the local address and the model password', async () => {
    (NativeModules as any).HomeLink = {
      openTunnel: jest.fn(async () => JSON.stringify({ok: true, port: 5123})),
      status: jest.fn(async () =>
        JSON.stringify({ok: true, running: true, apiKey: 'fresh-key'}),
      ),
    };
    const id = serverStore.addServer({
      name: 'Home PC',
      url: 'http://127.0.0.1:1',
      homeLinkPc: PC,
    });
    const setKey = jest.spyOn(serverStore, 'setApiKey');
    await expect(serverStore.prepareHomeLink(id)).resolves.toEqual({ok: true});
    expect(serverStore.servers.find(s => s.id === id)?.url).toBe(
      'http://127.0.0.1:5123',
    );
    expect(setKey).toHaveBeenCalledWith(id, 'fresh-key');
    expect((NativeModules as any).HomeLink.openTunnel).toHaveBeenCalledWith(PC);
  });

  it('says so when no model runs on the PC', async () => {
    (NativeModules as any).HomeLink = {
      openTunnel: jest.fn(async () => JSON.stringify({ok: true, port: 5124})),
      status: jest.fn(async () =>
        JSON.stringify({ok: true, running: false, apiKey: null}),
      ),
    };
    const id = serverStore.addServer({
      name: 'Home PC',
      url: 'http://127.0.0.1:1',
      homeLinkPc: PC,
    });
    await expect(serverStore.prepareHomeLink(id)).resolves.toEqual({
      ok: false,
      error: 'No model is running on your PC',
    });
  });

  it('leaves other servers alone', async () => {
    const id = serverStore.addServer({
      name: 'LAN',
      url: 'http://10.0.0.2:8080',
    });
    await expect(serverStore.prepareHomeLink(id)).resolves.toEqual({ok: true});
    expect(serverStore.servers.find(s => s.id === id)?.url).toBe(
      'http://10.0.0.2:8080',
    );
  });
});
