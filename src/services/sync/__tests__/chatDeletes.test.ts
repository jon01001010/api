/**
 * Deleting a chat travels with mirrored chats: a tombstone removes the other
 * device's copy only if it has not changed since; the removed copy is kept
 * 30 days under Recently deleted and can be restored; too many at once are
 * asked first; odd tombstones are ignored.
 */
jest.mock('../../../database', () => ({database: {}}));
import {Alert} from 'react-native';

import {
  applyTombstones,
  askAboutHeld,
  cleanTombstones,
  DELETE_CAP,
  describeDeletes,
  keepEarlierVersions,
  keepHeld,
  RECENT_ROOM,
  knownTombstones,
  MAX_TOMBSTONES,
  pruneTombstones,
  recentlyDeleted,
  recordChatsDeleted,
  restoreDeleted,
  type DeleteStore,
  type RecentlyDeleted,
} from '../chatDeletes';
import {
  mirrorOnPc,
  versionOf,
  type ChatRecord,
  type Tombstone,
} from '../chatSync';
import {MAX_CLOCK_SKEW} from '../promptSync';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

const chat = (id: string, texts: string[], at: number): ChatRecord => ({
  session: {id, title: id, pinned: false, updated_at: at},
  messages: texts.map((t, i) => ({
    id: `${id}-m${i}`,
    session_id: id,
    author: 'y9d7f8pgn',
    type: 'text',
    text: t,
    position: i,
    created_at: at,
    metadata: '{}',
  })),
});

/** A device: its chats, tombstones and Recently deleted, in memory. */
function device(chats: ChatRecord[] = []) {
  const state = {
    chats: new Map(chats.map(c => [c.session.id, c])),
    tombstones: [] as Tombstone[],
    recent: [] as RecentlyDeleted[],
    now: NOW,
  };
  const store: DeleteStore = {
    now: () => state.now,
    loadTombstones: async () => state.tombstones,
    saveTombstones: async l => {
      state.tombstones = l;
    },
    loadRecent: async () => state.recent,
    saveRecent: async l => {
      state.recent = l;
    },
    removeChats: async ids => {
      ids.forEach(id => state.chats.delete(id));
    },
    write: async list => {
      list.forEach(c => state.chats.set(c.session.id, c));
    },
  };
  return {state, store};
}

it('ignores odd tombstones and keeps the latest per chat', () => {
  expect(
    cleanTombstones(
      [
        {id: 'a', deletedAt: 5},
        {id: 'a', deletedAt: 9},
        {id: '../x', deletedAt: 5},
        {id: 'b', deletedAt: 'soon'},
        {id: 'c', deletedAt: -1},
        {id: 'd', deletedAt: NOW + 2 * DAY},
        null,
        'e',
      ],
      NOW,
    ),
  ).toEqual([{id: 'a', deletedAt: 9}]);
  expect(cleanTombstones('nope', NOW)).toEqual([]);
});

it('keeps tombstones bounded (newest 500, 90 days)', () => {
  const many = Array.from({length: 600}, (_, i) => ({
    id: `c${i}`,
    deletedAt: NOW - i * 1000,
  }));
  const kept = pruneTombstones(
    [...many, {id: 'old', deletedAt: NOW - 91 * DAY}],
    NOW,
  );
  expect(kept).toHaveLength(MAX_TOMBSTONES);
  expect(kept[0].id).toBe('c0');
  expect(kept.find(t => t.id === 'old')).toBeUndefined();
});

it('records a deletion made here', async () => {
  const {state, store} = device();
  await recordChatsDeleted(['x', 'bad id!'], store);
  expect(state.tombstones).toEqual([{id: 'x', deletedAt: NOW}]);
  expect(await knownTombstones(store)).toEqual([{id: 'x', deletedAt: NOW}]);
});

