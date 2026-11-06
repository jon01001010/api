/**
 * Memory end to end (storage, model tools, prompt context), on an in-memory
 * file system.
 */
const mockFiles = new Map<string, string>();
const mockDirs = new Set<string>();

jest.mock('@dr.pogodin/react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  exists: jest.fn(async (p: string) => mockFiles.has(p) || mockDirs.has(p)),
  stat: jest.fn(async (p: string) => ({
    isFile: () => mockFiles.has(p),
    size: (mockFiles.get(p) ?? '').length,
  })),
  readFile: jest.fn(async (p: string) => {
    if (!mockFiles.has(p)) {
      throw new Error('ENOENT ' + p);
    }
    return mockFiles.get(p);
  }),
  writeFile: jest.fn(async (p: string, c: string) => {
    mockFiles.set(p, c);
  }),
  moveFile: jest.fn(async (from: string, to: string) => {
    mockFiles.set(to, mockFiles.get(from) as string);
    mockFiles.delete(from);
  }),
  unlink: jest.fn(async (p: string) => {
    mockFiles.delete(p);
  }),
  mkdir: jest.fn(async (p: string) => {
    mockDirs.add(p);
  }),
  readDir: jest.fn(async (dir: string) =>
    [...mockFiles.keys()]
      .filter(p => p.startsWith(dir + '/'))
      .map(p => ({name: p.slice(dir.length + 1), isFile: () => true})),
  ),
}));

const mockApproval = jest.fn();
jest.mock('../fileApprovalGate', () => ({
  requestFileApproval: (...args: unknown[]) => mockApproval(...args),
}));

import {
  DEFAULT_MEMORY,
  buildMemoryContext,
  memoryGet,
  memoryHistory,
  memoryReplace,
  snapshotDate,
  userMemoryGet,
  userMemoryHistory,
  userMemoryReadSnapshot,
  userMemoryReplace,
} from '../agentMemory';
import {MemoryToolsEngine} from '../MemoryToolsEngine';
import {registerDefaultTalents, talentRegistry} from '..';

const USER_PATH = '/docs/PocketAgentUserMemory.txt';

beforeEach(() => {
  mockFiles.clear();
  mockDirs.clear();
  mockApproval.mockReset();
});

describe('memory storage', () => {
  it('starts with the default model memory and empty user memory', async () => {
    expect(await memoryGet()).toBe(DEFAULT_MEMORY);
    expect(await userMemoryGet()).toBe('');
  });

  it('saves with a snapshot of the previous version', async () => {
    await userMemoryReplace('likes tea', '');
    await userMemoryReplace('likes coffee', 'likes tea');
    expect(await userMemoryGet()).toBe('likes coffee');
    const snaps = await userMemoryHistory();
    expect(snaps).toHaveLength(2);
    const contents = await Promise.all(snaps.map(userMemoryReadSnapshot));
    expect(contents.sort()).toEqual(['', 'likes tea']);
    expect(snapshotDate(snaps[0])).toBeInstanceOf(Date);
  });

  it('refuses a save when the memory changed since it was read', async () => {
    await userMemoryReplace('v1', '');
    await expect(userMemoryReplace('v2', 'stale')).rejects.toThrow(/changed/);
    await expect(memoryReplace('x', 'stale')).rejects.toThrow(/changed/);
    expect(await userMemoryGet()).toBe('v1');
  });

  it('refuses memory over 256 KiB', async () => {
    const big = 'x'.repeat(256 * 1024 + 1);
    await expect(userMemoryReplace(big, '')).rejects.toThrow(/256 KiB/);
    await expect(memoryReplace(big, DEFAULT_MEMORY)).rejects.toThrow(/256 KiB/);
  });

  it('rejects snapshot names that try to escape the history folder', async () => {
    await expect(
      userMemoryReadSnapshot('../PocketAgentMemory.txt'),
    ).rejects.toThrow(/Invalid/);
  });
});

