import {
  CustomToolEngine,
  checkCustomTool,
  fillIn,
  fillInsOf,
  listCustomTools,
  resetCustomToolsForTests,
  saveCustomTool,
} from '../customTools';
import {ToolMakerEngine} from '../ToolMakerEngine';
import {talentRegistry} from '../TalentRegistry';
import {requestFileApproval} from '../fileApprovalGate';

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
jest.mock('../fileApprovalGate', () => ({requestFileApproval: jest.fn()}));
const mockEnabled: string[] = [];
jest.mock('../../../utils/globalToolSettings', () => ({
  readGlobalTools: jest.fn(async () => [...mockEnabled]),
  writeGlobalTools: jest.fn(async (names: string[]) => {
    mockEnabled.splice(0, mockEnabled.length, ...names);
  }),
}));

const approve = requestFileApproval as jest.Mock;
const builtIns = ['set_alarm', 'open_app', 'datetime', 'tool_save'];

// Stand-in built-in tools that record their calls.
const calls: {tool: string; args: any; ctx: any}[] = [];
const fake = (name: string, summary = `${name} ok`) => ({
  name,
  execute: jest.fn(async (args: any, ctx: any) => {
    calls.push({tool: name, args, ctx});
    return {type: 'text', summary};
  }),
  toToolDefinition: () => ({
    type: 'function' as const,
    function: {name, description: name, parameters: {}},
  }),
});

beforeEach(async () => {
  jest.clearAllMocks();
  calls.length = 0;
  mockEnabled.length = 0;
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default;
  AsyncStorage.__store.clear();
  talentRegistry.reset();
  resetCustomToolsForTests();
  for (const n of ['set_alarm', 'open_app', 'datetime']) {
    talentRegistry.register(fake(n) as any);
  }
  talentRegistry.register(new ToolMakerEngine('tool_save'));
  talentRegistry.register(new ToolMakerEngine('tool_delete'));
  approve.mockResolvedValue(true);
});

describe('checking a custom tool', () => {
  const ok = {builtIns, existing: []};

  it('accepts saved instructions and a shortcut, tidying the name', () => {
    expect(
      checkCustomTool(
        {
          kind: 'instructions',
          name: 'Packing_List',
          description: 'd',
          instructions: 'Take socks',
        },
        ok,
      ),
    ).toEqual(
      expect.objectContaining({name: 'packing_list', kind: 'instructions'}),
    );
    expect(
      checkCustomTool(
        {
          kind: 'shortcut',
          name: 'morning',
          description: 'Start the day',
          steps: [
            {tool: 'set_alarm', args: {hour: '{{hour}}'}},
            {tool: 'open_app', args: {name: 'Spotify'}},
          ],
        },
        ok,
      ),
    ).toEqual(expect.objectContaining({kind: 'shortcut', name: 'morning'}));
  });

  it.each([
    [
      {kind: 'instructions', name: 'x', description: 'd', instructions: 'i'},
      /3-40 characters/,
    ],
    [
      {
        kind: 'instructions',
        name: 'set_alarm',
        description: 'd',
        instructions: 'i',
      },
      /built-in/,
    ],
    [
      {kind: 'instructions', name: 'notes', description: '', instructions: 'i'},
      /description/,
    ],
    [
      {
        kind: 'shortcut',
        name: 'loop',
        description: 'd',
        steps: [{tool: 'tool_save'}],
      },
      /not a built-in tool a shortcut can use/,
    ],
    [
      {
        kind: 'shortcut',
        name: 'nest',
        description: 'd',
        steps: [{tool: 'morning'}],
      },
      /not a built-in tool/,
    ],
    [
      {kind: 'shortcut', name: 'none', description: 'd', steps: []},
      /1 to 8 steps/,
    ],
    [
      {
        kind: 'shortcut',
        name: 'wrong_order',
        description: 'd',
        steps: [
          {tool: 'open_app', args: {}},
          {tool: 'set_alarm', args: {}},
        ],
      },
      /opens another app.*Put it last/,
    ],
    [{kind: 'script', name: 'code', description: 'd'}, /kind/],
  ])('refuses %j', (input, why) => {
    expect(checkCustomTool(input, ok)).toMatch(why);
  });

  it('finds and fills {{fill-ins}}', () => {
    const steps = [
      {tool: 'set_alarm', args: {hour: '{{hour}}', label: 'Wake {{who}}'}},
      {tool: 'open_app', args: {name: '{{ app }}'}},
    ];
    expect(fillInsOf(steps)).toEqual(['hour', 'who', 'app']);
    expect(fillIn(steps[0].args, {hour: 7, who: 'Jon'})).toEqual({
      hour: '7',
      label: 'Wake Jon',
    });
  });
});

