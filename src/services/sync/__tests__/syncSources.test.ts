/**
 * Assistants and custom tools kept in step: assistants matched by id, then
 * by name (each device makes its own starter ones), added or updated (and
 * deleted only by a deletion in the list: see assistantSync.test.ts);
 * device-only parts never travel; tools go through the usual checks.
 */
const mockStorage: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStorage[k] ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    mockStorage[k] = v;
  }),
}));
const mockPals: any[] = [];
const mockUpdate = jest.fn(async (id: string, fields: any) => {
  Object.assign(
    mockPals.find(p => p.id === id),
    fields,
  );
});
const mockCreate = jest.fn(async (data: any, id?: string) => {
  mockPals.push({...data, id: id ?? 'new-id'});
});
jest.mock('../../../store', () => ({
  palStore: {
    get pals() {
      return mockPals;
    },
    updatePal: (...a: any[]) => mockUpdate(...(a as [string, any])),
    reloadFromDatabase: jest.fn(async () => {}),
  },
}));
jest.mock('../../../repositories/PalRepository', () => ({
  palRepository: {createPal: (...a: any[]) => mockCreate(...(a as [any]))},
}));
const mockReplaceTools = jest.fn(async () => {});
jest.mock('../../talents/customTools', () => ({
  listCustomTools: async () => [{name: 'zeta'}, {name: 'alpha'}],
  replaceCustomTools: (...a: any[]) => mockReplaceTools(...(a as [])),
}));

import {
  readAssistants,
  readCustomTools,
  writeAssistants,
  writeCustomTools,
} from '../syncSources';

beforeEach(() => {
  for (const k of Object.keys(mockStorage)) {
    delete mockStorage[k];
  }
  mockPals.length = 0;
  mockUpdate.mockClear();
  mockCreate.mockClear();
});

it("sends only one's own assistants, without device-only parts", async () => {
  mockPals.push(
    {
      id: 'b',
      name: 'Coder',
      systemPrompt: 'Code.',
      source: 'local',
      defaultModel: {id: 'm'},
      thumbnail_url: '/x.png',
    },
    {id: 'a', name: 'Bought', systemPrompt: 'Hi.', source: 'palshub'},
  );
  const list = JSON.parse(await readAssistants());
  expect(list).toEqual([
    {
      id: 'b',
      name: 'Coder',
      systemPrompt: 'Code.',
      editedAt: expect.any(Number),
    },
  ]);
});

it('matches by id, then by name; adds new ones with the same id; deletes nothing unasked', async () => {
  mockPals.push(
    {id: 'p1', name: 'Coder', systemPrompt: 'old', source: 'local'},
    {id: 'local-lookie', name: 'Lookie', systemPrompt: 'look', source: 'local'},
    {id: 'only-here', name: 'Mine', systemPrompt: 'mine', source: 'local'},
  );
  await writeAssistants(
    JSON.stringify([
      {id: 'p1', name: 'Coder', systemPrompt: 'new'},
      {id: 'other-lookie', name: 'Lookie', systemPrompt: 'look'},
      {id: 'p9', name: 'Writer', systemPrompt: 'write'},
    ]),
  );
  expect(mockUpdate).toHaveBeenCalledWith('p1', {
    name: 'Coder',
    systemPrompt: 'new',
  });
  // Same name, same content: no duplicate, nothing to change.
  expect(mockPals.filter(p => p.name === 'Lookie')).toHaveLength(1);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockCreate.mock.calls[0][1]).toBe('p9');
  expect(mockPals.find(p => p.id === 'only-here')).toBeTruthy();
});

it('never rewrites a downloaded (store) assistant, by id or by name', async () => {
  mockPals.push({
    id: 'hub1',
    name: 'Tutor',
    systemPrompt: 'teach',
    source: 'palshub',
  });
  await writeAssistants(
    JSON.stringify([
      {id: 'hub1', name: 'Tutor', systemPrompt: 'evil', pact: 'x'},
      {id: 'mine2', name: 'Tutor', systemPrompt: 'my own tutor'},
    ]),
  );
  expect(mockUpdate).not.toHaveBeenCalled();
  // Same id as the store one: not taken. Same name only: added as your own.
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockCreate.mock.calls[0][1]).toBe('mine2');
  expect(mockCreate.mock.calls[0][0]).toMatchObject({source: 'local'});
});

it('custom tools travel as one sorted list and are checked on arrival', async () => {
  expect(JSON.parse(await readCustomTools()).map((t: any) => t.name)).toEqual([
    'alpha',
    'zeta',
  ]);
  await writeCustomTools(JSON.stringify([{name: 'x'}]));
  expect(mockReplaceTools).toHaveBeenCalledWith([{name: 'x'}]);
});