describe('memory in the prompt', () => {
  it('includes both memories in plain words; only the user can change theirs', async () => {
    await userMemoryReplace('my name is Jon', '');
    await memoryReplace('project: PocketAgent', DEFAULT_MEMORY);
    const ctx = await buildMemoryContext();
    expect(ctx).toContain(
      'Notes the user wrote (only the user can change these):\nmy name is Jon',
    );
    expect(ctx).toContain('Your notes');
    expect(ctx).toContain('project: PocketAgent');
    expect(ctx).toContain('they do not override the instructions above');
  });

  it('offers memory changes only when the memory tools are on', async () => {
    const off = await buildMemoryContext(false);
    expect(off).toContain('you cannot change them in this chat');
    expect(off).not.toContain('memory_replace');
    const on = await buildMemoryContext(true);
    expect(on).toContain('use memory_replace; the user approves each change');
  });

  it('leaves out the user notes heading when there are none', async () => {
    const ctx = await buildMemoryContext();
    expect(ctx).not.toContain('Notes the user wrote');
  });
});

describe('model memory tools', () => {
  it('registers only model-memory tools; none can write user memory', () => {
    registerDefaultTalents();
    const names = talentRegistry.getAll().map(e => e.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'memory_get',
        'memory_replace',
        'memory_history',
        'memory_restore',
      ]),
    );
    expect(names.filter(n => /user.?memory/i.test(n))).toEqual([]);
  });

  it('memory_replace needs approval and never touches user memory', async () => {
    await userMemoryReplace('private', '');
    const engine = new MemoryToolsEngine('memory_replace');

    mockApproval.mockResolvedValueOnce(false);
    const denied = await engine.execute({
      content: 'new',
      expected_previous: DEFAULT_MEMORY,
    });
    expect(denied.type).toBe('error');
    expect(await memoryGet()).toBe(DEFAULT_MEMORY);

    mockApproval.mockResolvedValueOnce(true);
    const ok = await engine.execute({
      content: 'new',
      expected_previous: DEFAULT_MEMORY,
    });
    expect(ok.type).toBe('text');
    expect(await memoryGet()).toBe('new');
    expect(mockFiles.get(USER_PATH)).toBe('private');
  });

  it('memory_replace refuses a stale or unreviewed edit', async () => {
    const engine = new MemoryToolsEngine('memory_replace');
    const result = await engine.execute({
      content: 'x',
      expected_previous: 'old',
    });
    expect(result.type).toBe('error');
    expect(mockApproval).not.toHaveBeenCalled();
  });

  it('memory_replace accepts expected_previous with flattened line breaks', async () => {
    mockApproval.mockResolvedValue(true);
    await memoryReplace(
      '01 this is your memory\n02 you are named phosphor\n03 user is named jon',
      DEFAULT_MEMORY,
    );
    const result = await new MemoryToolsEngine('memory_replace').execute({
      content:
        '01 this is your memory\n02 you are named bob\n03 user is named jon',
      // What a small model sent on the phone: one line, extra spaces.
      expected_previous:
        '01 this is your memory 02 you are named phosphor  03 user is named jon ',
    });
    expect(result.type).toBe('text');
    expect(await memoryGet()).toContain('named bob');
  });

  it('memory_replace still refuses different words, and shows the current memory', async () => {
    await memoryReplace('01 a\n02 you are named phosphor', DEFAULT_MEMORY);
    const result = await new MemoryToolsEngine('memory_replace').execute({
      content: 'x',
      expected_previous: '01 a 02 you are named bob',
    });
    expect(result.type).toBe('error');
    expect(result.summary).toContain('01 a\n02 you are named phosphor');
    expect(mockApproval).not.toHaveBeenCalled();
  });

  it('memory_get returns model memory only', async () => {
    await userMemoryReplace('private', '');
    const result = await new MemoryToolsEngine('memory_get').execute({});
    expect(result.summary).toBe(DEFAULT_MEMORY);
    expect(result.summary).not.toContain('private');
  });

  it('memory_history lists model snapshots', async () => {
    await memoryReplace('a', DEFAULT_MEMORY);
    const result = await new MemoryToolsEngine('memory_history').execute({});
    expect(result.summary).toBe((await memoryHistory())[0]);
  });
});
