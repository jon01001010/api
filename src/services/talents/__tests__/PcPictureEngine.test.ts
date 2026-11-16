import {NativeModules} from 'react-native';

import {PcPictureEngine, pickHomePc} from '../PcPictureEngine';

const PC = 'a'.repeat(64);

jest.mock('../../../store', () => ({
  serverStore: {
    servers: [
      {id: 'cloud', name: 'Cloud'},
      {id: 'home', name: 'Home PC', homeLinkPc: 'a'.repeat(64)},
    ],
  },
  modelStore: {activeModel: undefined},
}));

describe('image_generate on the phone (asks the Home PC)', () => {
  afterEach(() => {
    delete (NativeModules as any).HomeLink;
  });

  it('asks the PC the chat runs on, else the first paired one', () => {
    const servers = [
      {id: 'a'},
      {id: 'b', homeLinkPc: 'pc-b'},
      {id: 'c', homeLinkPc: 'pc-c'},
    ];
    expect(pickHomePc(servers, 'c')).toBe('pc-c');
    expect(pickHomePc(servers, 'a')).toBe('pc-b');
    expect(pickHomePc(servers)).toBe('pc-b');
    expect(pickHomePc([{id: 'a'}])).toBeUndefined();
  });

  it('sends only the prompt, sizes and steps, and shows the picture', async () => {
    const picture = jest.fn(async (..._args: unknown[]) =>
      JSON.stringify({
        ok: true,
        file: '/cache/pc-pictures/picture-20261115-101530-ab12.png',
        seed: 7,
        seconds: 12,
      }),
    );
    (NativeModules as any).HomeLink = {picture};
    const result = await new PcPictureEngine().execute({
      prompt: '  a cat in the rain ',
      width: 768,
      height: 640,
      steps: 4,
      model: 'C:/x.gguf',
    });
    // 640 is not a size: square, like the width.
    expect(picture).toHaveBeenCalledWith(PC, 'a cat in the rain', 768, 768, 4);
    // No size at all: the PC's default (0).
    await new PcPictureEngine().execute({prompt: 'a dog', width: 333});
    expect(picture).toHaveBeenLastCalledWith(PC, 'a dog', 0, 0, 0);
    expect(result).toMatchObject({
      type: 'image',
      path: '/cache/pc-pictures/picture-20261115-101530-ab12.png',
      name: 'picture-20261115-101530-ab12.png',
    });
    expect(result.summary).toContain('12 s');
  });

  it('says the PC is making the picture while it waits, then clears it', async () => {
    const {toolProgress} = require('../pictureProgress');
    let answer: (v: string) => void = () => {};
    (NativeModules as any).HomeLink = {
      picture: jest.fn(
        () =>
          new Promise<string>(resolve => {
            answer = resolve;
          }),
      ),
    };
    const running = new PcPictureEngine().execute({prompt: 'a cat'});
    await new Promise(r => setTimeout(r, 0));
    expect(toolProgress.text).toBe('Your PC is making the picture…');
    answer(JSON.stringify({ok: false, error: 'Pictures are off'}));
    await running;
    expect(toolProgress.text).toBeNull();
  });

  it("says clearly when the PC doesn't allow it or can't be reached", async () => {
    (NativeModules as any).HomeLink = {
      picture: jest.fn(async () =>
        JSON.stringify({
          ok: false,
          error:
            'Making pictures for paired devices is off on the PC (Settings)',
        }),
      ),
    };
    const result = await new PcPictureEngine().execute({prompt: 'a cat'});
    expect(result.type).toBe('text');
    expect(result.summary).toContain(
      'Making pictures for paired devices is off on the PC',
    );
    delete (NativeModules as any).HomeLink;
    const missing = await new PcPictureEngine().execute({prompt: 'a cat'});
    expect(missing.summary).toContain('The home link is not in this build');
  });

  it('needs a prompt, and stops waiting on Stop', async () => {
    expect((await new PcPictureEngine().execute({})).type).toBe('error');
    (NativeModules as any).HomeLink = {
      picture: jest.fn(() => new Promise(() => {})),
    };
    const stop = new AbortController();
    const waiting = new PcPictureEngine().execute({prompt: 'a cat'}, {
      signal: stop.signal,
    } as any);
    stop.abort();
    expect((await waiting).summary).toContain('Stopped waiting');
  });

  it('is offered as image_generate, prompt required', () => {
    const def = new PcPictureEngine().toToolDefinition();
    expect(def.function.name).toBe('image_generate');
    expect(def.function.parameters.required).toEqual(['prompt']);
    expect(Object.keys(def.function.parameters.properties)).toEqual([
      'prompt',
      'width',
      'height',
      'steps',
    ]);
  });
});
