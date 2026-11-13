/**
 * Mirrored chats: a chat's version is its messages' fingerprint and newest
 * change; the PC takes newer chats and sends back what the device lacks or
 * has older, newest first within the budget; same ids everywhere.
 */
jest.mock('../../../database', () => ({database: {}}));
import {
  cleanChats,
  isNewer,
  mirrorOnPc,
  versionOf,
  within,
  type ChatRecord,
} from '../chatSync';

const chat = (id: string, texts: string[], at = 1000): ChatRecord => ({
  session: {id, title: id, pinned: false, updated_at: at},
  messages: texts.map((t, i) => ({
    id: `${id}-m${i}`,
    session_id: id,
    text: t,
    position: i,
    created_at: at + i,
    metadata: '{}',
  })),
});

it('a chat changes version when its messages change', () => {
  const a = versionOf(chat('c1', ['hi']));
  const b = versionOf(chat('c1', ['hi', 'hello']));
  expect(a.print).not.toBe(b.print);
  expect(isNewer(b, a)).toBe(true);
  expect(versionOf(chat('c1', ['hi'])).print).toBe(a.print);
});

it('newest first, within the budget (the rest comes next time)', () => {
  const old = chat('old', ['x'.repeat(500)], 1);
  const fresh = chat('fresh', ['y'], 9000);
  expect(within([old, fresh], 10_000).map(c => c.session.id)).toEqual([
    'fresh',
    'old',
  ]);
  expect(within([old, fresh], 400).map(c => c.session.id)).toEqual(['fresh']);
});

it('drops chats with odd ids or messages from another chat', () => {
  const bad = chat('ok', ['a']);
  bad.messages[0].session_id = 'other';
  expect(
    cleanChats([
      chat('good', ['a']),
      bad,
      {session: {id: '../x'}, messages: []},
      'x',
    ]).map(c => c.session.id),
  ).toEqual(['good']);
});

it('the PC takes newer chats and sends back what the device lacks or has older', async () => {
  const pcChats = new Map<string, ChatRecord>([
    ['shared', chat('shared', ['hi'], 1000)],
    ['pcOnly', chat('pcOnly', ['from the PC'], 2000)],
    ['pcNewer', chat('pcNewer', ['a', 'b'], 5000)],
  ]);
  const written: ChatRecord[] = [];
  const fromPhone = chat('shared', ['hi', 'reply on the phone'], 3000);
  const phoneVersions = [
    versionOf(fromPhone),
    versionOf(chat('pcNewer', ['a'], 4000)),
    versionOf(chat('phoneOnly', ['x'], 10)),
  ];
  const r = await mirrorOnPc([fromPhone], phoneVersions, 1_000_000, {
    read: async () => pcChats,
    write: async c => {
      written.push(...c);
    },
  });
  expect(r.taken).toBe(1);
  expect(written.map(c => c.session.id)).toEqual(['shared']);
  expect(r.send.map(c => c.session.id).sort()).toEqual(['pcNewer', 'pcOnly']);
});

it('an older copy from the device is not taken', async () => {
  const pcChats = new Map([['c', chat('c', ['a', 'b', 'c'], 9000)]]);
  const written: ChatRecord[] = [];
  const r = await mirrorOnPc(
    [chat('c', ['a'], 100)],
    [versionOf(chat('c', ['a'], 100))],
    1e6,
    {
      read: async () => pcChats,
      write: async c => {
        written.push(...c);
      },
    },
  );
  expect(written).toEqual([]);
  expect(r.send.map(c => c.session.id)).toEqual(['c']);
});
