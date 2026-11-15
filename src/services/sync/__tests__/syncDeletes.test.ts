/**
 * Both ends, with chats mirrored: a chat deleted on the phone is removed on
 * the PC at the next sync (kept there under Recently deleted), and doesn't
 * come back; a chat deleted on the PC is removed on the phone, and the sync
 * says so. Each device has its own chats and storage here.
 */
import {NativeModules} from 'react-native';

type Chat = {session: any; messages: any[]};
const mockDevices: Record<
  'phone' | 'pc',
  {chats: Map<string, Chat>; storage: Record<string, string>}
> = {
  phone: {chats: new Map(), storage: {}},
  pc: {chats: new Map(), storage: {}},
};
const mockOn = {current: 'phone' as 'phone' | 'pc'};
const mockHere = () => mockDevices[mockOn.current];

jest.mock('../../../database', () => ({database: {}}));
jest.mock('../chatSync', () => {
  const actual = jest.requireActual('../chatSync');
  return {
    ...actual,
    readAllChats: async () => new Map(mockHere().chats),
    writeChats: async (list: Chat[]) => {
      list.forEach(c => mockHere().chats.set(c.session.id, c));
    },
  };
});
jest.mock('../../../repositories/ChatSessionRepository', () => ({
  chatSessionRepository: {
    deleteSessions: async (ids: string[]) => {
      ids.forEach(id => mockHere().chats.delete(id));
    },
  },
}));
jest.mock('../../../store', () => ({
  chatSessionStore: {
    activeSessionId: undefined,
    resetActiveSession: jest.fn(),
    loadSessionList: jest.fn(async () => {}),
  },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (k: string) => mockHere().storage[k] ?? null,
  setItem: async (k: string, v: string) => {
    mockHere().storage[k] = v;
  },
}));
jest.mock('../promptSync', () => {
  const actual = jest.requireActual('../promptSync');
  const items = [{key: 'systemPrompt', text: 'Be brief.', updatedAt: 1}];
  return {
    ...actual,
    readItems: async () => items,
    applyItems: async () => [],
  };
});
jest.mock('@tauri-apps/api/core', () => ({invoke: jest.fn()}));
jest.mock('@tauri-apps/api/event', () => ({listen: jest.fn()}));

import {
  recordChatsDeleted,
  recentlyDeleted,
  restoreDeleted,
} from '../chatDeletes';
import {setMirrorChats, syncWithPc} from '../deviceSync';
import {answerSync} from '../hostSync.web';

const chat = (id: string, at: number): Chat => ({
  session: {id, title: id, pinned: false, updated_at: at},
  messages: [
    {
      id: `${id}-m0`,
      session_id: id,
      author: 'y9d7f8pgn',
      type: 'text',
      text: 'hi',
      position: 0,
      created_at: at,
    },
  ],
});

beforeEach(() => {
  for (const d of Object.values(mockDevices)) {
    d.chats.clear();
    for (const k of Object.keys(d.storage)) {
      delete d.storage[k];
    }
  }
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k === 'pa-link-mirror' ? 'on' : null),
    setItem: () => {},
  };
  (NativeModules as any).HomeLink = {
    sync: jest.fn(async (_pc: string, body: string) => {
      mockOn.current = 'pc';
      try {
        return await answerSync(body, 'Pixel');
      } finally {
        mockOn.current = 'phone';
      }
    }),
  };
  mockOn.current = 'phone';
});
afterEach(() => {
  delete (NativeModules as any).HomeLink;
  delete (globalThis as any).localStorage;
});

it('a chat deleted on the phone goes on the PC too, kept there 30 days', async () => {
  const t = Date.now() - 60_000;
  for (const d of Object.values(mockDevices)) {
    d.chats.set('a', chat('a', t));
    d.chats.set('b', chat('b', t));
  }
  await setMirrorChats('pc1', true);
  mockDevices.phone.chats.delete('a');
  await recordChatsDeleted(['a']);

  const r = await syncWithPc('pc1');
  expect(r).toMatchObject({ok: true, chatsDeleted: 0});
  expect([...mockDevices.pc.chats.keys()]).toEqual(['b']);
  expect([...mockDevices.phone.chats.keys()]).toEqual(['b']);
  mockOn.current = 'pc';
  const kept = await recentlyDeleted();
  expect(kept.map(k => [k.chat.session.id, k.from])).toEqual([['a', 'Pixel']]);
  mockOn.current = 'phone';

  // And it doesn't come back at the next sync.
  await syncWithPc('pc1');
  expect([...mockDevices.phone.chats.keys()]).toEqual(['b']);
  expect([...mockDevices.pc.chats.keys()]).toEqual(['b']);
});

