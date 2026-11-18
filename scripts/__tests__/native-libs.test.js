// llama.rn's native libraries are checked file by file, even from a build
// cache (security review 2, 2026-11-18).
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {check, parseList} = require('../native-libs/check-native');

const sha = text => crypto.createHash('sha256').update(text).digest('hex');

function makePackage(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llama-rn-check-'));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
    fs.writeFileSync(path.join(root, name), text);
  }
  for (const dir of ['android/src/main/jniLibs', 'ios/rnllama.xcframework']) {
    fs.mkdirSync(path.join(root, dir), {recursive: true});
  }
  return root;
}

describe('llama.rn native libraries check', () => {
  const lib = 'android/src/main/jniLibs/arm64-v8a/librnllama.so';
  const list = parseList(`${sha('real')}  ${lib}\r\n`);

  it('passes exactly the listed files (the marker aside)', () => {
    const pkg = makePackage({
      [lib]: 'real',
      'android/src/main/jniLibs/.llama-rn.sha256': 'whatever\n',
    });
    expect(check(pkg, list)).toEqual([]);
  });

  it('refuses a changed, missing or extra file, or a link', () => {
    expect(check(makePackage({[lib]: 'planted'}), list)).toEqual([
      `SHA-256 differs: ${lib}`,
    ]);
    expect(check(makePackage({}), list)).toEqual([`missing: ${lib}`]);
    const extra = 'android/src/main/jniLibs/x86_64/extra.so';
    expect(check(makePackage({[lib]: 'real', [extra]: 'x'}), list)).toEqual([
      `not listed: ${extra}`,
    ]);
    const pkg = makePackage({[lib]: 'real'});
    fs.symlinkSync(os.tmpdir(), path.join(pkg, 'ios/rnllama.xcframework/l'));
    expect(check(pkg, list)[0]).toMatch(/^a link: /);
  });

  it('the list for the llama.rn in yarn.lock is kept here', () => {
    const lock = fs.readFileSync(
      path.join(__dirname, '../../yarn.lock'),
      'utf8',
    );
    const version = /^llama\.rn@[^\n]*\n {2}version "([^"]+)"/m.exec(lock)[1];
    const file = path.join(
      __dirname,
      `../native-libs/native-${version}.sha256`,
    );
    const listed = parseList(fs.readFileSync(file, 'utf8'));
    expect(listed.size).toBeGreaterThan(0);
    for (const name of listed.keys()) {
      expect(name).toMatch(
        /^(android\/src\/main\/jniLibs|ios\/rnllama\.xcframework)\//,
      );
    }
  });
});
