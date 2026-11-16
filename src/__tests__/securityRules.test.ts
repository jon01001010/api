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
/** A workflow's jobs, by name (the two-space keys under `jobs:`). */
const jobsOf = (workflow: string): Record<string, string> => {
  const body = workflow.slice(workflow.indexOf('\njobs:\n'));
  const out: Record<string, string> = {};
  const heads = [...body.matchAll(/^ {2}([\w-]+):\n/gm)];
  heads.forEach((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : body.length;
    out[m[1]] = body.slice(m.index, end);
  });
  return out;
};
const stepNamed = (job: string, name: string) => {
  const step = job
    .split(/\n\s+- name: /)
    .find(s => s.split('\n')[0].trim() === name);
  if (!step) {
    throw new Error(`no step "${name}"`);
  }
  return step;
};
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
  it('memory search: all notes by default, earlier chats off, snippets wrapped', () => {
    const {DEFAULT_PROMPT_PARTS} = require('../utils/promptParts');
    expect(DEFAULT_PROMPT_PARTS.memoryMode).toBe('all');
    expect(DEFAULT_PROMPT_PARTS.pastChats).toBe(false);
    expect(read('src/services/talents/memoryForMessage.ts')).toMatch(
      /wrapPastChats\(formatPastSnippets\(snippets\)\)/,
    );
    expect(read('src/services/talents/pastChats.ts')).toMatch(
      /row\.author !== userId \|\| row\.type !== 'text'/,
    );
  });

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

  it('a shared loop (PA1:L:) is data, shown in full, installed paused and not started', () => {
    const src = read('src/services/loops/loopShare.ts');
    expect(src).not.toMatch(/talentRegistry|\.execute\(|eval\(|new Function/);
    // Built like any loop (same hard limits), then held back.
    expect(src).toMatch(/buildLoop\(/);
    const install = src.slice(
      src.indexOf('export async function installSharedLoop'),
    );
    expect(install).toMatch(/paused: true,\s*notStarted: true,\s*runs: 0/);
    // A loop that hasn't been started can't be run.
    const runner = read('src/services/loops/loopRunner.ts');
    expect(runner).toMatch(/if \(loop\.notStarted\) \{\s*return /);
  });

  it('a loop plan is data: fixed step kinds, tools through the chat loop gate, guards', () => {
    const {
      STEP_KINDS,
      FORBIDDEN_PLAN_TOOLS,
    } = require('../services/loops/plan');
    expect([...STEP_KINDS].sort()).toEqual([
      'ask_model',
      'ask_user',
      'check',
      'notify',
      'repeat',
      'save',
      'use_tool',
      'wait',
    ]);
    expect(FORBIDDEN_PLAN_TOOLS).toEqual(['tool_save', 'tool_delete']);
    const plan = read('src/services/loops/plan.ts');
    const runner = read('src/services/loops/planRunner.ts');
    for (const src of [plan, runner]) {
      expect(src).not.toMatch(/\.execute\(|eval\(|new Function/);
    }
    // Tools: only switched-on built-ins, through AgentRunner's own gate.
    expect(runner).toMatch(/runToolCall\(/);
    expect(runner).toMatch(/builtInToolNames\(\)/);
    expect(runner).toMatch(/readGlobalTools\(\)/);
    expect(read('src/services/agent/AgentRunner.ts')).toMatch(
      /export function runToolCall[\s\S]*?return executeOne\(/,
    );
    // Runaway stop: the runner never changes a plan, a schedule, a tool
    // switch, and never starts a plan from a step.
    expect(runner).not.toMatch(
      /savePlanVersion|savePlanEdit|restorePlanVersion|setToolsEnabled|setToolEnabled|writeGlobalTools|startLoop|saveLoops|nextAt/,
    );
    expect(runner.match(/startPlanRun\(/g)).toHaveLength(1);
    // A step running when the app closed is asked about, never re-run.
    expect(runner).toMatch(/kind: 'restart'/);
    // Guards on by default.
    const {DEFAULT_GUARDS} = require('../services/loops/plan');
    expect(DEFAULT_GUARDS).toEqual({
      maxSteps: 50,
      maxMinutes: 10,
      maxModelCalls: 10,
      maxToolCalls: 10,
    });
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

  it('a Home PC PIN guards every link request, and only its hash is kept', () => {
    const link = read('src/services/homeLink/homeLink.ts');
    const ask = link.slice(link.indexOf('async function ask'));
    // The gate comes before the native call; only pairing (the PC asks)
    // and closing the tunnel pass without it.
    expect(ask.indexOf('homePcGate(')).toBeGreaterThan(0);
    expect(ask.indexOf('homePcGate(')).toBeLessThan(
      ask.indexOf('await mod[method]'),
    );
    expect(ask).toMatch(
      /method !== 'pair' && method !== 'closeTunnel'\) \{\n\s*const gate = await homePcGate/,
    );
    const lock = read('src/services/homeLink/homePcLock.ts');
    expect(lock).toMatch(/TRIES_BEFORE_WAIT = 5\b/);
    expect(lock).toMatch(/FIRST_WAIT_MS = 5 \* 60 \* 1000/);
    // What is saved: salt, hash, rounds, settings and the try count.
    expect(lock).not.toMatch(/JSON\.stringify\(\{[^}]*\bpin\b/);
    expect(read('src/services/homeLink/pinHash.ts')).toMatch(
      /PIN_ITERATIONS = \d{2,3}_000/,
    );
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
        'fs_hash',
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
        'outside_files',
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
        'model_server_problem',
        'image_generate',
        'image_cancel',
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
        'link_pictures_allow',
        'link_device_may_picture',
        'link_tools_allow',
        'link_device_may_read',
        'link_device_may_act',
        'link_device_may_command',
        'link_device_may_write',
        'homelink_pair',
        'homelink_status',
        'homelink_start_model',
        'homelink_open_tunnel',
        'homelink_sync',
        'homelink_questions',
        'homelink_answer_question',
        'homelink_picture',
        'homelink_tool',
        'homelink_close_tunnel',
        'link_key_mode',
        'link_use_one_key',
        'link_circle',
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
      'fs_hash',
      'fs_list',
      'fs_mkdir',
      'fs_move',
      'fs_read',
      'fs_remove',
      'fs_stat',
      'fs_write',
    ]);
    for (const [, name, body] of fns) {
      // fs_hash: the app's own files only, never outside (nothing to ask).
      const rule = name === 'fs_hash' ? 'own_file(&app' : 'allowed(&app';
      expect([name, body.includes(rule)]).toEqual([name, true]);
    }
    expect(files).toMatch(
      /fn own_file\([\s\S]*?if !located\.own \{\s*return Err[\s\S]*?if !stays_inside\(&root, &located\.real\) \{\s*return Err/,
    );
    expect(files).toMatch(
      /if !algorithm\.eq_ignore_ascii_case\("sha256"\) \{\s*return Err/,
    );
    // Outside the app's folder: resolved and checked against the places
    // never reachable first, then asked, then logged. A link in the app's
    // own folder that leads out is refused.
    expect(files).toMatch(
      /if located\.own \{\s*if !stays_inside\(&root, &located\.real\) \{\s*return Err[\s\S]*?return Ok\(located\.real\);\s*\}[\s\S]*?crate::outside::checked\(app, &located\.real\)[\s\S]*?let yes = ask\(app, &question\)\.await;\s*crate::outside::audit\(/,
    );
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
    // A LoRA adapter: only a .gguf in the app's own folder (no link), and
    // the server never runs in the app's folder (llama.cpp loads backend
    // DLLs from the folder it runs in).
    expect(server).toMatch(
      /let found = crate::files::locate\(&root, p\)\?;[\s\S]*?if !found\.own \|\| link \|\| !is_gguf\(&found\.real\)/,
    );
    expect(server).toContain('command.current_dir(dir);');
    expect(tauri('src/link.rs')).toContain(
      'last.lora_path.map(|p| (p, last.lora_scale.unwrap_or(1.0)))',
    );
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

  it('device circle stage 2: signed removal notices only remove, and are checked', () => {
    const circle = read('native/homelink/src/circle.rs');
    // A fixed label first, then every field: no other signature passes.
    expect(circle).toContain(
      'pub const REMOVAL_LABEL: &str = "PA circle remove v1";',
    );
    expect(circle).toContain(
      'format!("{REMOVAL_LABEL}\\n{removed}\\n{by}\\n{n}\\n{at}")',
    );
    // A notice is a key to remove and nothing else (no device to add, no
    // right); anything more is not a notice.
    expect(circle).toMatch(
      /#\[serde\(deny_unknown_fields\)\]\s*pub struct Removal \{\s*\/\/\/[^\n]*\n\s*pub removed: String,\s*\/\/\/[^\n]*\n\s*pub by: String,\s*\/\/\/[^\n]*\n\s*pub n: u64,\s*\/\/\/[^\n]*\n\s*pub at: u64,\s*\/\/\/[^\n]*\n\s*pub sig: String,\s*\}/,
    );
    // Checked: a key this device trusts, its signature (iroh's strict
    // Ed25519 check), at most 5 minutes ahead, at most 30 days old, a new
    // number, never about this device.
    const check = circle.slice(
      circle.indexOf('pub fn check_removal'),
      circle.indexOf('/// A notice to pass on'),
    );
    for (const step of [
      'if !trusted.iter().any(|k| *k == r.by)',
      'by.verify(signed_text(&r.removed, &r.by, r.n, r.at).as_bytes(), &sig).is_err()',
      'r.at > now.saturating_add(MAX_AHEAD_SECS)',
      'r.at.saturating_add(MAX_AGE_SECS) < now',
      'last_seen.is_some_and(|seen| r.n <= seen)',
      'me.iter().any(|k| *k == r.removed)',
    ]) {
      expect(check).toContain(step);
    }
    expect(check.trim().endsWith('Verdict::Apply\n}')).toBe(true);
    expect(circle).toContain('pub const MAX_AHEAD_SECS: u64 = 5 * 60;');
    // On the PC, a notice removes exactly as "Remove here" does and goes
    // through nothing that adds a device or sets a right; paired devices
    // only.
    const link = tauri('src/link.rs');
    const pcCircle = link.slice(
      link.indexOf(
        '// ------------------------------------------------- device circle, stage 2',
      ),
      link.indexOf('/// Which commit this PC app was built from'),
    );
    expect(pcCircle).not.toMatch(
      /add_phone\(|Phone::new\(|set_may_|ask_on_this_pc|PICTURES_ENTRY|TOOLS_ENTRY|sync_allowed/,
    );
    expect(pcCircle).toContain(
      'forget_here(app, &notice.removed, "removed-by-notice")',
    );
    expect(link).toMatch(
      /Some\(Request::Removal \{ notices \}\) if paired => \{[\s\S]*?take_removals\(&app, &remote, false, &notices\);/,
    );
    // Its state is kept where the screens can't write (the credential
    // store on the PC; the phone's no-backup folder, owner only).
    expect(link).toContain(
      'const CIRCLE_ENTRY: &str = "DesktopAgent-link:circle";',
    );
    expect(circle).toContain('key_file.with_file_name("circle.json")');
    expect(circle).toContain('crate::write_private(&tmp,');
    // The screens can only ask to remove, or read what was removed.
    const phoneLib = read('native/homelink/src/lib.rs');
    const call = phoneLib.slice(
      phoneLib.indexOf('pub fn circle_call'),
      phoneLib.indexOf('\n    }\n', phoneLib.indexOf('pub fn circle_call')),
    );
    expect([...call.matchAll(/Some\("(\w+)"\)/g)].map(m => m[1])).toEqual([
      'remove',
      'news',
    ]);
    expect(
      [...pcCircle.matchAll(/Some\("(\w+)"\) =>/g)].map(m => m[1]),
    ).toEqual(['remove', 'news']);
    // In the screens: a received removal removes the Home PC entry and
    // tells the user, never asks, never adds; only "Remove here" signs one.
    const js = read('src/services/homeLink/circle.ts');
    expect(js).not.toMatch(/addServer|linkDeviceMay|link_device_may|pair/i);
    const signers = sourceFiles(SRC)
      .filter(f => /tellRemoval\(/.test(fs.readFileSync(f, 'utf8')))
      .map(rel);
    // Only the user's own Remove (Your devices, or a Home PC's sheet).
    expect(signers.sort()).toEqual([
      'src/components/ServerDetailsSheet/ServerDetailsSheet.tsx',
      'src/components/YourDevices/YourDevices.tsx',
    ]);
  });

  it('device circle stage 1: one key only by the user\'s choice, and "Your devices" gives no rights', () => {
    // Moving a PC to one key is only the user's button, after a question
    // that says its pairings as a device must be made again by hand.
    const users = sourceFiles(SRC)
      .filter(f => /linkUseOneKey\(/.test(fs.readFileSync(f, 'utf8')))
      .map(rel);
    expect(users.sort()).toEqual(
      [
        'src/screens/SettingsScreen/HomeLinkCard.tsx',
        'src/services/desktop/homeLink.ts',
      ].sort(),
    );
    const list = read('src/components/YourDevices/YourDevices.tsx');
    expect(list).toMatch(
      /text: 'Use one key',\s*onPress: async \(\) => \{\s*try \{\s*await onUseOneKey\?\.\(\);/,
    );
    expect(list).toContain('pair with each one again by hand');
    // The list only reads; rights are switched (and asked) on the PC that
    // gives them, never from here.
    for (const file of [
      'src/components/YourDevices/YourDevices.tsx',
      'src/services/homeLink/yourDevices.ts',
    ]) {
      expect(read(file)).not.toMatch(/linkDeviceMay|link_device_may|invoke\(/);
    }
    // Natively: no automatic move, no new device keys, one endpoint.
    const client = read('src-tauri/src/link_client.rs');
    expect(client).toContain(
      'one_key.map(str::trim) == Some("on") || !has_own_key',
    );
    expect(client).not.toMatch(/SecretKey::generate\(\)/);
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
      'Picture',
      'Questions',
      'Removal',
      'Start',
      'Status',
      'Sync',
      'Tool',
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
    expect(link).toContain(
      'add_phone(&mut phones, Phone::new(remote.clone(), name.clone(), now_secs()));',
    );
    expect(link).toMatch(
      /pub fn new\(id: String, name: String, paired_at: u64\) -> Self \{\s*Phone \{\s*id,\s*name,\s*may_answer: false,\s*may_picture: false,\s*may_read: false,\s*may_act: false,\s*may_command: false,\s*may_write: false,\s*paired_at: Some\(paired_at\),\s*\}/,
    );
    expect(link).toMatch(
      /pub async fn link_device_may_answer[\s\S]*?if allowed \{[\s\S]*?if !crate::approval::ask_on_this_pc\(&app, &question\)\.await \{\s*return Err[\s\S]*?let mut phones = load_phones\(&app\);[\s\S]*?save_phones/,
    );
    expect(link).toContain(
      "This device may not answer this PC's questions; allow it on the PC",
    );
    expect(ops).toMatch(/^\s{4}Answer \{ id: u64, yes: bool \},$/m);
    // "picture": paired devices only, only while the user allows pictures
    // here and for that device (each allowed in the PC's own dialog, off by
    // default, again after pairing anew); the device sends a prompt, sizes
    // and steps only (never a model or a path: the PC uses its own first
    // downloaded set); the same maker, caps, word check and one-at-a-time
    // slot as the PC's own tool; the PC is told; at most 8 MB, a PNG.
    expect(link).toMatch(
      /Some\(Request::Picture \{ prompt, width, height, steps \}\) if paired => \{\s*let phones = load_phones\(&app\);\s*if !pictures_allowed\(&app\) \{\s*reply\(&mut send, serde_json::json!\(\{"ok": false, "error": OFF_PICTURES\}\)\)\.await;\s*\} else if !may_picture\(&phones, &remote\) \{\s*reply\(&mut send, serde_json::json!\(\{"ok": false, "error": NOT_THIS_DEVICE_PICTURES\}\)\)\.await;\s*\} else \{[\s\S]*?picture_for\(/,
    );
    const picture = ops.slice(ops.indexOf('Picture {'), ops.indexOf('Tool {'));
    expect(
      [...picture.matchAll(/^\s+(\w+): /gm)].map(m => m[1]).sort(),
    ).toEqual(['height', 'prompt', 'steps', 'width']);
    const tool = ops.slice(ops.indexOf('Tool {'), ops.indexOf('Removal {'));
    expect([...tool.matchAll(/^\s+(\w+): /gm)].map(m => m[1]).sort()).toEqual([
      'args',
      'chat',
      'name',
    ]);
    // "removal" (device circle stage 2): notices only.
    const removal = ops.slice(ops.indexOf('Removal {'), ops.indexOf('Http,'));
    expect([...removal.matchAll(/^\s+(\w+): /gm)].map(m => m[1])).toEqual([
      'notices',
    ]);
    expect(removal).toContain('notices: Vec<homelink::circle::Removal>,');
    expect(link).toMatch(
      /async fn picture_for[\s\S]*?crate::image_gen::first_downloaded_set\(app\)\?[\s\S]*?crate::image_gen::make\([\s\S]*?notification\(\)[\s\S]*?picture_note\([\s\S]*?if size > MAX_PICTURE as u64 \{\s*return Err/,
    );
    expect(link).toContain('pub const MAX_PICTURE: usize = 8 * 1024 * 1024;');
    expect(link).toMatch(
      /#\[serde\(default, rename = "mayPicture"[^\n]*\]\s*pub may_picture: bool,/,
    );
    expect(link).toMatch(
      /pub async fn link_device_may_picture[\s\S]*?if allowed \{[\s\S]*?if !crate::approval::ask_on_this_pc\(&app, &question\)\.await \{\s*return Err[\s\S]*?let mut phones = load_phones\(&app\);[\s\S]*?save_phones/,
    );
    expect(link).toContain(
      'const PICTURES_ENTRY: &str = "DesktopAgent-link:pictures";',
    );
    expect(link).toMatch(
      /fn pictures_allowed\(app: &AppHandle\) -> bool \{\s*read_entry\(app, PICTURES_ENTRY\)\.as_deref\(\) == Some\("on"\)/,
    );
    // "tool" (stage 1 of "the phone uses the PC's tools", read only):
    // paired devices only; then the PC's switch (kept natively, across
    // restarts, like pictures), this device's "may read" (off by default,
    // again after pairing anew, turned on only after the PC's own dialog),
    // a fixed list of three tools, then the arguments (a chat id, and a
    // workspace file name, never a path). Same functions and caps as the
    // PC's own tools; reading asks once per chat, natively (approval::ask,
    // which a device that may answer can answer); each read notifies.
    // Stage 2 adds "may act" (its own flag) for four of the PC's tools that
    // already ask; the order of the checks is unchanged: switch → this
    // device's flag for that tool → the fixed list → the arguments.
    expect(link).toMatch(
      /Some\(Request::Tool \{ name, chat, args \}\) if paired => \{\s*let phones = load_phones\(&app\);\s*let may = DeviceMay \{\s*read: may_read\(&phones, &remote\),\s*act: may_act\(&phones, &remote\),\s*command: may_command\(&phones, &remote\),\s*write: may_write\(&phones, &remote\),\s*\};\s*let checked = check_tool\(tools_allowed\(&app\), may, &name, &chat, &args\);/,
    );
    expect(link).toMatch(
      /pub fn check_tool[^{]*\{\s*if !tools_on \{\s*return Err\(OFF_TOOLS\.into\(\)\);\s*\}\s*let writes = WRITE_TOOLS\.contains\(&name\);\s*let commands = COMMAND_TOOLS\.contains\(&name\);\s*let acts = ACT_TOOLS\.contains\(&name\);\s*let device_may = if writes \{\s*may\.write\s*\} else if commands \{\s*may\.command\s*\} else if acts \{\s*may\.act\s*\} else if REMOTE_TOOLS\.contains\(&name\) \{\s*may\.read\s*\} else \{\s*may\.read \|\| may\.act \|\| may\.command \|\| may\.write\s*\};\s*if !device_may \{\s*return Err[^;]*;\s*\}\s*if !REMOTE_TOOLS\.contains\(&name\) \{\s*return Err\(NOT_A_REMOTE_TOOL\.into\(\)\);\s*\}\s*check_chat\(chat\)\?;[\s\S]*?crate::pc_files::check_name\(file\)\?[\s\S]*?crate::pc_extra::media_vk\(key\)\.is_none\(\)[\s\S]*?"pc_run_command" => \{[\s\S]*?Ok\(RemoteCall::Command\(crate::pc::check_command\(command\)\?\)\)/,
    );
    // The fixed list: exactly stage 1's reads, stage 2's actions, stage
    // 3's command and stage 4's writes.
    const remoteTools = link.match(
      /pub const REMOTE_TOOLS: &\[&str\] = &\[([^\]]*)\];/,
    );
    expect(
      [...(remoteTools?.[1] ?? '').matchAll(/"(\w+)"/g)].map(m => m[1]),
    ).toEqual([
      'pc_info',
      'workspace_list',
      'workspace_read',
      'pc_open',
      'pc_print',
      'pc_media',
      'pc_clipboard_read',
      'pc_run_command',
      'workspace_write',
      'workspace_append',
      'workspace_undo',
    ]);
    expect(link).toContain(
      'pub const COMMAND_TOOLS: &[&str] = &["pc_run_command"];',
    );
    expect(link).toContain(
      'pub const WRITE_TOOLS: &[&str] = &["workspace_write", "workspace_append", "workspace_undo"];',
    );
    expect(link).toContain(
      'pub const ACT_TOOLS: &[&str] = &["pc_open", "pc_print", "pc_media", "pc_clipboard_read"];',
    );
    const toolArgs = link.slice(
      link.indexOf('pub struct ToolArgs'),
      link.indexOf('pub enum RemoteCall'),
    );
    expect([...toolArgs.matchAll(/pub (\w+): /g)].map(m => m[1])).toEqual([
      'file',
      'key',
      'command',
      'bytes',
      // Shown in the question only (approval::with_thinking), never parsed.
      'thinking',
    ]);
    // "may act": off by default (old records too, and again after pairing
    // anew), turned on only after the PC's own dialog (no device can
    // answer it), recorded in the pairing history.
    expect(link).toMatch(
      /#\[serde\(default, rename = "mayAct"[^\n]*\]\s*pub may_act: bool,/,
    );
    expect(link).toMatch(
      /pub async fn link_device_may_act[\s\S]*?if allowed \{[\s\S]*?if !crate::approval::ask_on_this_pc\(&app, &question\)\.await \{\s*return Err[\s\S]*?let mut phones = load_phones\(&app\);[\s\S]*?save_phones[\s\S]*?record\(&app, "may-act"/,
    );
    // Each action is the PC's own function (no copy), which asks natively
    // every time naming the device, and checks the switch and the flag
    // again after the answer; then logged and notified.
    expect(link).toMatch(
      /async fn act_for[\s\S]*?let still_allowed = \|\| tools_allowed\(app\) && may_act\(&load_phones\(app\), remote\);[\s\S]*?crate::pc::open_file\(app, file, Some\(&by\), thinking\)\.await\?[\s\S]*?crate::pc_extra::print_workspace_file\(app, file, Some\(&by\), thinking\)\.await\?[\s\S]*?crate::pc_extra::press_media_key\(app, key, Some\(&by\), thinking\)\.await\?[\s\S]*?crate::pc_extra::read_clipboard\(app, Some\(&by\), thinking\)\.await\?[\s\S]*?log_use\(app, device, &note\)[\s\S]*?notification\(\)/,
    );
    expect(link).toMatch(
      /async fn tool_for[^{]*\{\s*if let RemoteCall::Command\(command\) = &call \{\s*return command_for\(app, remote, device, command, thinking\)\.await;\s*\}\s*if matches!\(call, RemoteCall::Open\(_\) \| RemoteCall::Print\(_\) \| RemoteCall::Media\(_\) \| RemoteCall::ClipboardRead\) \{\s*return act_for\(app, remote, device, call, thinking\)\.await;/,
    );
    // Stage 3: "may run commands", its own flag (separate from "may act"),
    // off by default (old records too, and again after pairing anew),
    // turned on only after the PC's own dialog with a strong warning,
    // recorded in the pairing history. A command runs through the very same
    // function as the PC's own run_command (check_command, the whole command
    // asked natively every time naming the device, never "always", the
    // workspace folder, 60 s, the output capped), the switch and the flag
    // checked again after the answer; the whole command logged, a
    // notification for each, the output sent without this PC's paths.
    expect(link).toMatch(
      /#\[serde\(default, rename = "mayCommand"[^\n]*\]\s*pub may_command: bool,/,
    );
    expect(link).toMatch(
      /pub async fn link_device_may_command[\s\S]*?if allowed \{[\s\S]*?let question = may_command_question\(&name, &key\);\s*if !crate::approval::ask_on_this_pc\(&app, &question\)\.await \{\s*return Err[\s\S]*?let mut phones = load_phones\(&app\);[\s\S]*?save_phones[\s\S]*?record\(&app, "may-command"/,
    );
    expect(link).toContain(
      'can run anything you can on this PC, after you allow each command',
    );
    expect(link).toMatch(
      /async fn command_for[\s\S]*?let still_allowed = \|\| tools_allowed\(app\) && may_command\(&load_phones\(app\), remote\);[\s\S]*?let ran = crate::pc::run_checked_command\(app, command, Some\(&by\), thinking\)\.await\?;[\s\S]*?log_use\(app, device, &format!\("ran a command \(\{how\}\): \{command\}"\)\)[\s\S]*?notification\(\)[\s\S]*?command_note\([\s\S]*?"output": output_for_device\(&ran\.output, &local_folders\(app\)\)/,
    );
    // Stage 4: "may write", its own flag (separate from the other three),
    // off by default (old records too, and again after pairing anew),
    // turned on only after the PC's own dialog, recorded in the pairing
    // history. The arguments: a workspace name through the same check as
    // reads, a text kind that opens in a viewer (never a program or a
    // script), the size announced (at most 256 KB); the text itself is
    // read only after every check. Each change is worked out first, then
    // asked natively EVERY time (approval::ask_for, never "always"),
    // naming the device and showing the change before and after; the
    // switch and the flag checked again after the answer; the previous
    // version kept; logged and notified with the file and line counts only.
    expect(link).toMatch(
      /#\[serde\(default, rename = "mayWrite"[^\n]*\]\s*pub may_write: bool,/,
    );
    expect(link).toMatch(
      /pub async fn link_device_may_write[\s\S]*?if allowed \{[\s\S]*?let question = may_write_question\(&name, &key\);\s*if !crate::approval::ask_on_this_pc\(&app, &question\)\.await \{\s*return Err[\s\S]*?let mut phones = load_phones\(&app\);[\s\S]*?save_phones[\s\S]*?record\(&app, "may-write"/,
    );
    expect(link).toMatch(
      /"workspace_write" \| "workspace_append" \| "workspace_undo" => \{[\s\S]*?let file = file\(\)\?;\s*if !crate::pc_write::writable\(&file\) \{\s*return Err[\s\S]*?if n > crate::pc_write::MAX_WRITE as u64/,
    );
    expect(link).toMatch(
      /let checked = check_tool\([\s\S]*?RemoteCall::Write \{ bytes, \.\. \} => read_text\(&mut recv, \*bytes\)\.await,/,
    );
    expect(link).toMatch(
      /async fn write_for[\s\S]*?let still_allowed = \|\| tools_allowed\(app\) && may_write\(&load_phones\(app\), remote\);[\s\S]*?crate::pc_write::plan\([\s\S]*?if !crate::approval::ask_for\(app, &crate::pc_write::question\(device, &plan\), Some\(&by\), thinking\)\.await \{\s*return Err[\s\S]*?crate::pc_write::apply\([\s\S]*?log_use\(app, device, &note\)[\s\S]*?notification\(\)/,
    );
    const writeFor = link.slice(
      link.indexOf('async fn write_for'),
      link.indexOf('async fn read_text'),
    );
    expect(writeFor).not.toMatch(/ask_with_always|Always|ask_on_this_pc/);
    expect(link).toMatch(
      /if let RemoteCall::Write \{ file, kind, \.\. \} = call \{\s*return write_for\(app, remote, device, file, kind, text, thinking\)\.await;/,
    );
    const pcWrite = tauri('src/pc_write.rs');
    expect(pcWrite).toContain(
      'pub const MAX_WRITE: usize = crate::pc_files::MAX_TEXT;',
    );
    expect(pcWrite).toMatch(
      /pub fn writable\(name: &str\) -> bool \{\s*crate::pc_files::text_kind\(name\) && crate::pc::openable\(name\)\s*\}/,
    );
    expect(pcWrite).toMatch(
      /pub fn plan[\s\S]*?let file = crate::pc_files::check_name\(file\)\?;\s*if !writable\(file\) \{/,
    );
    // The previous version is kept before anything is written; a file
    // that changed meanwhile is never written over.
    expect(pcWrite).toMatch(
      /pub fn apply[\s\S]*?if current\(&path, &plan\.file\)\? != plan\.previous \{\s*return Err[\s\S]*?save_snapshot\(history, &plan\.file, previous\)\?;[\s\S]*?create_new\(true\)/,
    );
    // Long changes are shown head and tail, saying how much is left out.
    expect(pcWrite).toContain('more line{} of the change not shown here');
    expect(pcWrite).toContain('… (+{more} characters)');
    // The answers log keeps who and what, never the text of a change.
    const ask = tauri('src/remote_ask.rs');
    expect(ask).toMatch(
      /if first\.starts_with\('\\u\{201c\}'\) && first\.ends_with\(WRITE_ASK_DEVICE\) \{[\s\S]*?\(the change itself is not logged\)/,
    );
    const commandFor = link.slice(
      link.indexOf('async fn command_for'),
      link.indexOf('async fn tool_for'),
    );
    expect(commandFor).not.toMatch(/ask_with_always|Always|crate::pc::run\(/);
    expect(link).toContain('pub const MAX_DEVICE_OUTPUT: usize = 32 * 1024;');
    // The clipboard by its length only in the log and the notification.
    expect(link).toMatch(
      /RemoteCall::ClipboardRead => format!\("\{device\} got the text on this PC's clipboard \(\{clipboard_chars\} characters\)"\)/,
    );
    // The same plain "Allow?" every time (never "always"), the asking
    // device named; a device's yes counts only while still allowed.
    const approvalRs = tauri('src/approval.rs');
    expect(approvalRs).toMatch(
      /pub async fn ask_for[^{]*\{\s*let yes = ask\(app, &with_thinking\(question, thinking\)\)\.await && by\.is_none_or\(\|d\| \(d\.still_allowed\)\(\)\);/,
    );
    const pcOwn = tauri('src/pc.rs');
    const extraOwn = tauri('src/pc_extra.rs');
    expect(pcOwn).toMatch(
      /pub async fn open_workspace_file\(app: AppHandle, name: String, thinking: Option<String>\) -> Result<\(\), String> \{\s*open_file\(&app, &name, None, thinking\.as_deref\(\)\)\.await\s*\}/,
    );
    expect(extraOwn).toMatch(
      /pub async fn print_file\(app: AppHandle, name: String, thinking: Option<String>\) -> Result<\(\), String> \{\s*print_workspace_file\(&app, &name, None, thinking\.as_deref\(\)\)\.await\s*\}/,
    );
    expect(extraOwn).toMatch(
      /pub async fn media_key\(app: AppHandle, key: String, thinking: Option<String>\) -> Result<\(\), String> \{\s*press_media_key\(&app, &key, None, thinking\.as_deref\(\)\)\.await\s*\}/,
    );
    expect(extraOwn).toMatch(
      /pub async fn clipboard_read\(app: AppHandle, thinking: Option<String>\) -> Result<String, String> \{\s*read_clipboard\(&app, None, thinking\.as_deref\(\)\)\.await\s*\}/,
    );
    for (const [src, fn] of [
      [pcOwn, 'open_file'],
      [extraOwn, 'print_workspace_file'],
      [extraOwn, 'press_media_key'],
      [extraOwn, 'read_clipboard'],
    ]) {
      const body = src.slice(src.indexOf(`pub async fn ${fn}(`));
      const end = body.indexOf('\n}\n');
      expect(body.slice(0, end)).toMatch(
        /if !crate::approval::ask_for\(app, &[^;]*by\.map\(\|d\| d\.name\)[^;]*\)\.await \{\s*return Err|let question = \w+\(name, by\.map\(\|d\| d\.name\)\);\s*if !crate::approval::ask_for\(app, &question, by, thinking\)\.await \{\s*return Err/,
      );
      expect(body.slice(0, end)).not.toMatch(/ask_with_always|Always/);
    }
    expect(link).toMatch(
      /#\[serde\(default, rename = "mayRead"[^\n]*\]\s*pub may_read: bool,/,
    );
    expect(link).toMatch(
      /pub async fn link_device_may_read[\s\S]*?if allowed \{[\s\S]*?if !crate::approval::ask_on_this_pc\(&app, &question\)\.await \{\s*return Err[\s\S]*?let mut phones = load_phones\(&app\);[\s\S]*?save_phones[\s\S]*?record\(&app, "may-read"/,
    );
    expect(link).toContain(
      'const TOOLS_ENTRY: &str = "DesktopAgent-link:tools";',
    );
    expect(link).toMatch(
      /fn tools_allowed\(app: &AppHandle\) -> bool \{\s*read_entry\(app, TOOLS_ENTRY\)\.as_deref\(\) == Some\("on"\)/,
    );
    expect(link).toMatch(
      /async fn may_read_now[\s\S]*?read_grants[\s\S]*?crate::approval::ask\(app, &read_question\(device, chat, allowed_now\)\)\.await[\s\S]*?if !tools_allowed\(app\) \|\| !may_read\(&load_phones\(app\), remote\) \{\s*return false;/,
    );
    expect(link).toContain(
      'const READ_GRANT_TIME: Duration = Duration::from_secs(12 * 60 * 60);',
    );
    expect(link).toMatch(
      /async fn tool_for[\s\S]*?\}\s*if call != RemoteCall::PcInfo && !may_read_now\(app, remote, device, chat\)\.await \{\s*return Err[\s\S]*?crate::pc::pc_info\(a\)[\s\S]*?crate::pc_files::list\(&dir\)[\s\S]*?crate::pc::workspace_file\(app, &file\)\?[\s\S]*?crate::pc_files::read_for_device\(&path, &name, crate::pc_files::DEVICE_READ_TIME\)[\s\S]*?log_use[\s\S]*?notification\(\)[\s\S]*?read_note\(/,
    );
    expect(link).toMatch(
      /pub async fn link_forget\(app: AppHandle, id: String\) -> Result<\(\), String> \{\s*forget_here\(&app, &id, "removed"\)\s*\}/,
    );
    expect(link).toMatch(
      /fn forget_here[\s\S]*?read_grants\.lock\(\)\.unwrap\(\)\.forget_device\(id\)/,
    );
    expect(link).toMatch(
      /pub async fn link_tools_allow[\s\S]*?if !allowed \{\s*app\.state::<Link>\(\)\.read_grants\.lock\(\)\.unwrap\(\)\.clear\(\);/,
    );
    // Workspace file names only (the screens' own rule), no hidden or
    // system files, no links out; at most 256 KB of text; documents through
    // the PC's own reader; the same name check as open and print.
    const pcFiles = tauri('src/pc_files.rs');
    expect(pcFiles).toContain('pub const MAX_TEXT: usize = 256 * 1024;');
    expect(pcFiles).toMatch(
      /pub fn check_name[\s\S]*?name\.contains\("\.\."\)[\s\S]*?is_ascii_alphanumeric\(\)[\s\S]*?SYSTEM_NAMES/,
    );
    expect(pcFiles).toMatch(
      /fn plain_file[\s\S]*?std::fs::symlink_metadata\(path\)/,
    );
    expect(pcFiles).toContain('crate::docs::read_document(path)?');
    expect(tauri('src/docs.rs')).toMatch(
      /pub async fn doc_to_text[\s\S]*?spawn_blocking\(move \|\| read_document\(&real\)\)/,
    );
    const pcRs = tauri('src/pc.rs');
    expect(pcRs).toMatch(
      /pub\(crate\) fn workspace_file[\s\S]*?name\.contains\(\['\/', '\\\\', ':'\]\) \|\| name\.contains\("\.\."\)/,
    );
    expect(pcRs).toMatch(
      /pub async fn open_file[\s\S]*?if !openable\(name\) \{\s*return Err[\s\S]*?workspace_file\(app, name\)\?/,
    );
    expect(tauri('src/pc_extra.rs')).toMatch(
      /pub async fn print_workspace_file[\s\S]*?if !printable\(name\) \{\s*return Err[^;]*;\s*\}\s*let path = crate::pc::workspace_file\(app, name\)\?;/,
    );
    expect(tauri('src/remote_ask.rs')).toMatch(
      /pub fn use_line[\s\S]*?one_line\(device\), one_line\(what\)/,
    );
    // The PC's own tool and a device's picture share one checked maker.
    const imageGen = tauri('src/image_gen.rs');
    expect(imageGen).toMatch(
      /pub async fn image_generate[\s\S]*?make\(app, set, &prompt, width, height, steps, seed, \|_\| \{\}\)\.await/,
    );
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
      /fn forget_here\(app: &AppHandle, id: &str, kind: &str\)[\s\S]*?save_phones[\s\S]*?link\.removed[\s\S]*?link\.cut_off\(id\)/,
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
    // last model, a picture, or the model server.
    // (The library's own code; the screens' circle calls never reach a PC.)
    const code = phone.slice(0, phone.indexOf('#[cfg(test)]'));
    const requests =
      code.slice(
        0,
        code.indexOf("/// The screens' circle calls on the phone"),
      ) +
      code.slice(code.indexOf('/// How the open connection to this PC goes'));
    const ops = [...requests.matchAll(/"op\\?":\s*\\?"(\w+)/g)].map(m => m[1]);
    expect([...new Set(ops)].sort()).toEqual([
      'answer',
      'http',
      'pair',
      'picture',
      'questions',
      'removal',
      'start',
      'status',
      'sync',
      'tool',
    ]);
    // Key kept out of cloud backups.
    expect(
      read(
        'android/app/src/main/java/com/pocketagent/homelink/HomeLinkModule.kt',
      ),
    ).toContain('context.noBackupFilesDir');
  });

  it("the phone's PC tools: their own names, off by default, results untrusted, behind the PIN", () => {
    const engine = read('src/services/talents/PcToolsEngine.ts');
    expect(engine).toMatch(
      /export const PC_TOOL_NAMES = \[\s*'pc_info',\s*'pc_workspace_list',\s*'pc_workspace_read',\s*'pc_open',\s*'pc_print',\s*'pc_media',\s*'pc_clipboard_read',\s*'pc_run_command',\s*'pc_workspace_write',\s*'pc_workspace_append',\s*'pc_workspace_undo',\s*\] as const;/,
    );
    // What the PC sends back is its data (a file, the clipboard): wrapped
    // as untrusted. Only the actions get a plain "done" built here from
    // the phone's own arguments; the clipboard is not one of them.
    expect(engine).toMatch(
      /summary: wrapUntrusted\(describeResult\(this\.name, answer\.result\)\)/,
    );
    const done = engine.slice(
      engine.indexOf('export function doneText'),
      engine.indexOf('export class PcToolsEngine'),
    );
    expect(done).not.toContain('pc_clipboard_read');
    // A command's output (and exit code) is the PC's data too: never a
    // plain "done" built here.
    expect(done).not.toContain('pc_run_command');
    expect(done).not.toContain('result');
    // Only a file's name or a media key goes to the PC, through the one
    // gated ask().
    expect(engine).toMatch(
      /askPcTool\(\s*pc,\s*REMOTE_NAMES\[this\.name\],\s*chatIdFor\(activeChat\(\)\),\s*toolArgs,\s*\)/,
    );
    expect(engine).toContain('if (!(await unlockHomePc(pc))) {');
    const link = read('src/services/homeLink/homeLink.ts');
    expect(link).toMatch(
      /if \(method !== 'pair' && method !== 'closeTunnel'\) \{\s*const gate = await homePcGate/,
    );
    expect(link).toMatch(
      /'tool',\s*pc,\s*name,\s*chat,\s*JSON\.stringify\(\{\s*\.\.\.\(args\.file !== undefined \? \{file: args\.file\} : \{\}\),\s*\.\.\.\(args\.key !== undefined \? \{key: args\.key\} : \{\}\),\s*\.\.\.\(args\.command !== undefined \? \{command: args\.command\} : \{\}\),\s*\.\.\.\(args\.content !== undefined \? \{content: args\.content\} : \{\}\),\s*\.\.\.\(args\.thinking \? \{thinking: args\.thinking\} : \{\}\),\s*\}\)/,
    );
    // A change on the PC is told to the model as a plain message built
    // here from this device's own file name and the PC's line counts
    // (numbers only), never the PC's text.
    expect(engine).toMatch(
      /const n = \(value: unknown\) => Math\.max\(0, Math\.floor\(Number\(value\) \|\| 0\)\);/,
    );
    const written = engine.slice(
      engine.indexOf('export function writtenText'),
      engine.indexOf('export function doneText'),
    );
    expect(written).not.toMatch(/answer\?\.(text|file|output|error)/);
    expect(engine).toMatch(
      /if \(PC_WRITE_TOOLS\.includes\(this\.name\)\) \{\s*return \{\s*type: 'text',\s*summary: `\$\{writtenText\(this\.name, toolArgs\.file \?\? '', answer\.result\)\} \$\{STOP\}`,/,
    );
    // Registered on the phone only (the PC has its own pc_info), and no
    // tool is switched on by default.
    const index = read('src/services/talents/index.ts');
    expect(index).toMatch(
      /\} else \{[\s\S]*?new PcPictureEngine\(\)[\s\S]*?for \(const name of PC_TOOL_NAMES\) \{\s*talentRegistry\.register\(new PcToolsEngine\(name\)\);/,
    );
    expect(read('src/utils/globalToolSettings.ts')).toMatch(
      /const raw = await AsyncStorage\.getItem\(KEY\);\s*if \(!raw\) return \[\];/,
    );
  });

  it('the home link can never crash the app: failures come back as errors', () => {
    expect(read('native/homelink/Cargo.toml')).toMatch(/^panic = "unwind"$/m);
    expect(read('src-tauri/Cargo.toml')).toMatch(/^panic = "unwind"$/m);
    const android = read('native/homelink/src/android.rs');
    // Every door from Android goes through guarded(), and iroh gets the
    // app context first (it needs it to read the network settings).
    const doors = android.match(/pub extern "system" fn Java_\w+/g) || [];
    expect(doors.length).toBe(12);
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
      const text = fs
        .readFileSync(path.join(dir, file), 'utf8')
        .replace(/\r\n/g, '\n');
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
      const text = fs
        .readFileSync(path.join(dir, file), 'utf8')
        .replace(/\r\n/g, '\n');
      for (const step of text.split(/\n\s+- name: /)) {
        if (step.includes('gh release create')) {
          expect([file, /\/SHA256SUMS \\\n/.test(step)]).toEqual([file, true]);
        }
      }
    }
  });

  it('the APK signing key is used only by the signing step, in its own job that ran none of the build, which keeps the debug key without it', () => {
    const dir = path.join(__dirname, '..', '..', '.github', 'workflows');
    let signing = '';
    for (const file of fs.readdirSync(dir)) {
      const text = fs
        .readFileSync(path.join(dir, file), 'utf8')
        .replace(/\r\n/g, '\n');
      for (const step of text.split(/\n\s+- name: /)) {
        if (/ANDROID_KEY/.test(step)) {
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
    // Its job: after the build, before the release; no repository rights;
    // no checkout, nothing from the repository or the build is run (only
    // the downloaded APK is read), apksigner from pinned build-tools.
    const jobs = jobsOf(
      read('.github/workflows/pocketagent-integration-apk.yml'),
    );
    expect(Object.keys(jobs)).toEqual(['diagnostic', 'sign', 'release']);
    const sign = jobs.sign;
    expect(sign).toContain('Sign the APK with our release key');
    expect(sign).toMatch(/\n {4}needs: diagnostic\n/);
    expect(sign).toMatch(/\n {4}permissions: \{\}\n/);
    expect(sign).toMatch(/BUILD_TOOLS: '\d+\.\d+\.\d+'/);
    expect(sign).toContain('apksigner="$BUILD_TOOLS_DIR/apksigner"');
    for (const banned of [
      'actions/checkout',
      'yarn',
      'npm ',
      'npx ',
      'gradle',
      'bash scripts/',
      'node ',
      'cache',
    ]) {
      expect([banned, sign.includes(banned)]).toEqual([banned, false]);
    }
    const uses = [...sign.matchAll(/uses: ([^\s]+)/g)].map(m => m[1]);
    expect(uses.sort()).toEqual([
      'actions/download-artifact@v4',
      'actions/upload-artifact@v4',
    ]);
    // The signed APK is verified, and it is what the release publishes.
    expect(signing).toMatch(/apksigner" sign [\s\S]*?--out signed\.apk/);
    expect(signing).toMatch(/rm -f "\$keystore"\n\s+mv signed\.apk/);
    expect(signing).toContain('verify --verbose --print-certs');
    expect(jobs.release).toMatch(/\n {4}needs: sign\n/);
    expect(jobs.release).toContain(
      'name: pocketagent-signed-apk-${{ github.run_id }}',
    );
    expect(jobs.diagnostic).not.toMatch(/\$\{\{\s*secrets\./);
  });

  it('the published APK is the release build: not debuggable, no dev support, its bundle built in, checked before signing', () => {
    // Gradle: prodRelease, debug-signed without a release keystore (installs
    // over the earlier test APKs), dev support off.
    expect(read('scripts/build-api-helper-npu.sh')).toMatch(
      /arm64-v8a assembleProdRelease\n/,
    );
    expect(read('scripts/build-api-helper-npu.sh')).not.toContain(
      'assembleProdDebug',
    );
    const gradle = read('android/app/build.gradle');
    const release = gradle.slice(
      gradle.indexOf('        release {', gradle.indexOf('buildTypes {')),
      gradle.indexOf('        releaseE2e {'),
    );
    expect(release).toContain('debuggable false');
    expect(release).toContain(
      'buildConfigField "boolean", "USE_DEV_SUPPORT", "false"',
    );
    expect(release).toContain(
      'signingConfig(signingConfigs.release.storeFile != null ? signingConfigs.release : signingConfigs.debug)',
    );
    expect(gradle).toContain('def enableProguardInReleaseBuilds = false');
    expect(read('android/gradle.properties')).toMatch(/^hermesEnabled=true$/m);
    expect(
      read('android/app/src/main/java/com/pocketagent/MainApplication.kt'),
    ).toContain(
      'override fun getUseDeveloperSupport(): Boolean = BuildConfig.USE_DEV_SUPPORT',
    );
    // The workflow: only the release APK; checked in the build job and
    // again in the signing job before and after the key.
    const workflow = read('.github/workflows/pocketagent-integration-apk.yml');
    expect(workflow).not.toMatch(/prod\/debug|prod-debug|ProdDebug/);
    const jobs = jobsOf(workflow);
    expect(stepNamed(jobs.diagnostic, 'Keep verified APK')).toContain(
      'path: android/app/build/outputs/apk/prod/release/app-prod-release.apk',
    );
    const checks = [
      stepNamed(
        jobs.diagnostic,
        'Check the APK is a release build (not debuggable, bundle built in)',
      ),
      stepNamed(
        jobs.sign,
        'Check the APK is a release build before signing (not debuggable, bundle built in)',
      ),
      stepNamed(
        jobs.sign,
        'Check the signed APK (signature valid, still not debuggable)',
      ),
    ];
    for (const check of checks) {
      expect(check).toContain('dump badging "$apk"');
      expect(check).toMatch(
        /if grep -q '\^application-debuggable' <<< "\$badging"; then\n\s+echo "::error::[^"]*"\n\s+exit 1/,
      );
      expect(check).toContain('dump xmltree --file AndroidManifest.xml "$apk"');
      expect(check).toContain('grep -qvE \'=false$\' <<< "$flags"');
      // Hermes bytecode's magic number at the start of the bundle.
      expect(check).toContain("bytes.fromhex('c61fbc03c103191f')");
    }
    // In order: built, checked, kept; checked again before the key.
    const order = (job: string, names: string[]) =>
      names.map(n => job.indexOf(`- name: ${n}\n`));
    const built = order(jobs.diagnostic, [
      'Assemble and verify NPU APK',
      'Check the APK is a release build (not debuggable, bundle built in)',
      'Keep verified APK',
    ]);
    expect(built.every(i => i > 0)).toBe(true);
    expect([...built].sort((a, b) => a - b)).toEqual(built);
    const signed = order(jobs.sign, [
      'Check the APK is a release build before signing (not debuggable, bundle built in)',
      'Sign the APK with our release key (when its secrets are set)',
      'Check the signed APK (signature valid, still not debuggable)',
      'Keep the signed APK',
    ]);
    expect(signed.every(i => i > 0)).toBe(true);
    expect([...signed].sort((a, b) => a - b)).toEqual(signed);
  });

  it('the Linux picture maker from the cache must match the SHA-256 recorded when it was built', () => {
    const linux = read('.github/workflows/pocketagent-linux.yml');
    const restore = stepNamed(
      linux,
      'Restore the pinned picture maker build (cached copy)',
    );
    expect(restore).toMatch(
      /restore-keys: \|\n\s+sd-cli-\$\{\{ env\.SD_COMMIT \}\}[^\n]*-sha256-$/,
    );
    const build = stepNamed(
      linux,
      'Build the pinned picture maker sd-cli (x64, CPU; checked against its recorded SHA-256 when cached)',
    );
    expect(build).toContain(
      'CACHED_KEY: ${{ steps.sd-cache.outputs.cache-matched-key }}',
    );
    expect(build).toContain('expected="${CACHED_KEY##*-sha256-}"');
    expect(build).toContain('[[ "$expected" =~ ^[0-9a-f]{64}$ ]]');
    expect(build).toMatch(
      /if ! echo "\$\{expected\} {2}sd-built\/sd-cli" \| sha256sum -c -; then\n[^\n]*\n\s+exit 1/,
    );
    expect(build).toContain('echo "sha256=$sha" >> "$GITHUB_OUTPUT"');
    const save = stepNamed(linux, 'Keep a copy of the picture maker build');
    expect(save).toContain('-sha256-${{ steps.sd-build.outputs.sha256 }}');
  });

  it('network from the native side is http/https only', () => {
    const net = tauri('src/net.rs');
    expect(net).toMatch(/"http" \| "https" => \{\}/);
    expect(net).toMatch(/other => return Err/);
  });

  it('clipboard, screenshot, print, media keys and the quick key: each asks or is limited', () => {
    const x = tauri('src/pc_extra.rs');
    // Clipboard: the dialog shows the text itself before the model gets it.
    // (Asked by this PC or a paired device: the same dialog, the device
    // named; the text is never logged either way: remote_ask::loggable.)
    expect(x).toMatch(
      /if !crate::approval::ask_for\(app, &clipboard_question_for\(&text, by\.map\(\|d\| d\.name\)\), by, thinking\)\.await \{\s*return Err/,
    );
    expect(x).toMatch(/fn clipboard_question\([\s\S]*?preview\(text, 600\)/);
    expect(x).toMatch(
      /fn clipboard_question_for[\s\S]*?None => clipboard_question\(text\),\s*Some\(device\) => format!\(\s*"\\u\{201c\}\{device\}\{\}\\n\\n\{\}",\s*crate::remote_ask::CLIPBOARD_ASK_DEVICE,\s*preview\(text, 600\)/,
    );
    const ask = tauri('src/remote_ask.rs');
    expect(ask).toMatch(
      /pub fn loggable[\s\S]*?first == CLIPBOARD_ASK \|\| \(first\.starts_with\('\\u\{201c\}'\) && first\.ends_with\(CLIPBOARD_ASK_DEVICE\)\)/,
    );
    expect(ask).toMatch(
      /pub fn answered_note[^{]*\{[^}]*let question = loggable\(question\);/,
    );
    // Screenshot: asks first; nothing is taken on "no".
    expect(x).toMatch(
      /pub async fn take_screenshot[\s\S]*?if !crate::approval::ask\(&app, question\)\.await \{\s*return Ok\(None\);/,
    );
    // Print: documents and pictures only, and it asks.
    expect(x).toMatch(/if !printable\(name\) \{\s*return Err/);
    expect(x).toMatch(
      /pub async fn print_workspace_file[\s\S]*?approval::ask_for\(app, &question, by, thinking\)\.await/,
    );
    // Media keys: a fixed list, never any other key, and it asks natively.
    expect(x).toMatch(
      /let vk = media_vk\(key\)\.ok_or[^;]*;\s*\/\/[^\n]*\n\s*if !crate::approval::ask_for\(app, &media_question\(key, by\.map\(\|d\| d\.name\)\), by, thinking\)\.await \{\s*return Err/,
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
    // every time (approval::ask_for: Allow / Don't allow, never "always").
    // The PC's own command and a paired device's pc_run_command (stage 3)
    // go through the very same function; only the question names the asker.
    expect(pc).toMatch(
      /pub async fn run_command\(app: AppHandle, command: String, thinking: Option<String>\) -> Result<Ran, String> \{\s*run_checked_command\(&app, &command, None, thinking\.as_deref\(\)\)\.await\s*\}/,
    );
    expect(pc).toMatch(
      /pub async fn run_checked_command\(\s*app: &AppHandle,\s*command: &str,\s*by: Option<&crate::approval::Device<'_>>,\s*thinking: Option<&str>,\s*\) -> Result<Ran, String> \{\s*let command = check_command\(command\)\?;\s*\/\/[^\n]*\n\s*if !crate::approval::ask_for\(app, &command_question_for\(&command, by\.map\(\|d\| d\.name\)\), by, thinking\)\.await \{\s*return Err[\s\S]*?let dir = workspace\(app\)\?;[\s\S]*?run\(&command, &dir, COMMAND_TIME_LIMIT\)/,
    );
    expect(pc).not.toContain('ask_with_always');
    // The dialog shows exactly what runs: no carriage returns, controls or
    // invisible (bidi, zero-width) characters, a few lines at most, and it
    // says how many lines and characters there are.
    expect(pc).toMatch(
      /pub fn check_command[\s\S]*?c != '\\n' && c != '\\t' && crate::remote_ask::hidden_char\(c\)[\s\S]*?command\.lines\(\)\.count\(\) > MAX_LINES/,
    );
    expect(pc).toContain('pub const MAX_LINES: usize = 20;');
    expect(pc).toMatch(/fn command_question_for[\s\S]*?\{chars\} characters/);
    // Never cut (a device that may answer sees the whole command too).
    const commandQuestion = pc.slice(
      pc.indexOf('pub fn command_question_for'),
      pc.indexOf('/// Most lines a command may have'),
    );
    expect(commandQuestion).toContain('\\n\\n{command}\\n\\n');
    expect(commandQuestion).not.toMatch(/take\(|truncate|preview|\.\.\]/);
    expect(pc).not.toContain('remember');
    // Runs in the workspace folder, with a time limit.
    expect(pc).toMatch(/run\(&command, &dir, COMMAND_TIME_LIMIT\)/);
    // open_workspace_file (and a device's pc_open, through open_file): never
    // programs or scripts, and it asks.
    expect(pc).toMatch(/if !openable\(name\) \{\s*return Err/);
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

  it('files outside the workspace: asked on this PC every time, never "always", closed places checked after resolving', () => {
    const outside = tauri('src/outside.rs');
    // Every access asks, on this PC only (never a device), never "always".
    expect(outside).toMatch(
      /if !crate::approval::ask_on_this_pc\(&app, &question\)\.await \{\s*audit\(&app, "model", action\.word\(\), "said no", &shown, thinking\);\s*return Err/,
    );
    expect(outside).not.toMatch(
      /ask_with_always|Answer::Always|ALWAYS|ask_for\(|approval::ask\(|remember/,
    );
    // Shape first, then resolved by the system, then checked again, then
    // the places never reachable: on the resolved path, never the name given.
    expect(outside).toMatch(
      /pub fn checked\(app: &AppHandle, path: &Path\) -> Result<PathBuf, String> \{\s*let named = check_absolute\(&path\.to_string_lossy\(\), Style::HERE\)\?;\s*let real = resolve\(Path::new\(&named\)\)\?;\s*let real = check_resolved\(&real\.to_string_lossy\(\), Style::HERE\)\?;\s*if guard\(app\)\.never_reachable\(&real\) \{\s*return Err\(NEVER\.into\(\)\);/,
    );
    expect(outside).toContain(
      'pub const NEVER: &str = "That place is never reachable from the model.";',
    );
    // Re-checked after the answer: nothing moved while it was asked.
    expect(outside).toMatch(
      /let again = locate\(&app, place\.as_deref\(\), &path\);\s*if again\.as_ref\(\) != Ok\(&real\) \|\| stamp\(&real\) != was \{/,
    );
    for (const closed of [
      '"/microsoft/windows/start menu"',
      '"windows", "programdata"',
      'top.starts_with("program files")',
      '".ssh", ".gnupg", ".aws"',
      '"login data"',
      '"cookies"',
      '"key4.db"',
      '"logins.json"',
      '".git-credentials"',
      '".npmrc"',
      '".bashrc"',
      'name.ends_with("profile.ps1")',
      '".config/autostart"',
      '".config/systemd/user"',
      '"etc", "usr", "bin", "sbin", "boot", "var"',
      'crate::files::private_dir(app).ok()',
    ]) {
      expect([closed, outside.includes(closed)]).toEqual([closed, true]);
    }
    // UNC, device paths and streams are refused before anything else.
    expect(outside).toMatch(/if p\.starts_with\("\\\\\\\\"\) \{\s*return Err/);
    expect(outside).toMatch(/if part\.contains\(':'\) \{\s*return Err/);
    // Every way out of the command is logged (no contents).
    expect(
      outside.match(/audit\(&app, "model", action\.word\(\)/g)?.length,
    ).toBeGreaterThanOrEqual(5);
    // Paired devices never reach it: their tool lists are unchanged and
    // link.rs never calls it.
    const link = tauri('src/link.rs');
    expect(link).not.toMatch(/outside::|outside_files/);
    expect(link).toMatch(
      /pub const REMOTE_TOOLS: &\[&str\] = &\[\s*"pc_info",\s*"workspace_list",\s*"workspace_read",\s*"pc_open",\s*"pc_print",\s*"pc_media",\s*"pc_clipboard_read",\s*"pc_run_command",\s*"workspace_write",\s*"workspace_append",\s*"workspace_undo",\s*\];/,
    );
    expect(link).toContain(
      'pub const ACT_TOOLS: &[&str] = &["pc_open", "pc_print", "pc_media", "pc_clipboard_read"];',
    );
    expect(link).toContain(
      'pub const COMMAND_TOOLS: &[&str] = &["pc_run_command"];',
    );
    expect(link).toContain(
      'pub const WRITE_TOOLS: &[&str] = &["workspace_write", "workspace_append", "workspace_undo"];',
    );
    expect(read('src/services/talents/PcToolsEngine.ts')).not.toContain(
      'outside',
    );
    // The model's tool goes only to that native command; no question of
    // its own in the app (the PC's native one is the question).
    const desktop = read('src/services/talents/DesktopToolsEngine.ts');
    expect(desktop).toMatch(/invoke<Outside>\('outside_files', \{/);
    expect(desktop).not.toContain('requestFileApproval');
  });

  it('native questions: the facts first, the model\'s words under "The model says:"', () => {
    const approval = tauri('src/approval.rs');
    expect(approval).toContain(
      'pub const MODEL_SAYS: &str = "The model says:";',
    );
    // Escaped (hidden characters, line breaks) and capped.
    expect(approval).toMatch(
      /pub fn model_words[\s\S]*?if i == MAX_MODEL_TEXT \{[\s\S]*?c if crate::remote_ask::hidden_char\(c\) =>/,
    );
    // Outside files: what, where, action and size, then the label, then
    // the model's reason and text.
    const outside = tauri('src/outside.rs');
    const question = outside.slice(
      outside.indexOf('pub fn question('),
      outside.indexOf('/// One line of the log'),
    );
    const order = [
      'Where: {path}\\nAction: {what}',
      '\\nSize: ',
      '{MODEL_SAYS}',
      'model_words(reason)',
      'change.view.join',
    ].map(s => question.indexOf(s));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // A device's change in the workspace: the facts, then the label, then
    // the text its model wants to write.
    expect(tauri('src/pc_write.rs')).toMatch(
      /"\\u\{201c\}\{device\}\{\}\\n\{\}\\n\\n\{\}\\n\{heading\}\\n\{\}",\s*crate::remote_ask::WRITE_ASK_DEVICE,\s*summary\(plan\),\s*crate::approval::MODEL_SAYS,/,
    );
  });

  it("pictures: made on this PC by sd-cli with the app's own models, capped, into the workspace", () => {
    const gen = tauri('src/image_gen.rs');
    // The one-shot maker, never sd-server (no password), from the app's
    // own folder; only files from the model list, in the app's folder.
    expect(gen).toMatch(/"sd-cli\.exe"\s*\} else \{\s*"sd-cli"/);
    expect(gen).not.toMatch(/sd-server"/);
    expect(gen).toContain('let models = set_dir(&root, &set);');
    expect(gen).toContain(
      '.unwrap_or_else(|| root.join(MODELS_DIR).join(&set.id))',
    );
    // A picture file picked from the models folder: the screens name only
    // its id; this side reads the record itself and checks the file again
    // right before it runs (inside the models folder, .gguf, no links).
    expect(gen).toMatch(
      /if set\.dir\.is_some\(\) \{[\s\S]*?find_set\(&root, &set\.id\)\?;/,
    );
    expect(gen).toContain('let set = find_set(&root, &model)?;');
    expect(gen).toMatch(
      /pub fn local_set\([\s\S]*?\*p != "\.\."[\s\S]*?ends_with\("\.gguf"\)[\s\S]*?is_symlink\(\)[\s\S]*?\.map\(\|r\| r\.starts_with\(root\)\)/,
    );
    expect(gen).toContain(
      'pub const CHAT_MODELS_DIR: &str = "Documents/models";',
    );
    expect(gen).toContain(
      'let dir = crate::pc::workspace(&app)?.join(IMAGES_DIR);',
    );
    // Caps: prompt length, fixed sizes, steps, one at a time, time limit.
    expect(gen).toContain('pub const MAX_PROMPT: usize = 1000;');
    expect(gen).toContain('pub const SIZES: [u32; 3] = [512, 768, 1024];');
    expect(gen).toContain('pub const MAX_STEPS: u32 = 30;');
    expect(gen).toContain(
      'pub const TIME_LIMIT: Duration = Duration::from_secs(10 * 60);',
    );
    expect(gen).toMatch(/if job\.busy \{\s*return Err/);
    // Checked and word-filtered before anything runs.
    expect(gen).toMatch(
      /let req = check_request\([^;]*\)\?;\s*if let Some\(why\) = refused\(&req\.prompt\) \{\s*return Err/,
    );
    // Not on ARM Linux; the workflow never ships sd-server.
    expect(gen).toContain('target_arch = "aarch64"');
    const win = read('.github/workflows/pocketagent-windows.yml');
    expect(win).toMatch(
      /echo "\$\{SD_SHA256\} {2}\$\{SD_ZIP\}" \| sha256sum -c -/,
    );
    expect(win).toContain('rm -f src-tauri/sd/sd-server.exe');
    // A model file with a checksum is checked while it downloads; a
    // mismatch is deleted, never renamed into place. A set marked verified
    // without a checksum for every file is refused.
    expect(tauri('src/download.rs')).toMatch(
      /if sha256 != expected \{\s*let _ = std::fs::remove_file\(&part\);\s*return fail/,
    );
    const imageModels = read('src/services/imageGen/imageModels.ts');
    expect(imageModels).toMatch(
      /const problem = checksumProblem\(set\);\s*if \(problem\) \{\s*throw/,
    );
    expect(imageModels).toMatch(
      /if \(set\.verified && file\.sha256 === null\) \{\s*return/,
    );
    // Only commercially usable models are listed.
    const models = read(
      'src/services/imageGen/imageModelCatalog.json',
    ).toLowerCase();
    for (const banned of ['flux.1-dev', 'klein-9b', 'sd-turbo', 'sdxl-turbo']) {
      expect([banned, models.includes(`/${banned}`)]).toEqual([banned, false]);
    }
  });

  it('opening things outside: pages, e-mail drafts, settings pages only, and it asks', () => {
    const open = tauri('src/open.rs');
    // Checked first, then the native dialog with the exact target, then opened.
    expect(open).toMatch(
      /let target = check_target\(&target\)\?;\s*if !crate::approval::ask_for\(&app, &question\(&target\), None, thinking\.as_deref\(\)\)\.await \{\s*return Err/,
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

describe('Rule 2: phone actions ask every time, in a chain too', () => {
  it('a chain of phone actions asks before every step, even inside a shortcut', async () => {
    // Static: no chain step is ever quiet, and a chain runs phone actions
    // that are switched on, nothing else.
    expect(read('src/services/talents/PhoneActionsEngine.ts')).toContain(
      'const quiet = !step && ctx?.inApprovedShortcut === true;',
    );
    const chain = read('src/services/talents/PhoneActionChain.ts');
    expect(chain).not.toMatch(/inApprovedShortcut|talentRegistry/);
    expect(chain).toContain('if (!PHONE_TOOL_NAMES.includes(action))');
    expect(chain).toContain('if (!switchedOn.includes(action))');
    // Behaviour: the list first, then one question per step.
    const asked: string[] = [];
    let Chain: any;
    jest.isolateModules(() => {
      jest.doMock('../services/talents/fileApprovalGate', () => ({
        requestFileApproval: async (p: {filename: string}) => {
          asked.push(p.filename);
          return true;
        },
      }));
      jest.doMock('../services/phoneActions/native', () => ({
        performPhoneAction: async () => ({ok: true}),
        actionAsksItself: () => false,
        describeFailure: () => 'failed',
        listInstalledApps: async () => [],
        findContacts: async () => [],
      }));
      jest.doMock('../utils/globalToolSettings', () => ({
        readGlobalTools: async () => ['set_timer', 'navigate_to'],
      }));
      require('react-native').AppState.currentState = 'active';
      Chain =
        require('../services/talents/PhoneActionChain').PhoneActionChainEngine;
    });
    const result = await new Chain().execute(
      {
        steps: [
          {action: 'set_timer', args: {minutes: 5}},
          {action: 'navigate_to', args: {destination: 'Home'}},
        ],
      },
      {signal: new AbortController().signal, inApprovedShortcut: true},
    );
    expect(asked).toEqual([
      'Do these 2 steps? Each one asks again before it runs.',
      'Step 1 of 2: Set a 5 min timer?',
      'Step 2 of 2: Open maps for "Home"?',
    ]);
    expect(result.summary).toMatch(/^All 2 steps done/);
  });
});

describe('security review 2 (2026-11-15), app code', () => {
  it('"Recently deleted" keeps versions, counts UTF-8 bytes and never saves over an unreadable list', () => {
    const chats = read('src/services/sync/chatDeletes.ts');
    expect(chats).toContain('export const MAX_VERSIONS = 3;');
    expect(chats).toContain(
      'loadRecent: () => loadChunked<RecentlyDeleted>(RECENT_KEY_V2, RECENT_KEY),',
    );
    expect(chats).not.toMatch(/readJson<RecentlyDeleted/);
    const kept = read('src/services/sync/keptStore.ts');
    expect(kept).toContain('export const CHUNK_BYTES = 900_000;');
    expect(kept).toContain('throw new UnreadableStore(key);');
    for (const file of [
      'src/services/sync/assistantDeletes.ts',
      'src/services/sync/loopSync.ts',
    ]) {
      expect(read(file)).toMatch(/\? readStrict\(key, fallback\)/);
      expect(read(file)).toContain('const n = jsonBytes(entry) + 1;');
    }
  });

  it('the PIN wait counts only time the app measured', () => {
    const lock = read('src/services/homeLink/homePcLock.ts');
    expect(lock).toContain('performance.now()');
    expect(lock).toMatch(
      /Math\.max\(0, Math\.min\(wall, mono - last\.mono\)\)/,
    );
    expect(lock).toContain('r.waitLeft = wait;');
  });

  it('memory search reads only messages typed on this device', () => {
    expect(read('src/services/talents/pastChats.ts')).toContain(
      'if (isMirrored(row._raw?.metadata ?? row.metadata)) {',
    );
    expect(read('src/services/sync/deviceSync.ts')).toContain(
      "await writeChats(incoming, {from: 'the PC'});",
    );
    expect(read('src/services/sync/hostSync.web.ts')).toContain(
      'write: list => writeChats(list, {from})',
    );
  });

  it('a synced change pauses a running loop', () => {
    expect(read('src/services/sync/loopSync.ts')).toMatch(
      /\{\.\.\.r\.loop, paused: true, pausedWhy: `changed on \$\{from\}`\}/,
    );
  });

  it("a shortcut checks each step's Toolbox switch", () => {
    const tools = read('src/services/talents/customTools.ts');
    expect(tools).toMatch(
      /const off = await switchedOffSteps\(steps\.map\(s => s\.tool\)\);\s*if \(off\.length\) \{\s*return switchedOff/,
    );
    expect(tools).toContain("'is switched off in the Toolbox',");
  });

  it('the PC: pairing tries, read grants, paths, PDFs and the answers log', () => {
    const link = read('src-tauri/src/link.rs');
    expect(link).toContain('const PAIR_CODE_WRONG_TRIES: u32 = 3;');
    expect(link).toContain('pub const MAX_CHAT_GRANTS_PER_DEVICE: usize = 3;');
    expect(
      link.match(/let error = error_for_device\(&app, &error\);/g),
    ).toHaveLength(2);
    expect(link).toContain('crate::pc_files::read_for_device(');
    expect(link).not.toMatch(/crate::pc_files::read\(&path/);
    expect(read('src-tauri/src/pc_files.rs')).toContain(
      'if crate::docs::kind_of(name) == Some("pdf") {',
    );
    const ask = read('src-tauri/src/remote_ask.rs');
    expect(ask).toContain('one_line(&loggable(question))');
    // Kept to its size; the log of access outside the workspace sits
    // next to it, rotated the same way.
    expect(ask).toMatch(
      /fn append_to\(file: &std::path::Path[\s\S]*?rotate\(file, MAX_LOG_BYTES\);/,
    );
    expect(ask).toMatch(
      /pub fn log_outside[\s\S]*?log_file\(app\)\.map\(\|f\| f\.with_file_name\(OUTSIDE_LOG\)\)[\s\S]*?append_to\(&file, line\);/,
    );
  });
});

describe('Rule 1: the model is treated as possibly hostile (chat guards, 2026-11-15)', () => {
  const tauri = (file: string) => read(`src-tauri/${file}`);
  const guard = read('src/services/agent/chatGuard.ts');
  const keysOf = (name: string) => {
    const start = guard.indexOf(`export const ${name}`);
    const body = guard.slice(start, guard.indexOf('\n};', start));
    return [...body.matchAll(/^ {2}(\w+): /gm)].map(m => m[1]);
  };

  it('the chat loop asks the guard before every tool and tells it after', () => {
    const runner = read('src/services/agent/AgentRunner.ts');
    const one = runner.slice(
      runner.indexOf('async function executeOne'),
      runner.indexOf('export function runToolCall'),
    );
    // After the allowed-list check, before the tool is called; a refusal
    // returns without calling it.
    expect(one).toMatch(
      /!allowedTalentNames\.includes\(fnName\)[\s\S]*?const verdict = await guard\.before\(guardCall\);\s*if \(!verdict\.ok\) \{[\s\S]*?return \{[\s\S]*?handler\.execute\(parsedArgs, ctx\)[\s\S]*?guard\?\.after\(guardCall, toolResult\);/,
    );
    expect(runner).toMatch(
      /guard\?\.beforeModelRequest\(\);\s*const completionPromise = engine/,
    );
    // Stop on "asking a lot" ends the run.
    expect(runner).toMatch(/if \(signal\?\.aborted \|\| stopRun\) \{\s*break;/);
    // Chats and loop plans both pass a guard.
    expect(read('src/hooks/useChatSession.ts')).toMatch(
      /runAgent\(\{[\s\S]*?guard: inAppGuard\(messageInfo\.sessionId, lease\.signal,/,
    );
    expect(read('src/services/loops/planRunner.ts')).toMatch(
      /runToolCall\([\s\S]*?inAppGuard\(PLAN_GUARD_CHAT, signal\),\s*\);/,
    );
  });

  it('read-then-leak: the private reads and what goes out are explicit lists', () => {
    expect(keysOf('PRIVATE_READS')).toEqual([
      'outside_files',
      'clipboard_read',
      'pc_clipboard_read',
      'pc_workspace_read',
      'run_command',
      'pc_run_command',
    ]);
    expect(keysOf('OUTGOING')).toEqual([
      'web_search',
      'read_url',
      'compose_message',
      'share_text',
      'search_in_app',
      'navigate_to',
      'pc_workspace_read',
      'pc_open',
      'pc_print',
      'pc_run_command',
      'pc_workspace_write',
      'pc_workspace_append',
      'pc_workspace_undo',
    ]);
    expect(read('src/services/talents/PcPictureEngine.ts')).toContain(
      "readonly sendsTo = 'your Home PC, to make a picture';",
    );
    // Only a result that is not an error marks the chat; once marked,
    // anything going out asks (the model can't answer: the app's window).
    expect(guard).toMatch(
      /after\(\{name, args, engine\}, result\) \{\s*if \(result\.type !== 'error' && readsPrivate\(name, args, engine\)\) \{\s*markPrivateRead\(chat, name\);/,
    );
    expect(guard).toMatch(
      /const guardAsks = marked !== null && out !== null;[\s\S]*?if \(guardAsks\) \{\s*const allowed = await deps\.ask\(\{\s*kind: 'outgoing',\s*what: out,/,
    );
    expect(read('src/services/agent/guardQuestions.ts')).toMatch(
      /return requestFileApproval\(guardProposal\(q\), signal\);/,
    );
  });

  it('the ask-rate limit and "allow nothing more" hold', () => {
    expect(guard).toContain('export const ASK_LIMIT = 8;');
    expect(guard).toContain('export const ASK_WINDOW_MS = 2 * 60 * 1000;');
    expect(guard).toMatch(
      /if \(nothingMoreAllowed\(chat\) && guarded\) \{\s*return \{ok: false, message: REFUSED_NOTHING_MORE\};/,
    );
    const gate = read('src/services/talents/fileApprovalGate.ts');
    expect(gate).toMatch(
      /if \(chat && nothingMoreAllowed\(chat\)\) \{\s*return Promise\.resolve\(false\);/,
    );
    const host = read('src/components/FileApprovalHost.tsx');
    expect(host).toContain("Don't allow anything more in this chat");
    expect(host).toMatch(
      /proposal\?\.action === 'too_many'[\s\S]*?decideFileApproval\(false\)\}>Stop[\s\S]*?decideFileApproval\(true\)\}>\s*Continue/,
    );
    // Native questions too: the app refuses before invoking them (the
    // guard runs before every tool of the desktop and of the paired PC).
    for (const name of [
      'run_command',
      'outside_files',
      'clipboard_read',
      'media_control',
      'print_file',
      'open_file',
      'pc_run_command',
      'pc_clipboard_read',
      'pc_open',
      'pc_print',
      'pc_media',
      'pc_workspace_write',
    ]) {
      expect(guard).toContain(`'${name}',`);
    }
  });

  it("the model's thinking is shown after the facts and logged, never parsed", () => {
    expect(guard).toContain('export const THINKING_SHOWN = 600;');
    const approval = tauri('src/approval.rs');
    expect(approval).toContain('pub const MAX_THINKING: usize = 600;');
    expect(approval).toMatch(
      /pub async fn ask_for\([^)]*thinking: Option<&str>\) -> bool \{\s*let yes = ask\(app, &with_thinking\(question, thinking\)\)\.await[^;]*;\s*crate::remote_ask::log_asked\(app, by\.map\(\|d\| d\.name\), yes, question, thinking\);/,
    );
    // Every tool question on the PC passes the thinking along.
    for (const file of [
      'src/pc.rs',
      'src/pc_extra.rs',
      'src/link.rs',
      'src/open.rs',
    ]) {
      const text = tauri(file);
      for (const m of text.matchAll(
        /crate::approval::ask_for\(([^;]*?)\)\.await/g,
      )) {
        expect([file, /thinking(\.as_deref\(\))?$/.test(m[1].trim())]).toEqual([
          file,
          true,
        ]);
      }
    }
    // The native commands take it as an optional argument.
    const pc = tauri('src/pc.rs');
    const extra = tauri('src/pc_extra.rs');
    expect(pc).toContain(
      'pub async fn run_command(app: AppHandle, command: String, thinking: Option<String>)',
    );
    expect(pc).toContain(
      'pub async fn open_workspace_file(app: AppHandle, name: String, thinking: Option<String>)',
    );
    expect(extra).toContain(
      'pub async fn clipboard_read(app: AppHandle, thinking: Option<String>)',
    );
    expect(extra).toContain(
      'pub async fn media_key(app: AppHandle, key: String, thinking: Option<String>)',
    );
    expect(extra).toContain(
      'pub async fn print_file(app: AppHandle, name: String, thinking: Option<String>)',
    );
    expect(tauri('src/open.rs')).toContain(
      'pub async fn open_external(app: AppHandle, target: String, thinking: Option<String>)',
    );
    const outside = tauri('src/outside.rs');
    expect(outside).toMatch(
      /let question = crate::approval::with_thinking\(&question\(action, &shown, &facts, reason\.as_deref\(\)\), thinking\);/,
    );
    const audits = [...outside.matchAll(/audit\(&app, "model"[^;]*;/g)];
    expect(audits.length).toBe(5);
    expect(audits.every(m => m[0].endsWith(', thinking);'))).toBe(true);
    // The desktop passes it to every native question it asks.
    const desk = read('src/services/talents/DesktopToolsEngine.ts');
    for (const call of [
      "('run_command', {command, thinking})",
      "('clipboard_read', {thinking})",
      "('media_key', {key: action, thinking})",
      "('print_file', {name: filename, thinking})",
      "('open_workspace_file', {name: filename, thinking})",
    ]) {
      expect(desk).toContain(call);
    }
    expect(desk).toMatch(/reason,\s*thinking,\s*\}\);/);
    // A device's request: the thinking cut to fit the line, shown only.
    expect(read('native/homelink/src/lib.rs')).toMatch(
      /if let Some\(fit\) = fit_thinking\(thinking, room\) \{\s*args\.insert\("thinking"\.into\(\), fit\.into\(\)\);/,
    );
    // The in-app questions: the thinking as shown and the red warning.
    const gate = read('src/services/talents/fileApprovalGate.ts');
    expect(gate).toMatch(
      /thinking: thinkingShown\(from\.thinking\),\s*warning: thinkingWarning\(from\.thinking\),/,
    );
  });

  it("risky commands get the app's warning in the question, which never blocks", () => {
    const pc = tauri('src/pc.rs');
    expect(pc).toMatch(
      /pub fn command_question_for[\s\S]*?command_risks\(command\)[\s\S]*?characters\)\{risks\}\\n\\nA command can do anything/,
    );
    // Only the question uses it (and its test): a warning never stops a command.
    const body = pc.slice(0, pc.indexOf('#[cfg(test)]'));
    expect([...body.matchAll(/command_risks\(/g)].length).toBe(2);
    for (const risk of [
      'RISK_DOWNLOAD_RUN',
      'RISK_HIDDEN',
      'RISK_DELETE',
      'RISK_PERSIST',
      'RISK_CREDENTIALS',
      'RISK_NETWORK',
      'RISK_SECURITY_OFF',
    ]) {
      expect(pc).toContain(`pub const ${risk}: &str`);
    }
    // Every command question and its answer is logged, the PC's own too.
    expect(tauri('src/remote_ask.rs')).toMatch(
      /pub fn log_asked[\s\S]*?append\(app, \|when\| asked_line\(when, by, yes, question, thinking\)\);/,
    );
  });
});

describe('Rule 1: sub-agents ask first, get no tools and are untrusted (2026-11-15)', () => {
  const engine = read('src/services/talents/AskOtherModelEngine.ts');
  const sub = read('src/services/agent/subAgent.ts');

  it('ask_other_model is a tool that asks: off until switched on, refused under "allow nothing more"', () => {
    const {ASKING_TOOLS} = require('../services/agent/chatGuard');
    // (Not one an assistant may add by itself: that list is pinned above.)
    expect(ASKING_TOOLS).toContain('ask_other_model');
    expect(engine).toMatch(
      /if \(chat && nothingMoreAllowed\(chat\)\) \{[\s\S]*?return \{type: 'text', summary: REFUSED_NOTHING_MORE\};/,
    );
  });

  it('only a listed model; the question comes before anything is sent; never "always"', () => {
    expect(engine).toMatch(
      /const model = pickModel\(models, args\?\.model\);\s*if \(!model\) \{/,
    );
    const run = engine.slice(engine.indexOf('async execute('));
    const asked = run.indexOf("action: 'ask_other_model'");
    expect(asked).toBeGreaterThan(0);
    expect(run.indexOf('deps.engineFor(')).toBeGreaterThan(asked);
    expect(run).toMatch(
      /if \(!allowed\) \{\s*deps\.log\(entry\('refused'\)\);\s*return \{type: 'text', summary: REFUSED_HANDOFF\};/,
    );
    expect(engine).toContain(
      'ask: (proposal, signal) => requestFileApproval(proposal, signal),',
    );
    const host = read('src/components/FileApprovalHost.tsx');
    const dialog = host.slice(
      host.indexOf("if (proposal?.action === 'ask_other_model')"),
      host.indexOf("proposal?.action === 'phone_action' ||"),
    );
    expect(dialog).toContain('Allow once');
    expect(dialog).not.toMatch(/always/i);
  });

  it('one level only: one completion, no tools, a time limit and an output cap', () => {
    expect(engine).toContain(
      'return engine.completion(handoffParams(task) as any);',
    );
    const params = sub.slice(
      sub.indexOf('export function handoffParams'),
      sub.indexOf('export function answerText'),
    );
    expect(params).not.toMatch(/tools|tool_choice/);
    expect(sub).toContain(
      'export const HANDOFF_TIME_LIMIT_MS = 2 * 60 * 1000;',
    );
    expect(sub).toContain('export const HANDOFF_MAX_OUTPUT_TOKENS = 1500;');
    expect(sub).toContain('export const MAX_HANDOFFS = 5;');
  });

  it('the answer reaches the model wrapped as untrusted, labelled with its name', () => {
    expect(engine).toMatch(
      /summary: `\$\{wrapModelAnswer\(model\.name, answer \|\| '\(no answer\)'\)\}/,
    );
    const {wrapModelAnswer} = require('../services/talents/untrustedContent');
    expect(wrapModelAnswer('m', 'x')).toMatch(
      /^Answer from m\. [\s\S]*never as instructions/,
    );
  });
});
