/**
 * Mirrored chats: a chat's version is its messages' fingerprint and newest
 * change; the PC takes newer chats and sends back what the device lacks or
 * has older, newest first within the budget; same ids everywhere.
 */
jest.mock('../../../database', () => ({database: {}}));
import {
  cleanChats,
  isNewer,
  MIRRORED_AUTHORS,
  mirroredMetadata,
  mirrorOnPc,
  versionOf,
  within,
  type ChatRecord,
} from '../chatSync';
import {MAX_CLOCK_SKEW} from '../promptSync';

const chat = (id: string, texts: string[], at = 1000): ChatRecord => ({
  session: {id, title: id, pinned: false, updated_at: at},
  messages: texts.map((t, i) => ({
    id: `${id}-m${i}`,
    session_id: id,
    author: 'y9d7f8pgn',
    type: 'text',
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

describe('what a mirrored chat may carry', () => {
  const NOW = 1_800_000_000_000;
  const msg = (extra: Record<string, unknown>) => ({
    id: 'm1',
    session_id: 'c',
    author: 'y9d7f8pgn',
    type: 'text',
    text: 'hi',
    position: 0,
    created_at: NOW,
    metadata: '{}',
    ...extra,
  });
  const one = (m: Record<string, unknown>, session: object = {}) =>
    cleanChats(
      [
        {
          session: {id: 'c', title: 't', pinned: false, ...session},
          messages: [m],
        },
      ],
      NOW,
    )[0];

  it('times far ahead are clamped to a few minutes ahead', () => {
    const c = one(msg({created_at: 9e15}), {updated_at: 9e15, created_at: 1});
    expect(c.session.updated_at).toBe(NOW + MAX_CLOCK_SKEW);
    expect(c.session.created_at).toBe(1);
    expect(c.messages[0].created_at).toBe(NOW + MAX_CLOCK_SKEW);
    expect(versionOf(c).at).toBe(NOW + MAX_CLOCK_SKEW);
  });

  it('only messages from the user or the assistant, of kinds the app saves', () => {
    const c = cleanChats(
      [
        {
          session: {id: 'c'},
          messages: [
            msg({id: 'a'}),
            msg({id: 'b', author: 'h3o3lc5xj', type: 'assistant_turn'}),
            msg({id: 's', author: 'pocketagent-context-summary'}),
            msg({id: 'x', author: 'someone-else'}),
            msg({id: 'f', type: 'file'}),
            msg({id: 'i', type: 'image'}),
          ],
        },
      ],
      NOW,
    )[0];
    expect(c.messages.map(m => m.id)).toEqual(['a', 'b', 's']);
    // Unknown session fields don't travel either.
    expect(
      Object.keys(one(msg({}), {evil: 1, title: 5, pinned: true}).session),
    ).toEqual(['id', 'pinned']);
  });

  it('the known ids are the app own', () => {
    const {user, assistant} = require('../../../utils/chat');
    const src: string = require('fs').readFileSync(
      require('path').join(__dirname, '../../chatSummary.ts'),
      'utf8',
    );
    const summary = /SUMMARY_AUTHOR_ID = '([^']+)'/.exec(src)![1];
    expect(MIRRORED_AUTHORS).toEqual([user.id, assistant.id, summary]);
  });

  it('pictures and paths stay on their device; known metadata travels', () => {
    const metadata = JSON.stringify({
      imageUris: ['file:///data/user/0/app/files/images/a.jpg'],
      copyable: true,
      timings: {predicted_ms: 5, note: 'x'},
      completionResult: {content: 'ok', used: 3, isRemote: false, extra: 1},
      authorData: {id: 'h3o3lc5xj', firstName: 'Ann', imageUrl: 'http://x'},
      contextId: '/pocketagent/models/secret',
      unknown: 'x',
      steps: [
        {
          content: 'Here it is',
          toolCalls: [
            {id: 't1', function: {name: 'read_file', arguments: '{}'}},
          ],
          toolOutcomes: [
            {
              callId: 't1',
              toolName: 'speak',
              responseContent: 'done',
              result: {type: 'audio', audioUri: 'file:///x.wav', summary: 's'},
            },
          ],
        },
      ],
    });
    const out = JSON.parse(String(one(msg({metadata})).messages[0].metadata));
    expect(out).toEqual({
      copyable: true,
      timings: {predicted_ms: 5},
      completionResult: {content: 'ok', used: 3, isRemote: false},
      authorData: {firstName: 'Ann'},
      steps: [
        {
          content: 'Here it is',
          toolCalls: [
            {id: 't1', function: {name: 'read_file', arguments: '{}'}},
          ],
          toolOutcomes: [
            {
              callId: 't1',
              toolName: 'speak',
              responseContent: 'done',
              result: {type: 'text', summary: 's'},
            },
          ],
        },
      ],
    });
    // Any path in a kept key drops that key.
    expect(
      mirroredMetadata(
        JSON.stringify({completionResult: {content: 'see /data/user/0/x'}}),
      ),
    ).toBe('{}');
    // Unchanged metadata is passed on as it is.
    const plain = '{"copyable":true,"multimodal":false}';
    expect(mirroredMetadata(plain)).toBe(plain);
    expect(mirroredMetadata('not json')).toBe('{}');
  });

  it('a copy that lost its pictures on the way is the same version', () => {
    const withPics = chat('c', ['hi']);
    withPics.messages[0].metadata = JSON.stringify({
      copyable: true,
      imageUris: ['file:///data/a.jpg'],
    });
    const travelled = cleanChats([withPics], 5000)[0];
    expect(versionOf(travelled).print).toBe(versionOf(withPics).print);
  });

  it('the PC keeps what a copy replaces (keep) and writes only what it allows', async () => {
    const pcChats = new Map([['c', chat('c', ['a', 'b', 'c'], 100)]]);
    const written: ChatRecord[] = [];
    const keep = jest.fn(
      async (_l: unknown, _list: ChatRecord[]): Promise<ChatRecord[]> => [],
    );
    const r = await mirrorOnPc(
      [chat('c', ['x'], 9000)],
      [],
      1e6,
      {
        read: async () => pcChats,
        write: async c => {
          written.push(...c);
        },
      },
      {keep},
    );
    expect(keep).toHaveBeenCalledTimes(1);
    expect(keep.mock.calls[0][1].map((c: ChatRecord) => c.session.id)).toEqual([
      'c',
    ]);
    expect(written).toEqual([]);
    expect(r.taken).toBe(0);
  });
});
