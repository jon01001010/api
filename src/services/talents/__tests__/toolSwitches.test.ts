/**
 * Toolbox switches: every change is one name (or group) against the stored
 * list, one at a time, so an open Toolbox can't write an older list back
 * over a sync that switched a tool off.
 */
import {
  GLOBAL_TOOLS_KEY,
  deleteCustomTool,
  replaceCustomTools,
  resetCustomToolsForTests,
} from '../customTools';
import {talentRegistry} from '../TalentRegistry';
import {
  onToolSwitchesChanged,
  readGlobalTools,
  setToolEnabled,
  setToolsEnabled,
} from '../../../utils/globalToolSettings';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      removeItem: jest.fn(async (k: string) => {
        store.delete(k);
      }),
      __store: store,
    },
  };
});
// Only the registry's own tools (no phone or file engines in this test).
jest.mock('../index', () => ({
  deriveToolSchemas: () =>
    require('../TalentRegistry')
      .talentRegistry.getAll()
      .map((e: any) => e.toToolDefinition()),
}));

const store = () =>
  require('@react-native-async-storage/async-storage').default.__store as Map<
    string,
    string
  >;
const stored = (): string[] =>
  JSON.parse(store().get(GLOBAL_TOOLS_KEY) ?? '[]');
const notes = (text: string) => ({
  kind: 'instructions',
  name: 'notes',
  description: 'd',
  instructions: text,
  createdBy: 'user',
});
const fake = (name: string) => ({
  name,
  execute: jest.fn(),
  toToolDefinition: () => ({
    type: 'function' as const,
    function: {name, description: name, parameters: {}},
  }),
});

beforeEach(async () => {
  store().clear();
  talentRegistry.reset();
  resetCustomToolsForTests();
  for (const n of ['datetime', 'calculate', 'set_alarm']) {
    talentRegistry.register(fake(n) as any);
  }
  await replaceCustomTools([notes('v1')]);
});

describe('Toolbox switches', () => {
  it('switches one tool against the stored list, not an older copy', async () => {
    store().set(GLOBAL_TOOLS_KEY, JSON.stringify(['datetime']));
    // A screen that read [] earlier switches calculate on: datetime stays.
    expect(await setToolEnabled('calculate', true)).toEqual([
      'datetime',
      'calculate',
    ]);
    expect(await setToolEnabled('datetime', false)).toEqual(['calculate']);
    expect(stored()).toEqual(['calculate']);
    expect(await setToolsEnabled(['set_alarm', 'datetime'], true)).toEqual([
      'calculate',
      'set_alarm',
      'datetime',
    ]);
  });

  it('a tool a sync switched off stays off when the Toolbox toggles another', async () => {
    store().set(GLOBAL_TOOLS_KEY, JSON.stringify(['notes', 'datetime']));
    const shown = await readGlobalTools(); // the open Toolbox's copy
    expect(shown).toEqual(['notes', 'datetime']);
    await replaceCustomTools([notes('changed on another device')]);
    expect(stored()).toEqual(['datetime']);
    await setToolEnabled('calculate', true);
    expect(stored()).toEqual(['datetime', 'calculate']);
  });

  it('changes at the same moment as a sync are applied one after another', async () => {
    store().set(GLOBAL_TOOLS_KEY, JSON.stringify(['notes', 'datetime']));
    await Promise.all([
      setToolEnabled('datetime', false),
      replaceCustomTools([notes('changed')]),
      setToolEnabled('calculate', true),
    ]);
    expect(stored()).toEqual(['calculate']);
    // Same for a delete.
    store().set(GLOBAL_TOOLS_KEY, JSON.stringify(['notes']));
    await Promise.all([
      setToolEnabled('datetime', true),
      deleteCustomTool('notes'),
    ]);
    expect(stored()).toEqual(['datetime']);
  });

  it('unreadable switches count as none (fail-closed) and are replaced', async () => {
    store().set(GLOBAL_TOOLS_KEY, '{oops');
    expect(await setToolEnabled('datetime', true)).toEqual(['datetime']);
  });

  it('an open Toolbox hears about every stored change', async () => {
    const heard = jest.fn();
    const stop = onToolSwitchesChanged(heard);
    store().set(GLOBAL_TOOLS_KEY, JSON.stringify(['notes']));
    await replaceCustomTools([notes('changed')]);
    expect(heard).toHaveBeenCalledTimes(1);
    await setToolEnabled('datetime', true);
    expect(heard).toHaveBeenCalledTimes(2);
    // A sync that changes no switch says nothing.
    await replaceCustomTools([notes('changed')]);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    await setToolEnabled('datetime', false);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('a failed change does not block the next one', async () => {
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default;
    AsyncStorage.setItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(setToolEnabled('datetime', true)).rejects.toThrow('disk full');
    expect(await setToolEnabled('calculate', true)).toEqual(['calculate']);
  });
});
