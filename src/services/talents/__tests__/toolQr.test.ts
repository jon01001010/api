import {deflateRaw} from 'pako';

import {
  GLOBAL_TOOLS_KEY,
  listCustomTools,
  resetCustomToolsForTests,
  saveCustomTool,
  type CustomTool,
} from '../customTools';
import {talentRegistry} from '../TalentRegistry';
import {
  MAX_TOOL_BYTES,
  QR_MAX_CHARS,
  TOOL_TAG,
  base64ToBytes,
  bytesToBase64,
  codeKind,
  fitsOneQr,
  packTool,
  unpackTool,
} from '../toolQr';
import {
  installSharedTool,
  reviewSharedTool,
  reviewToolCode,
} from '../toolImport';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      removeItem: jest.fn(async (k: string) => void store.delete(k)),
      __store: store,
    },
  };
});

const fake = (name: string) => ({
  name,
  execute: jest.fn(async () => ({type: 'text', summary: 'ran'})),
  toToolDefinition: () => ({
    type: 'function' as const,
    function: {name, description: name, parameters: {}},
  }),
});

const shortcut: CustomTool = {
  kind: 'shortcut',
  name: 'morning_routine',
  description: 'when I say good morning',
  steps: [
    {tool: 'set_alarm', args: {hour: '{{hour}}', minute: 0}},
    {tool: 'open_app', args: {name: 'Radio – Café ☕'}},
  ],
  createdBy: 'model',
};
const instructions: CustomTool = {
  kind: 'instructions',
  name: 'packing_list',
  description: 'when I pack for a trip',
  instructions: 'Ask how many days. '.repeat(40),
  createdBy: 'user',
};

const store = () =>
  require('@react-native-async-storage/async-storage').default.__store as Map<
    string,
    string
  >;
const zCode = (json: string) =>
  `${TOOL_TAG}1:z:${bytesToBase64(deflateRaw(Buffer.from(json, 'utf8')))}`;

beforeEach(() => {
  store().clear();
  talentRegistry.reset();
  resetCustomToolsForTests();
  for (const n of ['set_alarm', 'open_app', 'datetime']) {
    talentRegistry.register(fake(n) as any);
  }
});

describe('base64', () => {
  it('round-trips every length and byte', () => {
    for (let len = 0; len < 10; len++) {
      const bytes = Uint8Array.from({length: len}, (_, i) => (i * 97) % 256);
      const text = bytesToBase64(bytes);
      expect(text).toBe(Buffer.from(bytes).toString('base64'));
      expect(Array.from(base64ToBytes(text)!)).toEqual(Array.from(bytes));
    }
  });
  it('refuses text that is not base64', () => {
    expect(base64ToBytes('abc')).toBeNull();
    expect(base64ToBytes('ab$d')).toBeNull();
  });
});

