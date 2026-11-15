/**
 * "Recently deleted" can't be undone by later syncs (security review 2,
 * finding 3): up to 3 versions of a chat are kept and the first one is
 * never dropped; room is counted in UTF-8 bytes; the list is stored in
 * parts well under Android's 2 MB read window; a list that can't be read
 * is never saved over (nothing is removed or replaced then). The same safe
 * read for assistants and loops.
 */
const mockStorage: Record<string, string> = {};
const mockFail = {get: false};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (k: string) => {
    if (mockFail.get) {
      throw new Error('Row too big to fit into CursorWindow');
    }
    return mockStorage[k] ?? null;
  },
  setItem: async (k: string, v: string) => {
    mockStorage[k] = v;
  },
  removeItem: async (k: string) => {
    delete mockStorage[k];
  },
}));
jest.mock('../../../database', () => ({database: {}}));

import {
  applyTombstones,
  deviceStore,
  entryKey,
  keepEarlierVersions,
  MAX_VERSIONS,
  RECENT_KEY,
  RECENT_KEY_V2,
  RECENT_ROOM,
  recentlyDeleted,
  restoreDeleted,
  trimVersions,
  type DeleteStore,
  type RecentlyDeleted,
} from '../chatDeletes';
import type {ChatRecord, Tombstone} from '../chatSync';
import {
  CHUNK_BYTES,
  jsonBytes,
  loadChunked,
  readStrict,
  saveChunked,
  UnreadableStore,
  utf8Bytes,
} from '../keptStore';
import {
  applyAssistantTombstones,
  RECENT_KEY as ASSISTANT_RECENT_KEY,
  deviceAssistantStore,
  type AssistantDeleteStore,
} from '../assistantDeletes';
import {
  applyLoopTombstones,
  LOOP_RECENT_KEY,
  deviceLoopStore,
  type LoopSyncStore,
} from '../loopSync';

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

beforeEach(() => {
  for (const k of Object.keys(mockStorage)) {
    delete mockStorage[k];
  }
  mockFail.get = false;
});

const first = (r: RecentlyDeleted) => r.chat.messages[0]?.text;

