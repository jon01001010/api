const mockFiles = new Map<string, string>();
const mockDirs = new Set<string>();

jest.mock('@dr.pogodin/react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  CachesDirectoryPath: '/cache',
  exists: jest.fn(async (p: string) => mockFiles.has(p) || mockDirs.has(p)),
  stat: jest.fn(async (p: string) => {
    if (!mockFiles.has(p)) {
      throw new Error('ENOENT ' + p);
    }
    return {isFile: () => true, size: (mockFiles.get(p) as string).length};
  }),
  readFile: jest.fn(async (p: string) => {
    if (!mockFiles.has(p)) {
      throw new Error('ENOENT ' + p);
    }
    return mockFiles.get(p);
  }),
  writeFile: jest.fn(async (p: string, c: string) => {
    mockFiles.set(p, c);
  }),
  copyFile: jest.fn(async (a: string, b: string) => {
    mockFiles.set(b, mockFiles.get(a) as string);
  }),
  unlink: jest.fn(async (p: string) => {
    mockFiles.delete(p);
  }),
  mkdir: jest.fn(async (p: string) => {
    mockDirs.add(p);
  }),
  readDir: jest.fn(async (dir: string) =>
    [...mockFiles.keys()]
      .filter(
        p => p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/'),
      )
      .map(p => ({name: p.slice(dir.length + 1), isFile: () => true})),
  ),
}));

const mockApproval = jest.fn();
jest.mock('../fileApprovalGate', () => ({
  requestFileApproval: (...args: unknown[]) => mockApproval(...args),
}));

// Documents (desktop: converted on the PC by src-tauri/src/docs.rs).
jest.mock('../documentText', () => ({
  ...jest.requireActual('../documentText'),
  readDocumentText: jest.fn(async (path: string) =>
    path.endsWith('report.docx')
      ? 'Quarterly report\nTea costs 3.50'
      : Promise.reject(new Error('not a document')),
  ),
}));
import {FileToolsEngine, FILE_OPERATIONS} from '../FileToolsEngine';
import {diffLines} from '../lineDiff';
import {MAX_SNAPSHOTS} from '../fileHistory';

const ROOT = '/docs/PocketAgentFiles';
const put = (name: string, text: string) =>
  mockFiles.set(ROOT + '/' + name, text);
const get = (name: string) => mockFiles.get(ROOT + '/' + name);
const run = (
  op: (typeof FILE_OPERATIONS)[number],
  args: Record<string, unknown>,
) => new FileToolsEngine(op).execute(args);

beforeEach(() => {
  mockFiles.clear();
  mockDirs.clear();
  mockApproval.mockReset();
  mockApproval.mockResolvedValue(true);
});

describe('bug fixes', () => {
  it('file_read_range splits on real newlines, including CRLF', async () => {
    put('a.txt', 'one\r\ntwo\nthree');
    const r = await run('file_read_range', {
      filename: 'a.txt',
      start_line: 2,
      line_count: 2,
    });
    expect(r.summary).toBe('2: two\n3: three');
  });

  it('file_search separates results with real newlines', async () => {
    put('notes.md', 'x');
    put('notes2.md', 'y');
    const r = await run('file_search', {query: 'notes'});
    expect(r.summary?.split('\n').sort()).toEqual(['notes.md', 'notes2.md']);
  });

  it('file_info reports text files as editable', async () => {
    put('notes.md', 'x');
    put('photo.bin', 'x');
    expect(
      JSON.parse((await run('file_info', {filename: 'notes.md'})).summary!)
        .editableText,
    ).toBe(true);
    expect(
      JSON.parse((await run('file_info', {filename: 'photo.bin'})).summary!)
        .editableText,
    ).toBe(false);
  });
});

describe('file_append', () => {
  it('adds text at the end after approval', async () => {
    put('log.txt', 'a\n');
    const r = await run('file_append', {filename: 'log.txt', content: 'b\n'});
    expect(r.type).toBe('text');
    expect(get('log.txt')).toBe('a\nb\n');
    expect(mockApproval.mock.calls[0][0]).toMatchObject({
      action: 'file_append',
      diff: expect.stringContaining('+ b'),
    });
  });

  it('keeps the file when denied', async () => {
    put('log.txt', 'a');
    mockApproval.mockResolvedValue(false);
    expect(
      (await run('file_append', {filename: 'log.txt', content: 'b'})).type,
    ).toBe('error');
    expect(get('log.txt')).toBe('a');
  });
});

describe('file_patch', () => {
  it('replaces a snippet that appears exactly once', async () => {
    put('a.ts', 'const x = 1;\nconst y = 2;\n');
    const r = await run('file_patch', {
      filename: 'a.ts',
      find: 'y = 2',
      replace: 'y = 3',
    });
    expect(r.type).toBe('text');
    expect(get('a.ts')).toBe('const x = 1;\nconst y = 3;\n');
  });

  it('refuses when the snippet is missing or ambiguous', async () => {
    put('a.ts', 'x x');
    expect(
      (await run('file_patch', {filename: 'a.ts', find: 'z', replace: ''}))
        .summary,
    ).toMatch(/not found/);
    expect(
      (await run('file_patch', {filename: 'a.ts', find: 'x', replace: ''}))
        .summary,
    ).toMatch(/2 times/);
    expect(mockApproval).not.toHaveBeenCalled();
  });
});