describe('running custom tools', () => {
  it('saved instructions return their text', async () => {
    const tool = await saveCustomTool({
      kind: 'instructions',
      name: 'packing_list',
      description: 'What to pack',
      instructions: 'Socks, charger, passport.',
    });
    const engine = new CustomToolEngine(tool as any);
    expect(await engine.execute({})).toEqual({
      type: 'text',
      summary: 'Socks, charger, passport.',
    });
  });

  it('a shortcut asks once, then runs every step quietly in order', async () => {
    await saveCustomTool({
      kind: 'shortcut',
      name: 'morning',
      description: 'Start the day',
      steps: [
        {tool: 'set_alarm', args: {hour: '{{hour}}', minute: 0}},
        {tool: 'open_app', args: {name: 'Spotify'}},
      ],
    });
    const engine = talentRegistry.get('morning')!;
    expect(engine.toToolDefinition().function.parameters.required).toEqual([
      'hour',
    ]);
    const result = await engine.execute({hour: 7});
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0][0].content).toBe(
      '1. set_alarm {"hour":"7","minute":0}\n2. open_app {"name":"Spotify"}',
    );
    expect(calls.map(c => c.tool)).toEqual(['set_alarm', 'open_app']);
    expect(calls.every(c => c.ctx.inApprovedShortcut)).toBe(true);
    expect(result.summary).toMatch(/finished/);
  });

  it('a denied shortcut runs nothing; a missing fill-in is asked for', async () => {
    await saveCustomTool({
      kind: 'shortcut',
      name: 'morning',
      description: 'd',
      steps: [{tool: 'set_alarm', args: {hour: '{{hour}}'}}],
    });
    const engine = talentRegistry.get('morning')!;
    expect((await engine.execute({})).summary).toMatch(/give `hour`/);
    approve.mockResolvedValue(false);
    expect((await engine.execute({hour: 7})).summary).toMatch(/said no/);
    expect(calls).toEqual([]);
  });

  it('a failing step stops the rest and says what was done', async () => {
    talentRegistry.register({
      ...fake('set_alarm'),
      execute: jest.fn(async () => ({
        type: 'error',
        summary: 'No app on this phone can set an alarm.',
        errorMessage: 'x',
      })),
    } as any);
    await saveCustomTool({
      kind: 'shortcut',
      name: 'morning',
      description: 'd',
      steps: [
        {tool: 'datetime', args: {}},
        {tool: 'set_alarm', args: {}},
        {tool: 'open_app', args: {}},
      ],
    });
    const result = await talentRegistry.get('morning')!.execute({});
    expect(result.type).toBe('error');
    expect(result.summary).toMatch(/stopped at step 2 \(set_alarm\)/);
    expect(result.summary).toMatch(/1\. datetime/);
    expect(calls.map(c => c.tool)).toEqual(['datetime']);
  });
});

describe('tool_save and tool_delete (made by a model)', () => {
  const save = (args: any) => talentRegistry.get('tool_save')!.execute(args);

  it('shows the full definition, saves it switched off', async () => {
    const result = await save({
      kind: 'instructions',
      name: 'packing_list',
      description: 'What to pack',
      instructions: 'Socks',
    });
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'custom_tool',
        filename:
          'Save the custom tool "packing_list"? It starts switched off.',
        content: expect.stringContaining('Socks'),
      }),
      undefined,
    );
    expect(result.summary).toMatch(/switched off/);
    expect((await listCustomTools())[0]).toEqual(
      expect.objectContaining({name: 'packing_list', createdBy: 'model'}),
    );
    expect(mockEnabled).toEqual([]);
  });

  it('nothing is saved when the user says no or the definition is bad', async () => {
    approve.mockResolvedValueOnce(false);
    await save({
      kind: 'instructions',
      name: 'abc',
      description: 'd',
      instructions: 'i',
    });
    expect(
      (
        await save({
          kind: 'instructions',
          name: 'set_alarm',
          description: 'd',
          instructions: 'i',
        })
      ).type,
    ).toBe('error');
    expect(await listCustomTools()).toEqual([]);
  });

  it('replacing a tool switches it off again', async () => {
    await save({
      kind: 'instructions',
      name: 'notes',
      description: 'd',
      instructions: 'v1',
    });
    mockEnabled.push('notes');
    const result = await save({
      kind: 'instructions',
      name: 'notes',
      description: 'd',
      instructions: 'v2',
    });
    expect(approve.mock.calls[1][0].filename).toMatch(/^Replace/);
    expect(result.summary).toMatch(/switched off/);
    expect(mockEnabled).toEqual([]);
    expect((await listCustomTools())[0]).toEqual(
      expect.objectContaining({instructions: 'v2'}),
    );
  });

  it('tool_delete asks, then removes the tool and its registration', async () => {
    await save({
      kind: 'instructions',
      name: 'notes',
      description: 'd',
      instructions: 'v1',
    });
    expect(talentRegistry.has('notes')).toBe(true);
    const result = await talentRegistry
      .get('tool_delete')!
      .execute({name: 'notes'});
    expect(result.summary).toMatch(/Deleted/);
    expect(talentRegistry.has('notes')).toBe(false);
    expect(
      (await talentRegistry.get('tool_delete')!.execute({name: 'nope'})).type,
    ).toBe('error');
  });
});