describe('versions', () => {
  it('two replacements in a row (then a deletion) keep the original', async () => {
    const original = chat('c', ['a', 'b', 'c'], NOW - 1000);
    const {state, store} = device([original]);
    const junk1 = chat('c', ['junk 1'], NOW);
    await keepEarlierVersions(
      new Map([['c', original]]),
      [junk1],
      'Pixel',
      store,
    );
    state.now = NOW + 10;
    const junk2 = chat('c', ['junk 2'], NOW + 10);
    await keepEarlierVersions(new Map([['c', junk1]]), [junk2], 'Pixel', store);
    state.now = NOW + 20;
    state.chats.set('c', junk2);
    await applyTombstones(
      new Map([['c', junk2]]),
      [{id: 'c', deletedAt: NOW + 15}],
      'Pixel',
      store,
    );
    expect(state.recent.map(first)).toEqual(['junk 2', 'junk 1', 'a']);

    // Many more: at most 3, and the original is never the one dropped.
    for (let i = 3; i < 8; i++) {
      state.now = NOW + 100 * i;
      await keepEarlierVersions(
        new Map([['c', chat('c', [`junk ${i - 1}`], NOW)]]),
        [chat('c', [`junk ${i}`], NOW + 100 * i)],
        'Pixel',
        store,
      );
    }
    expect(state.recent).toHaveLength(MAX_VERSIONS);
    expect(state.recent.map(first)).toEqual(['junk 6', 'junk 5', 'a']);

    // Each version is restorable on its own.
    const orig = state.recent.find(r => first(r) === 'a')!;
    expect(await restoreDeleted(entryKey(orig), store)).toBe(true);
    expect(state.chats.get('c')!.messages.map(m => m.text)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(state.recent.map(first)).toEqual(['junk 6', 'junk 5']);
  });

  it('trimVersions keeps the newest and the oldest of each chat', () => {
    const v = (id: string, at: number): RecentlyDeleted => ({
      chat: chat(id, [String(at)], at),
      deletedAt: at,
      removedAt: at,
      from: 'x',
    });
    const list = [v('c', 5), v('c', 4), v('d', 4), v('c', 3), v('c', 1)];
    expect(
      trimVersions(list).map(r => `${r.chat.session.id}${r.removedAt}`),
    ).toEqual(['c5', 'c4', 'd4', 'c1']);
  });
});

describe('a list that cannot be read is never saved over', () => {
  it('in the sync logic: nothing replaced, nothing removed, nothing saved', async () => {
    const here = chat('c', ['a', 'b'], NOW - 5000);
    const {state, store} = device([here, chat('gone', ['x'], NOW - 5000)]);
    const kept: RecentlyDeleted = {
      chat: chat('old', ['keep'], 1),
      deletedAt: 1,
      removedAt: NOW,
      from: 'x',
    };
    state.recent = [kept];
    const save = jest.fn();
    const broken: DeleteStore = {
      ...store,
      loadRecent: async () => {
        throw new UnreadableStore('x');
      },
      saveRecent: save,
    };
    const fresh = chat('n', ['new'], NOW);
    expect(
      await keepEarlierVersions(
        new Map([['c', here]]),
        [chat('c', ['x'], NOW), fresh],
        'Pixel',
        broken,
      ),
    ).toEqual([fresh]);
    const r = await applyTombstones(
      new Map(state.chats),
      [{id: 'gone', deletedAt: NOW - 1000}],
      'Pixel',
      broken,
    );
    expect(r.deleted).toEqual([]);
    expect(state.chats.has('gone')).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(state.recent).toEqual([kept]);
    await expect(recentlyDeleted(broken)).rejects.toThrow();
  });

  it('on the device store: a failed read throws, and the stored list stays', async () => {
    const kept = [
      {chat: chat('old', ['keep'], 1), deletedAt: 1, removedAt: NOW, from: 'x'},
    ];
    await deviceStore.saveRecent(kept);
    const before = {...mockStorage};
    mockFail.get = true;
    await expect(deviceStore.loadRecent()).rejects.toBeInstanceOf(
      UnreadableStore,
    );
    const here = chat('c', ['a'], NOW - 5000);
    expect(
      await keepEarlierVersions(
        new Map([['c', here]]),
        [chat('c', [], NOW)],
        'Pixel',
        {...deviceStore, now: () => NOW},
      ),
    ).toEqual([]);
    expect(mockStorage).toEqual(before);
    mockFail.get = false;
    expect(await deviceStore.loadRecent()).toEqual(kept);
  });

  it('garbage or a missing part counts as unreadable, not empty', async () => {
    mockStorage.k = '{not json';
    await expect(readStrict('k', [])).rejects.toBeInstanceOf(UnreadableStore);
    mockStorage.k = '{"a":1}';
    await expect(readStrict('k', [])).rejects.toBeInstanceOf(UnreadableStore);
    expect(await readStrict('missing', ['x'])).toEqual(['x']);
    mockStorage.idx = JSON.stringify({gen: 3, chunks: 2});
    mockStorage['idx/chunk/3/0'] = '[1]';
    await expect(loadChunked('idx')).rejects.toBeInstanceOf(UnreadableStore);
  });

  it('assistants and loops: a failed read removes nothing', async () => {
    mockFail.get = true;
    await expect(
      deviceAssistantStore.load(ASSISTANT_RECENT_KEY, []),
    ).rejects.toBeInstanceOf(UnreadableStore);
    await expect(
      deviceLoopStore.load(LOOP_RECENT_KEY, []),
    ).rejects.toBeInstanceOf(UnreadableStore);
    // Other keys keep their fallback (a lost tombstone only loses a deletion).
    expect(await deviceLoopStore.load('other', 7)).toBe(7);
    mockFail.get = false;

    const removed: string[] = [];
    const pal = {id: 'p1', name: 'Helper', source: 'local'} as any;
    const aStore: AssistantDeleteStore = {
      now: () => NOW,
      load: async (key, fallback) => {
        if (key === ASSISTANT_RECENT_KEY) {
          throw new UnreadableStore(key);
        }
        return fallback;
      },
      save: jest.fn(async () => {}),
      ownPals: () => [pal],
      remove: async id => {
        removed.push(id);
      },
      recreate: async () => {},
      dropPicture: async () => {},
    };
    const a = await applyAssistantTombstones(
      [{id: 'p1', deletedAt: NOW}],
      new Set(),
      'Pixel',
      aStore,
    );
    expect(a.deleted).toEqual([]);
    expect(removed).toEqual([]);
    expect(aStore.save).not.toHaveBeenCalledWith(
      ASSISTANT_RECENT_KEY,
      expect.anything(),
    );

    const loop = {
      id: 'l1',
      title: 'Daily',
      log: [],
      runs: 0,
      createdAt: NOW - 10_000,
    } as any;
    const saveLoops = jest.fn(async () => {});
    const lStore: LoopSyncStore = {
      now: () => NOW,
      load: async (key, fallback) => {
        if (key === LOOP_RECENT_KEY) {
          throw new UnreadableStore(key);
        }
        return fallback;
      },
      save: jest.fn(async () => {}),
      loadLoops: async () => [loop],
      saveLoops,
    };
    const l = await applyLoopTombstones(
      [{id: 'l1', deletedAt: NOW}],
      new Set(),
      'Pixel',
      lStore,
    );
    expect(l.deleted).toEqual([]);
    expect(saveLoops).not.toHaveBeenCalled();
    // Readable: the same deletion goes through (kept first).
    const ok = await applyLoopTombstones(
      [{id: 'l1', deletedAt: NOW}],
      new Set(),
      'Pixel',
      {...lStore, load: async (_k, fallback) => fallback},
    );
    expect(ok.deleted).toEqual(['l1']);
    expect(lStore.save).toHaveBeenCalledWith(LOOP_RECENT_KEY, [
      expect.objectContaining({from: 'Pixel'}),
    ]);
    const okA = await applyAssistantTombstones(
      [{id: 'p1', deletedAt: NOW}],
      new Set(),
      'Pixel',
      {...aStore, load: async (_k, fallback) => fallback},
    );
    expect(okA.deleted).toEqual(['p1']);
  });
});

describe('sizes in UTF-8 bytes, stored in parts', () => {
  it('counts UTF-8 bytes', () => {
    expect(utf8Bytes('abc')).toBe(3);
    expect(utf8Bytes('é')).toBe(2);
    expect(utf8Bytes('漢')).toBe(3);
    expect(utf8Bytes('😀')).toBe(4);
    expect(utf8Bytes('漢'.repeat(1000))).toBe(3000);
  });

  it('room for non-Latin text is counted in bytes, not characters', async () => {
    // 400,000 CJK characters: 1.2 MB in UTF-8, too big for one stored part.
    const big = chat('c', ['漢'.repeat(400_000)], NOW - 1000);
    const {state, store} = device([big]);
    expect(
      await keepEarlierVersions(
        new Map([['c', big]]),
        [chat('c', [], NOW)],
        'Pixel',
        store,
      ),
    ).toEqual([]);
    expect(state.recent).toEqual([]);
    // Two of 250,000 (750 KB each): the first fits, not both (1.5 MB room).
    const a = chat('a', ['字'.repeat(250_000)], NOW - 1000);
    const b = chat('b', ['字'.repeat(250_000)], NOW - 1000);
    const ok = await keepEarlierVersions(
      new Map([
        ['a', a],
        ['b', b],
      ]),
      [chat('a', [], NOW), chat('b', [], NOW)],
      'Pixel',
      store,
    );
    expect(ok.map(c => c.session.id)).toEqual(['a']);
    expect(jsonBytes(state.recent)).toBeLessThanOrEqual(RECENT_ROOM);
  });

  it('no stored value comes near 2 MB, and the list reads back whole', async () => {
    const entries = [1, 2, 3, 4].map(i => ({
      chat: chat(`c${i}`, ['字'.repeat(100_000)], NOW),
      deletedAt: NOW,
      removedAt: NOW - i,
      from: 'x',
    }));
    await deviceStore.saveRecent(entries);
    for (const v of Object.values(mockStorage)) {
      expect(utf8Bytes(v)).toBeLessThanOrEqual(CHUNK_BYTES);
    }
    expect(Object.keys(mockStorage).length).toBeGreaterThan(2);
    expect(await deviceStore.loadRecent()).toEqual(entries);
    // Saving again replaces the parts (old ones removed).
    await deviceStore.saveRecent(entries.slice(0, 1));
    expect(await deviceStore.loadRecent()).toEqual(entries.slice(0, 1));
    expect(
      Object.keys(mockStorage).filter(k => k.startsWith(RECENT_KEY_V2)),
    ).toHaveLength(2);
  });

  it('a list from before (one value) is read, then moved to parts', async () => {
    const old = [
      {chat: chat('a', ['x'], 1), deletedAt: 1, removedAt: NOW, from: 'x'},
    ];
    mockStorage[RECENT_KEY] = JSON.stringify(old);
    expect(await deviceStore.loadRecent()).toEqual(old);
    await saveChunked(RECENT_KEY_V2, old, RECENT_KEY);
    expect(mockStorage[RECENT_KEY]).toBeUndefined();
    expect(await deviceStore.loadRecent()).toEqual(old);
  });
});