describe('history, undo and diff', () => {
  it('keeps each previous version and undo restores it (undo is undoable)', async () => {
    put('a.txt', 'v1');
    await run('file_edit', {filename: 'a.txt', content: 'v2'});
    await run('file_edit', {filename: 'a.txt', content: 'v3'});
    const hist = await run('file_history', {filename: 'a.txt'});
    expect(hist.summary?.split('\n')).toHaveLength(2);

    await run('file_undo', {filename: 'a.txt'});
    expect(get('a.txt')).toBe('v2');
    await run('file_undo', {filename: 'a.txt'});
    expect(get('a.txt')).toBe('v3');
  });

  it('snapshots live outside the workspace listing and are capped', async () => {
    put('a.txt', 'v0');
    for (let i = 1; i <= MAX_SNAPSHOTS + 3; i++) {
      await run('file_edit', {filename: 'a.txt', content: 'v' + i});
    }
    expect((await run('file_list', {})).summary).toBe('a.txt');
    const hist = await run('file_history', {filename: 'a.txt'});
    expect(hist.summary?.split('\n')).toHaveLength(MAX_SNAPSHOTS);
  });

  it('file_undo fails cleanly with no history', async () => {
    put('a.txt', 'v1');
    expect((await run('file_undo', {filename: 'a.txt'})).summary).toMatch(
      /No earlier version/,
    );
  });

  it('file_diff compares with proposed content, or with the last version', async () => {
    put('a.txt', 'a\nb\nc');
    expect(
      (await run('file_diff', {filename: 'a.txt', content: 'a\nB\nc'})).summary,
    ).toBe('+1 -1 lines\n  a\n- b\n+ B\n  c');
    await run('file_edit', {filename: 'a.txt', content: 'a\nb\nc\nd'});
    expect((await run('file_diff', {filename: 'a.txt'})).summary).toContain(
      '+ d',
    );
  });
});

describe('safety', () => {
  it('refuses a stale edit if the file changed during approval', async () => {
    put('a.txt', 'v1');
    mockApproval.mockImplementation(async () => {
      put('a.txt', 'changed meanwhile');
      return true;
    });
    const r = await run('file_patch', {
      filename: 'a.txt',
      find: 'v1',
      replace: 'v2',
    });
    expect(r.summary).toMatch(/changed while awaiting approval/);
    expect(get('a.txt')).toBe('changed meanwhile');
  });

  it('never edits binary imports or paths outside the workspace', async () => {
    put('photo.bin', 'x');
    expect(
      (await run('file_append', {filename: 'photo.bin', content: 'y'})).type,
    ).toBe('error');
    expect(
      (await run('file_append', {filename: '../escape.txt', content: 'y'}))
        .type,
    ).toBe('error');
  });

  it('create still refuses to overwrite', async () => {
    put('a.txt', 'v1');
    expect(
      (await run('file_create', {filename: 'a.txt', content: 'x'})).summary,
    ).toMatch(/already exists/);
  });
});

describe('diffLines', () => {
  it('reports no changes', () => {
    expect(diffLines('a\nb', 'a\nb')).toBe('No changes');
  });
  it('shows context and elides distant unchanged lines', () => {
    const before = Array.from({length: 20}, (_, i) => 'l' + i).join('\n');
    const after = before.replace('l10', 'X');
    const d = diffLines(before, after);
    expect(d).toContain('- l10');
    expect(d).toContain('+ X');
    expect(d).toContain('  l8');
    expect(d).not.toContain('  l2\n');
    expect(d).toMatch(/…/);
  });
});

it('registers every file tool', () => {
  expect(FILE_OPERATIONS).toEqual(
    expect.arrayContaining([
      'file_append',
      'file_patch',
      'file_diff',
      'file_history',
      'file_undo',
    ]),
  );
});

describe('documents and searching inside files', () => {
  it('reads a Word file as text, also in ranges', async () => {
    mockFiles.set(ROOT + '/report.docx', 'PK-binary');
    expect((await run('file_read', {filename: 'report.docx'})).summary).toBe(
      'Quarterly report\nTea costs 3.50',
    );
    expect(
      (
        await run('file_read_range', {
          filename: 'report.docx',
          start_line: 2,
          line_count: 1,
        })
      ).summary,
    ).toBe('2: Tea costs 3.50');
  });

  it('finds words inside text files and documents when asked', async () => {
    mockFiles.set(ROOT + '/report.docx', 'PK-binary');
    mockFiles.set(ROOT + '/notes.md', 'buy milk\nbring tea bags');
    const byName = await run('file_search', {query: 'tea'});
    expect(byName.summary).toBe('No matching filenames');
    const inside = await run('file_search', {query: 'tea', in_files: true});
    expect(inside.summary).toContain('notes.md:2: bring tea bags');
    expect(inside.summary).toContain('report.docx:2: Tea costs 3.50');
  });
});