it('a chat deleted on the PC goes on the phone, unless changed there since', async () => {
  const t = Date.now() - 60_000;
  for (const d of Object.values(mockDevices)) {
    d.chats.set('a', chat('a', t));
  }
  mockDevices.phone.chats.set('b', chat('b', t));
  mockDevices.pc.chats.set('b', chat('b', t));
  await setMirrorChats('pc1', true);
  await syncWithPc('pc1');

  mockOn.current = 'pc';
  mockDevices.pc.chats.delete('a');
  mockDevices.pc.chats.delete('b');
  await recordChatsDeleted(['a', 'b']);
  mockOn.current = 'phone';
  // 'b' got a reply on the phone after the PC deleted it: it stays.
  const replied = chat('b', t);
  replied.messages.push({
    id: 'b-m1',
    session_id: 'b',
    author: 'h3o3lc5xj',
    type: 'text',
    text: 'later reply',
    position: 1,
    created_at: Date.now() + 5000,
  });
  mockDevices.phone.chats.set('b', replied);

  const r = await syncWithPc('pc1');
  expect(r).toMatchObject({ok: true, chatsDeleted: 1, chatsHeld: 0});
  expect([...mockDevices.phone.chats.keys()]).toEqual(['b']);
  expect((await recentlyDeleted()).map(k => k.chat.session.id)).toEqual(['a']);
  // ...and goes back to the PC (the newer edit wins).
  expect([...mockDevices.pc.chats.keys()]).toEqual(['b']);
});

it('a restored chat comes back on the device that deleted it', async () => {
  const t = Date.now() - 60_000;
  for (const d of Object.values(mockDevices)) {
    d.chats.set('a', chat('a', t));
  }
  await setMirrorChats('pc1', true);
  await syncWithPc('pc1');
  mockOn.current = 'pc';
  mockDevices.pc.chats.delete('a');
  await recordChatsDeleted(['a']);
  mockOn.current = 'phone';
  await syncWithPc('pc1');
  expect(mockDevices.phone.chats.size).toBe(0);

  expect(await restoreDeleted('a')).toBe(true);
  await syncWithPc('pc1');
  expect([...mockDevices.phone.chats.keys()]).toEqual(['a']);
  expect([...mockDevices.pc.chats.keys()]).toEqual(['a']);
});

it('a forged copy from a device: no file paths or odd authors, the PC keeps its earlier version', async () => {
  const t = Date.now() - 60_000;
  const long = chat('a', t);
  long.messages.push(
    ...[1, 2, 3].map(i => ({
      id: `a-m${i}`,
      session_id: 'a',
      author: 'h3o3lc5xj',
      type: 'text',
      text: `reply ${i}`,
      position: i,
      created_at: t + i,
    })),
  );
  mockDevices.pc.chats.set('a', long);
  const forged = {
    session: {id: 'a', title: 'a', pinned: false, updated_at: 9e15},
    messages: [
      {
        id: 'a-m0',
        session_id: 'a',
        author: 'y9d7f8pgn',
        type: 'text',
        text: 'look at this',
        position: 0,
        created_at: 9e15,
        metadata: JSON.stringify({
          imageUris: ['file:///pocketagent/link/client.key'],
        }),
      },
      {id: 'z', session_id: 'a', author: 'evil', type: 'text', text: 'x'},
    ],
  };
  mockOn.current = 'pc';
  const reply = JSON.parse(
    await answerSync(
      JSON.stringify({
        items: [],
        chats: {versions: [], sessions: [forged], tombstones: []},
      }),
      'Pixel',
    ),
  );
  expect(reply.ok).toBe(true);
  const now = mockDevices.pc.chats.get('a')!;
  expect(now.messages.map(m => m.id)).toEqual(['a-m0']);
  expect(JSON.parse(now.messages[0].metadata)).toEqual({});
  expect(now.session.updated_at).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  const kept = await recentlyDeleted();
  expect(kept).toHaveLength(1);
  expect(kept[0]).toMatchObject({from: 'Pixel', replaced: true});
  expect(kept[0].chat.messages).toHaveLength(4);
  expect(await restoreDeleted('a')).toBe(true);
  expect(mockDevices.pc.chats.get('a')!.messages).toHaveLength(4);
  mockOn.current = 'phone';
});