describe('pack and unpack', () => {
  it('round-trips a shortcut (with non-ASCII text) and instructions', () => {
    for (const tool of [shortcut, instructions]) {
      const code = packTool(tool);
      expect(code.startsWith('PA1:T:1:')).toBe(true);
      const out = unpackTool(code);
      expect(out.ok).toBe(true);
      const shared: Record<string, unknown> = {...tool};
      delete shared.createdBy;
      expect(out.ok && out.tool).toEqual(shared);
    }
  });

  it('packs long text, keeps short tools as plain JSON', () => {
    expect(packTool(instructions)).toMatch(/^PA1:T:1:z:/);
    const tiny: CustomTool = {
      kind: 'instructions',
      name: 'abc',
      description: 'x',
      instructions: 'y',
      createdBy: 'user',
    };
    expect(packTool(tiny)).toMatch(/^PA1:T:1:j:\{/);
    expect(unpackTool(packTool(tiny)).ok).toBe(true);
  });

  it('keeps the plain form ASCII (one byte per QR character)', () => {
    const tiny: CustomTool = {
      kind: 'instructions',
      name: 'cafe',
      description: 'Café',
      instructions: 'ü',
      createdBy: 'user',
    };
    const code = packTool(tiny);
    expect(code).toMatch(/^PA1:T:1:j:/);
    expect(/^[\x20-\x7e]*$/.test(code)).toBe(true);
    const out = unpackTool(code);
    expect(out.ok && out.tool.description).toBe('Café');
  });

  it('a code of the QR limit fits one QR; one more character does not', () => {
    const {qrModules} = require('../../../components/QrCodeView/QrCodeView');
    expect(
      qrModules('PA1:T:1:z:' + 'A'.repeat(QR_MAX_CHARS - 10)),
    ).toHaveLength(177);
    expect(qrModules('A'.repeat(QR_MAX_CHARS + 1))).toBeNull();
    expect(qrModules(packTool(shortcut))!.length).toBeLessThan(177);
  });

  it('never sends who made it', () => {
    const out = unpackTool(packTool(shortcut));
    expect(out.ok && 'createdBy' in out.tool).toBe(false);
  });

  it('says whether it fits in one QR', () => {
    expect(fitsOneQr(packTool(shortcut))).toBe(true);
    expect(fitsOneQr('x'.repeat(QR_MAX_CHARS + 1))).toBe(false);
  });

  it('refuses a wrong tag, an unknown version or form', () => {
    expect(unpackTool('PA1:P:abc').ok).toBe(false);
    expect(unpackTool('hello').ok).toBe(false);
    expect(unpackTool('').ok).toBe(false);
    const code = packTool(shortcut);
    expect(unpackTool(code.replace('PA1:T:1:', 'PA1:T:2:'))).toEqual({
      ok: false,
      error: expect.stringMatching(/newer/),
    });
    expect(unpackTool(code.replace(/^PA1:T:1:./, 'PA1:T:1:q')).ok).toBe(false);
    expect(unpackTool('PA1:T:garbage').ok).toBe(false);
  });

  it('refuses corrupt data', () => {
    const code = packTool(instructions);
    const body = code.slice('PA1:T:1:z:'.length);
    // Damaged characters, cut short, not base64, not JSON inside.
    const flipped =
      body.slice(0, 20) + (body[20] === 'A' ? 'B' : 'A') + body.slice(21);
    for (const bad of [
      'PA1:T:1:z:' + flipped,
      'PA1:T:1:z:' + body.slice(0, body.length - 12),
      'PA1:T:1:z:not*base64',
      zCode('{not json'),
      zCode('[1,2,3]'),
      'PA1:T:1:j:{"kind":"shortcut"',
      'PA1:T:1:z:' + bytesToBase64(Uint8Array.from([0xff, 0xfe, 0x01])),
    ]) {
      expect(unpackTool(bad).ok).toBe(false);
    }
  });

  it('refuses invalid UTF-8 inside', () => {
    const bytes = deflateRaw(Uint8Array.from([0x22, 0xc3, 0x28, 0x22]));
    expect(unpackTool(`${TOOL_TAG}1:z:${bytesToBase64(bytes)}`).ok).toBe(false);
  });

  it('refuses a wrong shape and keeps only tool fields', () => {
    expect(
      unpackTool(zCode('{"kind":"script","name":"abc","description":"x"}')).ok,
    ).toBe(false);
    expect(
      unpackTool(zCode('{"kind":"instructions","description":"x"}')).ok,
    ).toBe(false);
    expect(
      unpackTool(
        zCode(
          '{"kind":"shortcut","name":"abc","description":"x","steps":[{"tool":1}]}',
        ),
      ).ok,
    ).toBe(false);
    expect(
      unpackTool(
        zCode(
          '{"kind":"shortcut","name":"abc","description":"x","steps":[{"tool":"open_app","args":[1]}]}',
        ),
      ).ok,
    ).toBe(false);
    const out = unpackTool(
      zCode(
        '{"kind":"instructions","name":"abc","description":"x","instructions":"y","createdBy":"model","run":"code"}',
      ),
    );
    expect(out).toEqual({
      ok: true,
      tool: {
        kind: 'instructions',
        name: 'abc',
        description: 'x',
        instructions: 'y',
      },
    });
  });

  it('refuses a tool over the size cap', () => {
    const big = JSON.stringify({
      kind: 'instructions',
      name: 'abc',
      description: 'x',
      instructions: 'a'.repeat(MAX_TOOL_BYTES),
    });
    expect(unpackTool(zCode(big)).ok).toBe(false);
    expect(unpackTool(`${TOOL_TAG}1:j:${big}`).ok).toBe(false);
    expect(unpackTool(`${TOOL_TAG}1:j:` + 'x'.repeat(40000)).ok).toBe(false);
  });

  it('stops a zip bomb early (small code, huge output)', () => {
    // 50 MB of zeros packs to about 50 KB; a 5 MB one fits the code cap.
    const bomb = deflateRaw(new Uint8Array(5 * 1024 * 1024), {level: 9});
    const code = `${TOOL_TAG}1:z:${bytesToBase64(bomb)}`;
    expect(code.length).toBeLessThan(32 * 1024);
    const started = Date.now();
    expect(unpackTool(code).ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('codeKind', () => {
  it('tells tools, pairings and unknown codes apart', () => {
    expect(codeKind(packTool(shortcut))).toBe('tool');
    expect(codeKind(`PA1:P:${'a'.repeat(64)}:${'b'.repeat(32)}`)).toBe(
      'pairing',
    );
    expect(codeKind('PA1:X:whatever')).toBe('unknown');
    expect(codeKind('https://example.com')).toBe('unknown');
  });
});

describe('installing a shared tool', () => {
  it('runs the tool_save checks (built-ins only, no tool-making)', async () => {
    const bad = await reviewToolCode(
      packTool({...shortcut, steps: [{tool: 'tool_save', args: {}}]}),
    );
    expect(bad.status).toBe('refused');
    const unknown = await reviewToolCode(
      packTool({...shortcut, steps: [{tool: 'run_shell', args: {}}]}),
    );
    expect(unknown.status).toBe('refused');
    const builtInName = await reviewToolCode(
      packTool({...instructions, name: 'datetime'}),
    );
    expect(builtInName.status).toBe('refused');
  });

  it('installs switched off, as made by the user, and never runs it', async () => {
    store().set(
      GLOBAL_TOOLS_KEY,
      JSON.stringify(['morning_routine', 'datetime']),
    );
    const review = await reviewToolCode(packTool(shortcut));
    expect(review.status).toBe('ready');
    if (review.status !== 'ready') {
      return;
    }
    const saved = await installSharedTool(review.tool);
    expect(typeof saved).not.toBe('string');
    expect(JSON.parse(store().get(GLOBAL_TOOLS_KEY)!)).toEqual(['datetime']);
    const list = await listCustomTools();
    expect(list).toEqual([{...shortcut, createdBy: 'user'}]);
    for (const n of ['set_alarm', 'open_app']) {
      expect(talentRegistry.get(n)!.execute).not.toHaveBeenCalled();
    }
  });

  it('asks for a new name on a clash and never overwrites', async () => {
    await saveCustomTool({...instructions, name: 'morning_routine'});
    const review = await reviewToolCode(packTool(shortcut));
    expect(review.status).toBe('name_taken');
    // Installing the clashing name anyway is refused, the old one is kept.
    if (review.status === 'name_taken') {
      expect(typeof (await installSharedTool(review.tool))).toBe('string');
    }
    expect((await listCustomTools())[0].kind).toBe('instructions');

    const raw = unpackTool(packTool(shortcut));
    const renamed = await reviewSharedTool(raw.ok ? raw.tool : {}, 'Morning_2');
    expect(renamed.status).toBe('ready');
    if (renamed.status === 'ready') {
      expect(renamed.tool.name).toBe('morning_2');
      await installSharedTool(renamed.tool);
    }
    expect((await listCustomTools()).map(t => t.name)).toEqual([
      'morning_routine',
      'morning_2',
    ]);
  });
});
