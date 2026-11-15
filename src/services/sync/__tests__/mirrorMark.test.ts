/**
 * Messages that came from another device carry a local mark (security
 * review 2, finding 5): added when a sync writes a chat, kept off messages
 * that were typed here and came back unchanged, never travelling (it
 * doesn't change a chat's version), and not added when a kept version is
 * restored.
 */
type Row = {id: string; _raw: Record<string, any>};
const mockDb = {
  sessions: new Map<string, Row>(),
  messages: new Map<string, Row>(),
};
jest.mock('../../../database', () => {
  const table = (name: 'sessions' | 'messages') => ({
    find: async (id: string) => {
      const r = mockDb[name].get(id);
      if (!r) {
        throw new Error('not found');
      }
      return {
        ...r,
        prepareUpdate: (fn: (x: any) => void) => () => fn(r),
      };
    },
    // Every test chat is 'c' (the query's own shape is mocked elsewhere).
    query: () => ({
      fetch: async () =>
        [...mockDb[name].values()]
          .filter(r => r._raw.session_id === 'c')
          .map(r => ({
            ...r,
            prepareDestroyPermanently: () => () => mockDb[name].delete(r.id),
          })),
    }),
    prepareCreate: (fn: (x: any) => void) => () => {
      const r: Row = {id: '', _raw: {}};
      fn(r);
      r.id = r._raw.id;
      mockDb[name].set(r.id, r);
    },
  });
  return {
    database: {
      collections: {
        get: (t: string) =>
          table(t === 'chat_sessions' ? 'sessions' : 'messages'),
      },
      write: async (fn: () => Promise<void>) => fn(),
      batch: async (...ops: (() => void)[]) => ops.forEach(op => op()),
    },
  };
});

import {userId} from '../../../utils/chat';
import {
  mirroredMetadata,
  versionOf,
  writeChats,
  type ChatRecord,
} from '../chatSync';
import {isMirrored, MIRROR_MARK, withMirrorMark} from '../mirrorMark';

const msg = (id: string, text: string, metadata = '{}') => ({
  id,
  session_id: 'c',
  author: userId,
  type: 'text',
  text,
  position: 0,
  created_at: 1,
  metadata,
});

const chat = (messages: ReturnType<typeof msg>[]): ChatRecord => ({
  session: {id: 'c', title: 'Chat', updated_at: 1},
  messages,
});

const stored = (id: string) => mockDb.messages.get(id)!._raw.metadata;

beforeEach(() => {
  mockDb.sessions.clear();
  mockDb.messages.clear();
});

it('reads and adds the mark', () => {
  expect(isMirrored(undefined)).toBe(false);
  expect(isMirrored('')).toBe(false);
  expect(isMirrored('{}')).toBe(false);
  expect(isMirrored('{"copyable":true}')).toBe(false);
  expect(isMirrored('{"mirroredFrom":"Pixel"}')).toBe(true);
  expect(isMirrored({mirroredFrom: 'the PC'})).toBe(true);
  // Unreadable metadata: not counted as typed here.
  expect(isMirrored('{nope')).toBe(true);
  expect(JSON.parse(withMirrorMark('{"copyable":true}', 'Pixel'))).toEqual({
    copyable: true,
    [MIRROR_MARK]: 'Pixel',
  });
});

it('the mark never travels and does not change a chat version', () => {
  const marked = withMirrorMark('{"copyable":true}', 'Pixel');
  expect(mirroredMetadata(marked)).toBe('{"copyable":true}');
  expect(versionOf(chat([msg('m1', 'hi', marked)])).print).toBe(
    versionOf(chat([msg('m1', 'hi', '{"copyable":true}')])).print,
  );
});

it('a sync marks new and changed messages, not ones typed here unchanged', async () => {
  // Typed here.
  await writeChats([chat([msg('m1', 'mine'), msg('m2', 'also mine')])]);
  expect(isMirrored(stored('m1'))).toBe(false);
  // Back from the other device: m1 the same, m2 changed there, m3 new.
  await writeChats(
    [
      chat([
        msg('m1', 'mine'),
        msg('m2', 'changed on the PC'),
        msg('m3', 'forged "user" words'),
      ]),
    ],
    {from: 'Pixel'},
  );
  expect(isMirrored(stored('m1'))).toBe(false);
  expect(isMirrored(stored('m2'))).toBe(true);
  expect(isMirrored(stored('m3'))).toBe(true);
  expect(JSON.parse(stored('m3'))[MIRROR_MARK]).toBe('Pixel');
  // Once marked, it stays marked even if the text is the same next time.
  await writeChats(
    [chat([msg('m1', 'mine'), msg('m3', 'forged "user" words')])],
    {from: 'Pixel'},
  );
  expect(isMirrored(stored('m3'))).toBe(true);
  // A new chat from another device: every message marked.
  mockDb.sessions.clear();
  mockDb.messages.clear();
  await writeChats([chat([msg('m9', 'from far away')])], {from: 'the PC'});
  expect(isMirrored(stored('m9'))).toBe(true);
});

it('restoring a kept version writes messages as they were', async () => {
  await writeChats([
    chat([msg('m1', 'mine'), msg('m2', 'x', withMirrorMark('{}', 'Pixel'))]),
  ]);
  expect(isMirrored(stored('m1'))).toBe(false);
  expect(isMirrored(stored('m2'))).toBe(true);
});
