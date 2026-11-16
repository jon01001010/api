/**
 * A desktop-only file (name.web.ts) must never import or re-export from its
 * own base name ('./name'): the desktop bundle resolves that to the .web file
 * itself, and a re-export then calls itself forever ("Maximum call stack
 * size exceeded", seen 2026-11-16 opening Settings on the PC).
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..');

function webFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
        out.push(...webFiles(full));
      }
    } else if (/\.web\.(ts|tsx|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

it('no .web file imports its own base name', () => {
  const bad: string[] = [];
  for (const file of webFiles(SRC)) {
    const base = path.basename(file).replace(/\.web\.(ts|tsx|js)$/, '');
    // Type-only imports vanish when the app is built; they can't loop.
    const text = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(line => !/^\s*(import|export) type\b/.test(line))
      .join('\n');
    const own = new RegExp(
      `(from|require\\()\\s*['"]\\./${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`,
    );
    if (own.test(text)) {
      bad.push(path.relative(SRC, file));
    }
  }
  expect(bad).toEqual([]);
});