it('removes an unchanged copy, keeps it under Recently deleted, and remembers', async () => {
  const unchanged = chat('gone', ['hi'], NOW - 5000);
  const {state, store} = device([unchanged, chat('other', ['x'], 1)]);
  const r = await applyTombstones(
    new Map(state.chats),
    [
      {id: 'gone', deletedAt: NOW - 1000},
      {id: 'neverHere', deletedAt: NOW - 1000},
    ],
    'the PC',
    store,
  );
  expect(r.deleted).toEqual(['gone']);
  expect([...state.chats.keys()]).toEqual(['other']);
  expect(state.recent).toEqual([
    {chat: unchanged, deletedAt: NOW - 1000, removedAt: NOW, from: 'the PC'},
  ]);
  // Both remembered, so this device doesn't bring them back elsewhere.
  expect(state.tombstones.map(t => t.id).sort()).toEqual(['gone', 'neverHere']);
  expect(describeDeletes(1, 'the PC')).toBe(
    '1 chat deleted on the PC; kept 30 days under Recently deleted',
  );
});

it('a newer edit wins over a deletion', async () => {
  const edited = chat('c', ['hi', 'later reply'], NOW - 100);
  const {state, store} = device([edited]);
  const r = await applyTombstones(
    new Map(state.chats),
    [{id: 'c', deletedAt: NOW - 1000}],
    'the PC',
    store,
  );
  expect(r).toEqual({deleted: [], held: [], survived: ['c']});
  expect(state.chats.get('c')).toBe(edited);
  expect(state.tombstones).toEqual([]);
  expect(state.recent).toEqual([]);
});

it('more than the cap at once: nothing removed, the user is asked', async () => {
  const chats = Array.from({length: DELETE_CAP + 1}, (_, i) =>
    chat(`c${i}`, ['x'], NOW - 5000),
  );
  const {state, store} = device(chats);
  const tombs = chats.map(c => ({id: c.session.id, deletedAt: NOW - 1}));
  const r = await applyTombstones(new Map(state.chats), tombs, 'Pixel', store);
  expect(r.deleted).toEqual([]);
  expect(r.held).toHaveLength(DELETE_CAP + 1);
  expect(state.chats.size).toBe(DELETE_CAP + 1);
  expect(state.tombstones).toEqual([]);

  // Asked once (a second sync meanwhile doesn't ask again); "Delete" removes them all.
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const done = jest.fn();
  askAboutHeld(r.held, 'Pixel', done, store);
  askAboutHeld(r.held, 'Pixel', done, store);
  expect(alert).toHaveBeenCalledTimes(1);
  const buttons: any[] = alert.mock.calls[0][2] as any[];
  buttons.find(b => b.text === 'Delete').onPress();
  await new Promise(res => setImmediate(res));
  expect(state.chats.size).toBe(0);
  expect(state.recent).toHaveLength(DELETE_CAP + 1);
  expect(done).toHaveBeenCalledWith({
    deleted: expect.arrayContaining(['c0']),
    kept: [],
  });
  alert.mockRestore();
});

it('keeping held chats makes them newer than the deletion', async () => {
  const c = chat('c', ['x'], NOW - 5000);
  const {state, store} = device([c]);
  state.tombstones = [{id: 'c', deletedAt: NOW - 1}];
  state.now = NOW + 10;
  await keepHeld([{chat: c, deletedAt: NOW - 1}], store);
  expect(state.chats.get('c')!.session.updated_at).toBe(NOW + 10);
  expect(state.tombstones).toEqual([]);
  expect(versionOf(state.chats.get('c')!).at).toBeGreaterThan(NOW - 1);
});

it('restores a recently deleted chat, newer than its deletion', async () => {
  const c = chat('c', ['keep me'], NOW - 5000);
  const {state, store} = device([c]);
  await applyTombstones(
    new Map(state.chats),
    [{id: 'c', deletedAt: NOW - 1000}],
    'the PC',
    store,
  );
  expect(state.chats.has('c')).toBe(false);
  state.now = NOW + 60_000;
  expect(await restoreDeleted('c', store)).toBe(true);
  const back = state.chats.get('c')!;
  expect(back.messages).toEqual(c.messages);
  expect(back.session.updated_at).toBe(NOW + 60_000);
  expect(state.recent).toEqual([]);
  expect(state.tombstones).toEqual([]);
  expect(await restoreDeleted('c', store)).toBe(false);
});

