/**
 * Rules that must stay true (see SECURITY.md). Each test guards one rule, so
 * a future change that quietly weakens it fails here first. If a test fails,
 * don't just update it: read SECURITY.md and decide on purpose.
 */
import * as fs from 'fs';
import * as path from 'path';

let mockStored: string | null = null;
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: () => Promise.resolve(mockStored),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === '__automation__'
        ? []
        : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}
const rel = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join('/');
// Line breaks normalised: a Windows checkout has \r\n.
const read = (file: string) =>
  fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const filesMatching = (pattern: RegExp) =>
  sourceFiles(SRC)
    .filter(f => pattern.test(fs.readFileSync(f, 'utf8')))
    .map(rel)
    .sort();

describe('Rule 1: tools run in two places only', () => {
  it('only the chat loop and shortcut runs call a tool', () => {
    expect(filesMatching(/\.execute\(/)).toEqual([
      'src/services/agent/AgentRunner.ts',
      'src/services/talents/customTools.ts',
    ]);
  });

  it('the chat loop refuses tools that are not switched on', () => {
    expect(read('src/services/agent/AgentRunner.ts')).toMatch(
      /!allowedTalentNames\.includes\(fnName\)/,
    );
  });

  it('only a shortcut run (after its one approval) skips per-step asking', () => {
    expect(filesMatching(/inApprovedShortcut:\s*true/)).toEqual([
      'src/services/talents/customTools.ts',
    ]);
  });
});

describe('Rule 2: switches are off unless the user turns them on', () => {
  it('an assistant may add only these harmless tools by itself', () => {
    const {ASSISTANT_ONLY_TOOLS} = require('../utils/globalToolSettings');
    expect([...ASSISTANT_ONLY_TOOLS].sort()).toEqual([
      'calculate',
      'datetime',
      'render_html',
    ]);
  });

  it.each([null, '{"a":1}', '["calculate", 5]', '"calculate"'])(
    'reading switched-on tools from storage %p gives none',
    async stored => {
      mockStored = stored;
      const {readGlobalTools} = require('../utils/globalToolSettings');
      await expect(readGlobalTools()).resolves.toEqual([]);
    },
  );
});

describe('Rule 3: the HTML preview is a closed box', () => {
  it('there is exactly one WebView in the app', () => {
    expect(filesMatching(/<WebView\b/)).toEqual([
      'src/components/HtmlPreviewBubble/HtmlPreviewBubble.tsx',
    ]);
  });

  it('the WebView has no bridge into the app and no escape hatches', () => {
    const src = read('src/components/HtmlPreviewBubble/HtmlPreviewBubble.tsx');
    const webView = src.slice(src.indexOf('<WebView'));
    const props = webView
      .slice(0, webView.indexOf('/>'))
      .replace(/\/\/.*$/gm, '');
    expect(props).not.toMatch(
      /\bonMessage\b|injectedJavaScript|allowsInlineMediaPlayback/,
    );
    expect(props).toContain('javaScriptCanOpenWindowsAutomatically={false}');
    expect(props).toContain('allowFileAccess={false}');
    expect(props).toContain('allowFileAccessFromFileURLs={false}');
    expect(props).toContain('allowUniversalAccessFromFileURLs={false}');
    expect(props).toContain('geolocationEnabled={false}');
    expect(props).toContain('incognito={true}');
    expect(props).toContain('setSupportMultipleWindows={false}');
    expect(props).toContain(
      "onShouldStartLoadWithRequest={req => req.url === 'about:blank'}",
    );
  });

  it('every page starts with the network block and the WebRTC/frame guard', () => {
    const {
      wrapDocument,
      CSP,
    } = require('../components/HtmlPreviewBubble/HtmlPreviewBubble');
    expect(CSP).toContain("default-src 'none'");
    expect(CSP).toContain("connect-src 'none'");
    expect(CSP).toContain("frame-src 'none'");
    expect(CSP).toContain("form-action 'none'");
    const doc: string = wrapDocument('<p>page</p>');
    const csp = doc.indexOf('Content-Security-Policy');
    const guard = doc.indexOf('data-preview-guard');
    expect(csp).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(csp);
    expect(doc.indexOf('<p>page</p>')).toBeGreaterThan(guard);
  });
});

describe('Rule 4: no running text as code in the app', () => {
  it('no eval or new Function outside the preview sandbox', () => {
    expect(
      filesMatching(/\beval\(|new Function\(/).filter(
        f => !f.startsWith('src/components/HtmlPreviewBubble/'),
      ),
    ).toEqual([]);
  });
});

describe('Rule 5: the phone side stays small', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  it('asks for exactly these permissions', () => {
    const permissions = [
      ...manifest.matchAll(/uses-permission[^>]*android:name="([^"]+)"/g),
    ]
      .map(m => m[1])
      .sort();
    expect(permissions).toEqual(
      [
        'android.permission.CAMERA',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_MICROPHONE',
        'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
        'android.permission.INTERNET',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.READ_CONTACTS',
        // Android 9 and older only (maxSdkVersion 28).
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.RECORD_AUDIO',
        'android.permission.RUN_USER_INITIATED_JOBS',
        'com.android.alarm.permission.SET_ALARM',
      ].sort(),
    );
  });

  it('only the main screen can be opened by other apps', () => {
    expect(manifest.match(/android:exported="true"/g)?.length).toBe(1);
  });

  it('the local API listens on this phone only, with a password checked safely', () => {
    const server = read(
      'android/app/src/main/java/com/pocketagent/localapi/LoopbackServer.java',
    );
    expect(server).toContain('InetAddress.getByName("127.0.0.1")');
    expect(server).toContain('MessageDigest.isEqual');
    expect(server).toContain('SecureRandom');
    expect(read('src/services/localApi/protocol.ts')).toMatch(/no tools/);
  });
});

describe('Rule 6: the Windows app opens doors only on purpose, and asks', () => {
  const tauri = (file: string) => read(`src-tauri/${file}`);
  const commandsIn = (text: string) =>
    [...text.matchAll(/"([a-z_]+)"/g)].map(m => m[1]);

  it('the native side offers exactly these commands', () => {
    const build = tauri('build.rs');
    const listed = commandsIn(
      build.slice(build.indexOf('COMMANDS'), build.indexOf('];')),
    );
    expect(listed.sort()).toEqual(
      [
        'fs_exists',
        'fs_read',
        'fs_write',
        'fs_mkdir',
        'fs_list',
        'fs_stat',
        'fs_remove',
        'fs_copy',
        'fs_move',
        'fs_download',
        'fs_download_cancel',
        'secret_get',
        'secret_set',
        'secret_delete',
        'http_request',
        'http_abort',
        'pick_model_file',
        'model_server_start',
        'model_server_stop',
        'system_info',
        'startup_timing',
        'preview_put',
        'link_pair',
        'link_on',
        'link_off',
        'link_status',
        'link_forget',
      ].sort(),
    );
    // The window is allowed exactly those, plus Tauri's core basics.
    const caps = JSON.parse(tauri('capabilities/default.json'));
    expect(caps.permissions.sort()).toEqual(
      [
        'core:default',
        ...listed.map(c => `allow-${c.replace(/_/g, '-')}`),
      ].sort(),
    );
    // Every command is wired in, none extra.
    const lib = tauri('src/lib.rs');
    const handlerList = lib.slice(
      lib.indexOf('generate_handler!['),
      lib.indexOf(']', lib.indexOf('generate_handler![')),
    );
    const handlers = [...handlerList.matchAll(/\w+::(\w+),/g)].map(m => m[1]);
    expect(handlers.sort()).toEqual(listed.sort());
  });

  it('every file command outside the app folder asks first (native dialog)', () => {
    const files = tauri('src/files.rs');
    const fns = [...files.matchAll(/pub async fn (fs_\w+)\(([\s\S]*?)\n}\n/g)];
    expect(fns.map(m => m[1]).sort()).toEqual([
      'fs_copy',
      'fs_exists',
      'fs_list',
      'fs_mkdir',
      'fs_move',
      'fs_read',
      'fs_remove',
      'fs_stat',
      'fs_write',
    ]);
    for (const [, name, body] of fns) {
      expect([name, body.includes('allowed(&app')]).toEqual([name, true]);
    }
    expect(files).toMatch(/if !located\.own \{[\s\S]*?ask\(app, &question\)/);
    expect(tauri('src/approval.rs')).toContain('blocking_show()');
    // Downloads use the same rule (own folder free, elsewhere ask), only
    // http/https, and never leave a half file looking like a finished one.
    const download = tauri('src/download.rs');
    expect(download).toMatch(/files::allowed_path\(&app, &path/);
    expect(download).toContain('net::check_url(&url)');
    expect(download).toContain('part_path(&target)');
  });

  it('running a model from outside the app folder asks first; the server is private', () => {
    const server = tauri('src/model_server.rs');
    expect(server).toMatch(
      /if !own_models && !remembered \{[\s\S]*?approval::ask_with_always/,
    );
    // "Always" only from its own button, and kept where the screens can't
    // write: their key command always adds "PocketAgent:".
    const approval = tauri('src/approval.rs');
    expect(approval).toContain(
      'R::Custom(label) if label == ALWAYS => Answer::Always',
    );
    expect(approval.match(/[=]> Answer::Always/g)).toHaveLength(1);
    const remembered = tauri('src/remembered.rs');
    expect(remembered).toContain('const PREFIX: &str = "DesktopAgent-model:";');
    expect(tauri('src/secrets.rs')).toContain('format!("{PREFIX}:{service}")');
    expect(tauri('src/secrets.rs')).toContain(
      'const PREFIX: &str = "PocketAgent";',
    );
    // The exact file: path, size and time must all match.
    expect(remembered).toContain('.map(|saved| &saved == now)');
    expect(server).toContain('"127.0.0.1".into()');
    expect(server).toContain('"--api-key".into()');
  });

  it('the window itself has no internet access; its only frames are HTML previews', () => {
    const csp = JSON.parse(tauri('tauri.conf.json')).app.security.csp;
    expect(csp['default-src']).toBe("'self'");
    expect(csp['script-src']).toBe("'self'");
    expect(csp['connect-src']).toBe('ipc: http://ipc.localhost');
    // Frames only from the preview address (Linux form, Windows form), so a
    // preview can't navigate itself anywhere else.
    expect(csp['frame-src']).toBe('pa-preview: http://pa-preview.localhost');
    expect(csp['object-src']).toBe("'none'");
    // Tauri's nonces stay on for scripts; off for styles only (with a nonce
    // present, browsers ignore 'unsafe-inline' and the app's styles, which
    // React Native Web adds at run time, were blocked). Styles can't run
    // code, and img/font/connect rules stop them loading anything outside.
    const security = JSON.parse(tauri('tauri.conf.json')).app.security;
    expect(security.dangerousDisableAssetCspModification).toEqual([
      'style-src',
    ]);
  });

  it('HTML previews: own address, sandboxed to scripts, no network (rule 3)', () => {
    const preview = tauri('src/preview.rs');
    const policy = preview.slice(
      preview.indexOf('PREVIEW_POLICY'),
      preview.indexOf('";', preview.indexOf('PREVIEW_POLICY')),
    );
    for (const rule of [
      "default-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      'sandbox allow-scripts',
    ]) {
      expect([rule, policy.includes(rule)]).toEqual([rule, true]);
    }
    // Every answer carries the policy.
    expect(preview).toContain(
      '.header(header::CONTENT_SECURITY_POLICY, PREVIEW_POLICY)',
    );
    const frame = read('stubs/web/webview.js');
    expect(frame).toContain("const SANDBOX = 'allow-scripts';");
    expect(frame).not.toMatch(/allow-(same-origin|popups|forms|downloads|top)/);
  });

  it('no native command blocks the window (all run off the main thread)', () => {
    for (const file of [
      'files',
      'download',
      'secrets',
      'net',
      'model_server',
      'system',
      'timing',
      'preview',
      'link',
      'link_unavailable',
    ]) {
      const src = tauri(`src/${file}.rs`).replace(/\r\n/g, '\n');
      expect([
        file,
        /#\[tauri::command\]\n(#\[[^\n]*\n)*pub fn/.test(src),
      ]).toEqual([file, false]);
    }
  });

  it('home link: paired phones reach only the model server, pairing asks', () => {
    const link = tauri('src/link.rs');
    // Exactly three requests exist, and only "pair" works before pairing.
    const ops = link.slice(
      link.indexOf('pub enum Request'),
      link.indexOf('pub fn parse_request'),
    );
    expect(
      ops
        .match(/^\s{4}(\w+)/gm)!
        .map(o => o.trim())
        .sort(),
    ).toEqual(['Http', 'Pair', 'Status']);
    expect(link).toContain('Some(Request::Status) if paired =>');
    expect(link).toContain('Some(Request::Http) if paired =>');
    // Pairing: the one-time code, then the native dialog, then saved.
    expect(link).toMatch(
      /let code_ok = try_code\(&link\.pair_code, &code\);[\s\S]*?code_ok && \{[\s\S]*?approval::ask\(&app, &question\)\.await[\s\S]*?save_phones/,
    );
    // The model server on this PC only, on its own port.
    expect(link).toContain(
      'tokio::net::TcpStream::connect(("127.0.0.1", port))',
    );
    expect(link.match(/TcpStream::connect/g)).toHaveLength(1);
    // Kept where the screens can't write ("PocketAgent:" is theirs).
    expect(link).toContain('const KEY_ENTRY: &str = "DesktopAgent-link:key";');
    expect(link).toContain(
      'const PHONES_ENTRY: &str = "DesktopAgent-link:phones";',
    );
    // Off until switched on: nothing starts the link at app start.
    expect(tauri('src/lib.rs')).not.toMatch(/link::start|link_on\(/);
  });

  it('home link, phone side: 127.0.0.1 only, the PC QR tag only, same protocol as the PC', () => {
    const phone = read('native/homelink/src/lib.rs');
    const pc = tauri('src/link.rs');
    const alpn = (src: string) =>
      src.match(/pub const ALPN: &\[u8\] = b"([^"]+)";/)![1];
    const tag = (src: string) =>
      src.match(/pub const QR_PREFIX: &str = "([^"]+)";/)![1];
    expect(alpn(phone)).toBe(alpn(pc));
    expect(tag(phone)).toBe('PA1:P:');
    expect(tag(pc)).toBe('PA1:P:');
    expect(phone).toContain('TcpListener::bind(("127.0.0.1", 0))');
    expect(phone).toContain('if !from.ip().is_loopback() {');
    // The phone only ever asks for status, pairing or the model server.
    const ops = [...phone.matchAll(/"op\\?":\s*\\?"(\w+)/g)].map(m => m[1]);
    expect([...new Set(ops)].sort()).toEqual(['http', 'pair', 'status']);
    // Key kept out of cloud backups.
    expect(
      read(
        'android/app/src/main/java/com/pocketagent/homelink/HomeLinkModule.kt',
      ),
    ).toContain('context.noBackupFilesDir');
  });

  it('network from the native side is http/https only', () => {
    expect(tauri('src/net.rs')).toMatch(/"http" \| "https" => Ok\(parsed\)/);
  });
});
