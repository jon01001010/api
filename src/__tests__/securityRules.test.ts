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

  it('a shared tool (QR, file, pasted code) is checked, shown, installed off', () => {
    const src = read('src/services/talents/toolImport.ts');
    // The same checks as tool_save, and a taken name is never replaced.
    expect(src).toMatch(/checkCustomTool\(/);
    expect(src).toMatch(/status: 'name_taken'/);
    // Off before saving; saved without a name to replace.
    const install = src.slice(
      src.indexOf('export async function installSharedTool'),
    );
    expect(install.indexOf('switchOffTools([tool.name])')).toBeGreaterThan(0);
    expect(install.indexOf('switchOffTools(')).toBeLessThan(
      install.indexOf('saveCustomTool('),
    );
    expect(install).toMatch(
      /saveCustomTool\(\{\.\.\.tool, createdBy: 'user'\}\)/,
    );
    // A code is data: unpacking only parses (rule 4), and the review screen
    // shows the full definition before Install.
    const qr = read('src/services/talents/toolQr.ts');
    expect(qr).not.toMatch(/talentRegistry|\.execute\(|eval\(|new Function/);
    const ui = read('src/screens/ToolCodeDialogs.tsx');
    expect(ui).toMatch(/describeCustomTool\(review\.tool\)/);
    expect(ui).not.toMatch(/\.execute\(|talentRegistry/);
  });
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
        'open_external',
        'pc_info',
        'run_command',
        'open_workspace_file',
        'clipboard_read',
        'notify',
        'media_key',
        'print_file',
        'take_screenshot',
        'quick_key_set',
        'doc_to_text',
        'pick_import_file',
        'save_copy',
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
        'link_sync_allow',
        'link_sync_reply',
        'link_answers_allow',
        'link_device_may_answer',
        'homelink_pair',
        'homelink_status',
        'homelink_start_model',
        'homelink_open_tunnel',
        'homelink_sync',
        'homelink_questions',
        'homelink_answer_question',
        'homelink_close_tunnel',
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
    // The password goes by environment, never on the command line.
    expect(server).toContain('pub const PASSWORD_ENV: &str = "LLAMA_API_KEY";');
    expect(server).toContain('command.env(PASSWORD_ENV, &key);');
    expect(server).not.toContain('"--api-key".into()');
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
    // Exactly these requests exist, and only "pair" works before pairing.
    const ops = link.slice(
      link.indexOf('pub enum Request'),
      link.indexOf('pub fn parse_request'),
    );
    expect(
      ops
        .match(/^\s{4}(\w+)/gm)!
        .map(o => o.trim())
        .sort(),
    ).toEqual([
      'Answer',
      'Http',
      'Pair',
      'Questions',
      'Start',
      'Status',
      'Sync',
    ]);
    // "questions" / "answer" (the PC asks, a device can answer): paired
    // devices only, only while the user allows it here; an answer is yes or
    // no to one question; a device's yes allows once, never "always"; and
    // pairing a new device is asked on this PC only.
    expect(link).toMatch(
      /Some\(Request::Questions\) if paired =>[\s\S]*?if !questions\.allowed\(\) \{\s*serde_json::json!\(\{"ok": false, "error": OFF_ANSWERS\}\)\s*\} else if !may_answer\(&load_phones\(&app\), &remote\) \{\s*serde_json::json!\(\{"ok": false, "error": NOT_THIS_DEVICE\}\)\s*\} else \{\s*serde_json::json!\(\{"ok": true, "questions": questions\.list\(\)\}\)/,
    );
    expect(link).toMatch(
      /Some\(Request::Answer \{ id, yes \}\) if paired =>[\s\S]*?if !questions\.allowed\(\) \{\s*serde_json::json!\(\{"ok": false, "error": OFF_ANSWERS\}\)\s*\} else if !may_answer\(&phones, &remote\) \{\s*serde_json::json!\(\{"ok": false, "error": NOT_THIS_DEVICE\}\)\s*\} else \{[\s\S]*?questions\.answer\(id, yes, &name\)/,
    );
    // Which devices may answer: each one allowed on its own, off by
    // default (old records without the field too, and again after pairing
    // anew); allowing one asks in the PC's own dialog (never a device).
    expect(link).toMatch(
      /#\[serde\(default, rename = "mayAnswer"[^\n]*\]\s*pub may_answer: bool,/,
    );
    expect(link).toMatch(
      /Phone \{ id: remote\.clone\(\), name: name\.clone\(\), may_answer: false \}/,
    );
    expect(link).toMatch(
      /pub async fn link_device_may_answer[\s\S]*?if allowed \{[\s\S]*?if !crate::approval::ask_on_this_pc\(&app, &question\)\.await \{\s*return Err[\s\S]*?let mut phones = load_phones\(&app\);[\s\S]*?save_phones/,
    );
    expect(link).toContain(
      "This device may not answer this PC's questions; allow it on the PC",
    );
    expect(ops).toMatch(/^\s{4}Answer \{ id: u64, yes: bool \},$/m);
    const approval = tauri('src/approval.rs');
    expect(approval).toMatch(
      /pub fn device_answer\(yes: bool\) -> Answer \{\s*if yes \{\s*Answer::Once\s*\} else \{\s*Answer::No/,
    );
    expect(approval).not.toMatch(/from_device\(.*Always/);
    const remote = tauri('src/remote_ask.rs');
    expect(remote).toContain(
      'pub const WAIT: Duration = Duration::from_secs(120);',
    );
    expect(remote).toMatch(
      /pub fn open\([^)]*\)[^{]*\{\s*if !self\.allowed\(\) \{\s*return None;/,
    );
    // "sync": paired devices only, only while the user allows it here,
    // size-capped, and answered by the screens (which merge and keep history).
    expect(link).toContain('Some(Request::Sync) if paired =>');
    expect(link).toMatch(
      /Some\(Request::Sync\) if paired =>[\s\S]*?if !link\.sync_allowed\.load\(Ordering::SeqCst\)[\s\S]*?read_to_end\(MAX_SYNC\)/,
    );
    expect(link).toMatch(/sync_allowed: std::sync::atomic::AtomicBool/);
    expect(link).toContain('Some(Request::Status) if paired =>');
    // "start": paired phones only; takes nothing from the phone (a unit
    // variant: the PC picks its last model); never shows a dialog.
    expect(link).toContain('Some(Request::Start) if paired =>');
    expect(ops).toMatch(/^\s{4}Start,$/m);
    expect(link).toMatch(
      /Some\(Request::Start\) if paired =>[\s\S]*?load_last_model\(&app\)[\s\S]*?StartedBy::Phone/,
    );
    const server = tauri('src/model_server.rs');
    expect(server).toMatch(
      /if !own_models && !remembered && by == StartedBy::Phone \{\s*return Err/,
    );
    expect(link).toContain('Some(Request::Http) if paired =>');
    // Pairing: the one-time code, then the native dialog, then saved.
    expect(link).toMatch(
      /let code_ok = try_code\(&link\.pair_code, &code\);[\s\S]*?code_ok && \{[\s\S]*?approval::ask_on_this_pc\(&app, &question\)\.await[\s\S]*?save_phones/,
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
    // One request per stream: the whole request is read and checked before
    // a byte reaches the model server (password, path, a plain
    // Content-Length body, no Transfer-Encoding, nothing pipelined after
    // it), the server is told to close after answering, and pictures,
    // sound and video must be inline (data:), never an address the PC
    // would fetch from inside the home network.
    expect(link).toMatch(
      /Some\(Request::Http\) if paired =>[\s\S]*?read_request\(&mut recv, &mut send, &key\)[\s\S]*?TcpStream::connect[\s\S]*?write_all\(&mut to_model, &request\.head\)/,
    );
    expect(link).not.toMatch(/tokio::io::copy\(&mut recv/);
    expect(link).toMatch(
      /pub fn prepare_head[\s\S]*?check_head\(head, key\)\?;[\s\S]*?"transfer-encoding" => return Err[\s\S]*?Connection: close/,
    );
    expect(link).toMatch(
      /async fn read_request[\s\S]*?prepare_head\([\s\S]*?if body\.len\(\) > request\.body_len \{\s*return Err[\s\S]*?check_body\(&request\.path, &body\)\?/,
    );
    expect(link).toMatch(
      /const MEDIA_KEYS[\s\S]*?"url",[\s\S]*?"image_url",[\s\S]*?"video_url",[\s\S]*?"input_audio",/,
    );
    expect(link).toMatch(/!text\.starts_with\("data:"\)/);
    // The model server never hands out other conversations (/slots).
    expect(server).toContain('"--no-slots".into(),');
    for (const on of ['--slots', '--metrics', '--props', '--slot-save-path']) {
      expect(server).not.toContain(`"${on}".into()`);
    }
    // Removing a device cuts its open connections at once, and keeps it
    // from asking to pair again for a while; a paired or removed device
    // can't use up a pairing code; one sync at a time per device; the
    // request line must come quickly.
    expect(link).toMatch(
      /pub async fn link_forget[\s\S]*?save_phones[\s\S]*?link\.removed[\s\S]*?link\.cut_off\(&id\)/,
    );
    expect(link).toMatch(
      /Some\(Request::Pair \{ \.\. \}\) if paired \|\| app\.state::<Link>\(\)\.recently_removed\(&remote\) =>[\s\S]*?Some\(Request::Pair \{ code, name \}\) =>\s*\{\s*let link = app\.state::<Link>\(\);\s*let code_ok = try_code/,
    );
    expect(link).toMatch(
      /Some\(Request::Sync\) if paired =>[\s\S]*?SyncTurn::take\(&link\.syncing, &remote\)/,
    );
    expect(link).toMatch(
      /tokio::time::timeout\(FIRST_LINE_TIME, read_line\(&mut recv\)\)/,
    );
    // Answers given on devices: the whole question logged (one line), out
    // of the screens' file space; the PC user is told at once, and the
    // PC's still-open dialog then says it was already answered.
    expect(remote).toMatch(
      /pub fn log_answer[\s\S]*?log_line\(when, device, yes, question\)/,
    );
    expect(remote).toMatch(
      /fn log_file[\s\S]*?crate::files::private_dir\(app\)/,
    );
    expect(tauri('src/files.rs')).toMatch(
      /pub fn pick_private[\s\S]*?!c\.starts_with\(screens\) && !screens\.starts_with\(c\)/,
    );
    expect(approval).toMatch(
      /Ok\(\(yes, name\)\) = device => \{\s*crate::remote_ask::log_answer\(app, &name, yes, question\);\s*answered_on_device\(/,
    );
    expect(approval).toMatch(
      /fn answered_on_device[\s\S]*?notification\(\)[\s\S]*?already answered on/,
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
    // The phone only ever asks for status, pairing, the PC's questions
    // and its answer to one, starting the PC's own
    // last model, or the model server.
    const ops = [...phone.matchAll(/"op\\?":\s*\\?"(\w+)/g)].map(m => m[1]);
    expect([...new Set(ops)].sort()).toEqual([
      'answer',
      'http',
      'pair',
      'questions',
      'start',
      'status',
      'sync',
    ]);
    // Key kept out of cloud backups.
    expect(
      read(
        'android/app/src/main/java/com/pocketagent/homelink/HomeLinkModule.kt',
      ),
    ).toContain('context.noBackupFilesDir');
  });

  it('the home link can never crash the app: failures come back as errors', () => {
    expect(read('native/homelink/Cargo.toml')).toMatch(/^panic = "unwind"$/m);
    expect(read('src-tauri/Cargo.toml')).toMatch(/^panic = "unwind"$/m);
    const android = read('native/homelink/src/android.rs');
    // Every door from Android goes through guarded(), and iroh gets the
    // app context first (it needs it to read the network settings).
    const doors = android.match(/pub extern "system" fn Java_\w+/g) || [];
    expect(doors.length).toBe(9);
    for (const door of doors) {
      const body = android.slice(android.indexOf(door));
      const next = body.indexOf('pub extern "system"', 10);
      expect([
        door,
        (next > 0 ? body.slice(0, next) : body).includes('guarded('),
      ]).toEqual([door, true]);
    }
    expect(android).toContain('iroh::dns::install_android_jni_context(');
  });

  it('the release token is used only by the publish steps', () => {
    const dir = path.join(__dirname, '..', '..', '.github', 'workflows');
    for (const file of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      // Split into steps; the token may appear only in "Publish pre-release".
      const steps = text.split(/\n\s+- name: /);
      for (const step of steps) {
        if (step.includes('RELEASE_TOKEN')) {
          expect([file, step.split('\n')[0].trim()]).toEqual([
            file,
            'Publish pre-release',
          ]);
        }
      }
    }
  });

  it('every published build comes with its SHA-256 checksums', () => {
    const dir = path.join(__dirname, '..', '..', '.github', 'workflows');
    for (const file of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const step of text.split(/\n\s+- name: /)) {
        if (step.includes('gh release create')) {
          expect([file, /\/SHA256SUMS \\\n/.test(step)]).toEqual([file, true]);
        }
      }
    }
  });

  it('the APK signing key is used only by the signing step, which keeps the debug key without it', () => {
    const dir = path.join(__dirname, '..', '..', '.github', 'workflows');
    let signing = '';
    for (const file of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const step of text.split(/\n\s+- name: /)) {
        if (/secrets\.ANDROID_KEY/.test(step)) {
          expect([file, step.split('\n')[0].trim()]).toEqual([
            'pocketagent-integration-apk.yml',
            'Sign the APK with our release key (when its secrets are set)',
          ]);
          signing = step;
        }
      }
    }
    expect(signing).toMatch(
      /if \[ -z "\$\{ANDROID_KEYSTORE_BASE64:-\}" \]; then[\s\S]*?exit 0/,
    );
    // The key file is removed again, and never printed.
    expect(signing).toContain(`trap 'rm -f "$keystore"' EXIT`);
    expect(signing).not.toMatch(/echo "\$ANDROID_KEY/);
  });

  it('network from the native side is http/https only', () => {
    const net = tauri('src/net.rs');
    expect(net).toMatch(/"http" \| "https" => \{\}/);
    expect(net).toMatch(/other => return Err/);
  });

  it('clipboard, screenshot, print, media keys and the quick key: each asks or is limited', () => {
    const x = tauri('src/pc_extra.rs');
    // Clipboard: the dialog shows the text itself before the model gets it.
    expect(x).toMatch(
      /if !crate::approval::ask\(&app, &clipboard_question\(&text\)\)\.await \{\s*return Err/,
    );
    expect(x).toMatch(/fn clipboard_question[\s\S]*?preview\(text, 600\)/);
    // Screenshot: asks first; nothing is taken on "no".
    expect(x).toMatch(
      /pub async fn take_screenshot[\s\S]*?if !crate::approval::ask\(&app, question\)\.await \{\s*return Ok\(None\);/,
    );
    // Print: documents and pictures only, and it asks.
    expect(x).toMatch(/if !printable\(&name\) \{\s*return Err/);
    expect(x).toMatch(
      /pub async fn print_file[\s\S]*?approval::ask\(&app, &question\)\.await/,
    );
    // Media keys: a fixed list, never any other key, and it asks natively.
    expect(x).toMatch(
      /let vk = media_vk\(&key\)\.ok_or[^;]*;\s*\/\/[^\n]*\n\s*if !crate::approval::ask\(&app, &media_question\(&key\)\)\.await \{\s*return Err/,
    );
    // The quick key is registered only when the user switches it on.
    const lib = tauri('src/lib.rs');
    expect(lib).toContain(
      'tauri_plugin_global_shortcut::Builder::new().build()',
    );
    expect(lib).not.toMatch(/with_shortcut|register\(QUICK_KEY\)/);
  });

  it("PC to PC: this PC as the other end uses the phone's own link library, unchanged", () => {
    const client = tauri('src/link_client.rs');
    expect(client).toContain('use homelink::Phone;');
    // Its own key (not the PC's link key), no address hint (dials by key),
    // kept where the screens can't read or write it, like the link key
    // (Credential Manager on Windows, a private file on Linux); an older
    // key file in the screens' folder is moved there (pairing is kept).
    expect(client).toContain(
      'const CLIENT_KEY_ENTRY: &str = "DesktopAgent-link:client-key";',
    );
    expect(client).toMatch(
      /crate::link::read_entry\(app, CLIENT_KEY_ENTRY\)[\s\S]*?crate::link::write_entry\(app, CLIENT_KEY_ENTRY/,
    );
    expect(client).toContain('Phone::with_key(key, None)');
    expect(client).not.toContain('Phone::new(');
    // The phone's own key file: owner only (0600).
    expect(read('native/homelink/src/lib.rs')).toMatch(
      /fn write_private[\s\S]*?\.mode\(0o600\)/,
    );
    // Failures come back as errors, never close the app.
    expect(client).toContain('catch_unwind');
    // The phone library's rules apply as they are (127.0.0.1 only, the PC's
    // QR tag only; pinned for the phone above).
    const cargo = tauri('Cargo.toml');
    expect(cargo).toContain(
      'homelink = { path = "../native/homelink", optional = true }',
    );
  });

  it("the PC's own tools: commands ask every time, files stay in the workspace", () => {
    const pc = tauri('src/pc.rs');
    // run_command: checked, then the native dialog with the whole command,
    // every time (approval::ask: Allow / Don't allow, never "always").
    expect(pc).toMatch(
      /let command = check_command\(&command\)\?;[\s\S]*?if !crate::approval::ask\(&app, &command_question\(&command\)\)\.await \{\s*return Err/,
    );
    expect(pc).not.toContain('ask_with_always');
    // The dialog shows exactly what runs: no carriage returns, controls or
    // invisible (bidi, zero-width) characters, a few lines at most, and it
    // says how many lines and characters there are.
    expect(pc).toMatch(
      /pub fn check_command[\s\S]*?c != '\\n' && c != '\\t' && crate::remote_ask::hidden_char\(c\)[\s\S]*?command\.lines\(\)\.count\(\) > MAX_LINES/,
    );
    expect(pc).toContain('pub const MAX_LINES: usize = 20;');
    expect(pc).toMatch(/fn command_question[\s\S]*?\{chars\} characters/);
    expect(pc).not.toContain('remember');
    // Runs in the workspace folder, with a time limit.
    expect(pc).toMatch(/run\(&command, &dir, COMMAND_TIME_LIMIT\)/);
    // open_workspace_file: never programs or scripts, and it asks.
    expect(pc).toMatch(/if !openable\(&name\) \{\s*return Err/);
    for (const ext of ['exe', 'bat', 'cmd', 'ps1', 'lnk', 'js', 'vbs', 'msi']) {
      expect(
        pc.slice(pc.indexOf('const OPENABLE'), pc.indexOf('pub fn openable')),
      ).not.toContain(`"${ext}"`);
    }
    // Documents: the app's own folder only.
    const docs = tauri('src/docs.rs');
    expect(docs).toMatch(/if !located\.own \{\s*return Err/);
    // Files in and out only through the user's own choice in a native dialog.
    const transfer = tauri('src/transfer.rs');
    expect(transfer).toContain('blocking_pick_file()');
    expect(transfer).toContain('blocking_save_file()');
    expect(transfer).toMatch(
      /if !located\.own \|\| !located\.real\.is_file\(\) \{\s*return Err/,
    );
  });

  it('opening things outside: pages, e-mail drafts, settings pages only, and it asks', () => {
    const open = tauri('src/open.rs');
    // Checked first, then the native dialog with the exact target, then opened.
    expect(open).toMatch(
      /let target = check_target\(&target\)\?;\s*if !crate::approval::ask\(&app, &question\(&target\)\)\.await \{\s*return Err/,
    );
    // Web pages go through the same check as the network door (no *.localhost).
    expect(open).toContain('crate::net::check_url(target)?');
    // No shell: the system's own handler (Windows) or one argument (Linux).
    expect(open).toContain('ShellExecuteW(');
    expect(open).not.toMatch(/Command::new\("(cmd|powershell|sh|bash)"/);
    // E-mail: a draft only, never attachments.
    expect(open).toMatch(/\["to", "cc", "bcc", "subject", "body"\]/);
  });

  it("never fetches the app's own addresses or passes on the bridge's key", () => {
    const net = tauri('src/net.rs');
    // The native bridge (ipc.localhost), the app and previews are *.localhost.
    expect(net).toMatch(/host\.ends_with\("\.localhost"\)/);
    expect(net).toMatch(/eq_ignore_ascii_case\("tauri-invoke-key"\)/);
    expect(net).toMatch(/filter\(\|\(n, _\)\| header_allowed\(n\)\)/);
    // The page's network layer leaves them alone too (the 40 s Windows start).
    expect(read('web/tauriNet.js')).toMatch(/!host\.endsWith\('\.localhost'\)/);
  });
});

describe('Paired devices: sync, mirrored chats, answers (review of 2026-11-15)', () => {
  it('what comes from a paired device is checked, bounded and kept', () => {
    // Custom tools from a sync (or deleted) are switched off before saving.
    const tools = read('src/services/talents/customTools.ts');
    expect(tools).toMatch(
      /await changeToolSwitches\(async \(\) => \{\s*await switchOffNow\(\[\.\.\.names\]\.filter\(n => !kept\.has\(n\)\)\);\s*await persist\(list\);/,
    );
    expect(tools).toMatch(
      /deleteCustomTool[\s\S]*?changeToolSwitches\(async \(\) => \{\s*await switchOffNow\(\[name\]\);/,
    );
    // Every write to the switches waits its turn, and the Toolbox switches
    // one name (or group) against the stored list, never its own copy.
    expect(tools).toMatch(
      /export function switchOffTools[^{]*\{\s*return changeToolSwitches\(/,
    );
    const settings = read('src/utils/globalToolSettings.ts');
    expect(settings).toMatch(
      /export function writeGlobalTools[^{]*\{\s*return changeToolSwitches\(/,
    );
    expect(settings).toMatch(
      /export function setToolsEnabled[\s\S]*?return changeToolSwitches\(async \(\) => \{\s*\/\/[^\n]*\n\s*const stored = await readGlobalTools\(\)/,
    );
    expect(settings.match(/AsyncStorage\.setItem\(\s*KEY,/g)).toHaveLength(1);
    const toolbox = read('src/screens/ToolboxScreen.tsx');
    expect(toolbox).not.toContain('writeGlobalTools');
    expect(toolbox).toContain('onToolSwitchesChanged(');
    // Times from another device: at most a few minutes ahead.
    const prompt = read('src/services/sync/promptSync.ts');
    expect(prompt).toContain('export const MAX_CLOCK_SKEW = 5 * 60_000;');
    expect(prompt).toContain('updatedAt: clampTime(item.updatedAt, now)');
    expect(prompt).toContain('updatedAt: Math.min(item.updatedAt, now)');
    expect(read('src/services/sync/chatDeletes.ts')).toContain(
      't.deletedAt <= now + MAX_CLOCK_SKEW',
    );
    // Mirrored messages: known authors, kinds and metadata keys only.
    const chats = read('src/services/sync/chatSync.ts');
    expect(chats).toContain(
      "export const MIRRORED_TYPES: readonly string[] = ['text', 'assistant_turn'];",
    );
    const metadata = chats.slice(
      chats.indexOf('const METADATA'),
      chats.indexOf('export function mirroredMetadata'),
    );
    expect(metadata).not.toMatch(/imageUris|audioUri|uri\b/i);
    expect(chats).toContain('.map((m: any) => mirroredMessage(m, id, now))');
    // A copy that drops messages keeps the earlier version first.
    expect(read('src/services/sync/hostSync.web.ts')).toContain(
      'keep: (here, list) => keepEarlierVersions(here, list, from)',
    );
    expect(read('src/services/sync/deviceSync.ts')).toContain(
      "await keepEarlierVersions(local, newer, 'the PC')",
    );
    // Store assistants are never rewritten by a sync.
    expect(read('src/services/sync/syncSources.ts')).toContain(
      'const local = all.filter(isOwn);',
    );
    // Assistant deletions: times clamped, only your own deleted, asked
    // first above 5, removed ones kept (restorable).
    const assistants = read('src/services/sync/assistantDeletes.ts');
    expect(assistants).toContain('t <= now + MAX_CLOCK_SKEW;');
    expect(assistants).toContain('editedAt: clampTime(at, now),');
    expect(assistants).toContain('export const DELETE_CAP = 5;');
    expect(assistants).toContain(
      'ownPals: () => (palStore().pals as Pal[]).filter(isOwn),',
    );
    expect(assistants).toMatch(
      /await store\.save\(RECENT_KEY, \[\.\.\.added, \.\.\.recent\]\);\s*for \(const r of added\) \{\s*await store\.remove/,
    );
    // Pictures: never a web address, only the app's own picture folder.
    expect(read('src/api/openai.ts')).toMatch(
      /if \(!isOwnImagePath\(url\)\) \{[^}]*return null;/,
    );
    // A PC question too long to show whole can only be refused here.
    expect(read('src/services/homeLink/pcQuestions.ts')).toMatch(
      /questionView\(q\)\.shortened\s*\?\s*\[no\]/,
    );
  });
});