it('Recently deleted keeps 30 days', async () => {
  const {state, store} = device();
  state.recent = [
    {
      chat: chat('a', [], 1),
      deletedAt: 1,
      removedAt: NOW - 31 * DAY,
      from: 'x',
    },
    {chat: chat('b', [], 1), deletedAt: 1, removedAt: NOW - DAY, from: 'x'},
  ];
  expect((await recentlyDeleted(store)).map(r => r.chat.session.id)).toEqual([
    'b',
  ]);
  expect(state.recent).toHaveLength(1);
});

it('the PC does not take or send back a chat deleted after its last change', async () => {
  const pcChats = new Map([
    ['kept', chat('kept', ['a'], 1000)],
    ['held', chat('held', ['b'], 1000)],
  ]);
  const written: ChatRecord[] = [];
  const r = await mirrorOnPc(
    [chat('deleted', ['old'], 1000), chat('revived', ['new'], 9000)],
    [],
    1e6,
    {
      read: async () => pcChats,
      write: async c => {
        written.push(...c);
      },
    },
    {
      tombstones: [
        {id: 'deleted', deletedAt: 5000},
        {id: 'revived', deletedAt: 5000},
      ],
      hold: new Set(['held']),
    },
  );
  expect(written.map(c => c.session.id)).toEqual(['revived']);
  expect(r.revived).toEqual(['revived']);
  expect(r.send.map(c => c.session.id)).toEqual(['kept']);
});

it('a deletion time more than a few minutes ahead is ignored', () => {
  expect(
    cleanTombstones(
      [
        {id: 'soon', deletedAt: NOW + MAX_CLOCK_SKEW},
        {id: 'later', deletedAt: NOW + MAX_CLOCK_SKEW + 1},
        {id: 'far', deletedAt: 9e15},
      ],
      NOW,
    ).map(t => t.id),
  ).toEqual(['soon']);
});

describe('a mirrored copy that replaces a chat here', () => {
  it('keeps the earlier version when the copy drops messages; restorable', async () => {
    const here = chat('c', ['a', 'b', 'c', 'd'], NOW - 1000);
    const {state, store} = device([here]);
    const forged = chat('c', ['x'], NOW);
    const ok = await keepEarlierVersions(
      new Map([['c', here]]),
      [forged],
      'Pixel',
      store,
    );
    expect(ok).toEqual([forged]);
    expect(state.recent).toHaveLength(1);
    expect(state.recent[0]).toMatchObject({from: 'Pixel', replaced: true});
    expect(state.recent[0].chat.messages.map(m => m.text)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    // Written over, then restored: the earlier messages are back, newer.
    await store.write(ok);
    state.now = NOW + 10;
    expect(await restoreDeleted('c', store)).toBe(true);
    const back = state.chats.get('c')!;
    expect(back.messages.map(m => m.text)).toEqual(['a', 'b', 'c', 'd']);
    expect(back.session.updated_at).toBe(NOW + 10);
  });

  it('a copy that only adds messages keeps nothing', async () => {
    const here = chat('c', ['a'], NOW - 1000);
    const {state, store} = device([here]);
    const grown = chat('c', ['a', 'b'], NOW - 1000);
    expect(
      await keepEarlierVersions(
        new Map([['c', here]]),
        [grown],
        'Pixel',
        store,
      ),
    ).toEqual([grown]);
    expect(state.recent).toEqual([]);
  });

  it('no room to keep the earlier version: the copy is not taken', async () => {
    const big = chat('c', ['y'.repeat(RECENT_ROOM)], NOW - 1000);
    const {state, store} = device([big]);
    const newChat = chat('n', ['new'], NOW);
    expect(
      await keepEarlierVersions(
        new Map([['c', big]]),
        [chat('c', [], NOW), newChat],
        'Pixel',
        store,
      ),
    ).toEqual([newChat]);
    expect(state.recent).toEqual([]);
  });
});
