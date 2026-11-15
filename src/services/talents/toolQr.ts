/* eslint-disable no-bitwise -- base64, UTF-8 and QR bytes */
/**
 * Custom tools shared as a QR code, a file or a pasted code (TODO.md "One QR
 * scanner for everything"). A code is data only: unpacking never runs
 * anything, and the install flow (toolImport.ts) runs the same checks as
 * tool_save, shows the full definition and installs the tool switched off.
 *
 * Format: `PA1:T:1:<form>:<body>`
 * - `PA1:` PocketAgent, format 1 of the tag list; `T:` a tool; `1:` version.
 * - form `z`: the tool's JSON, deflated (raw), then base64.
 * - form `j`: the plain JSON, used when it is shorter than the packed one.
 */
import {Inflate, deflateRaw} from 'pako';

import {isPairingCode} from '../homeLink/homeLink';

import type {CustomTool} from './customTools';

export const TOOL_TAG = 'PA1:T:';
export const TOOL_CODE_VERSION = '1';
/** About what one standard QR holds (version 40, medium error correction). */
export const QR_MAX_CHARS = 2331;
/** Longest code accepted (pasted or from a file). */
export const MAX_CODE_CHARS = 32 * 1024;
/** Largest tool JSON accepted after unpacking. */
export const MAX_TOOL_BYTES = 16 * 1024;

const PREFIX = `${TOOL_TAG}${TOOL_CODE_VERSION}:`;

// --- base64 (no Buffer on the phone; atob/btoa are not everywhere) --------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

/** Base64 → bytes, or null if it isn't base64. */
export function base64ToBytes(text: string): Uint8Array | null {
  const s = text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) {
    return null;
  }
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n =
      (B64.indexOf(s[i]) << 18) |
      (B64.indexOf(s[i + 1]) << 12) |
      ((s[i + 2] === '=' ? 0 : B64.indexOf(s[i + 2])) << 6) |
      (s[i + 3] === '=' ? 0 : B64.indexOf(s[i + 3]));
    for (const byte of [(n >> 16) & 255, (n >> 8) & 255, n & 255]) {
      if (o < out.length) {
        out[o++] = byte;
      }
    }
  }
  return out;
}

// --- UTF-8 (TextEncoder/TextDecoder are not on every Hermes) --------------

function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c < 0x10000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    } else {
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 63),
        0x80 | ((c >> 6) & 63),
        0x80 | (c & 63),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** Strict UTF-8 → text, or null on a malformed sequence. */
function utf8Decode(bytes: Uint8Array): string | null {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let need = 0;
    let c = 0;
    if (b < 0x80) {
      c = b;
    } else if (b >= 0xc2 && b < 0xe0) {
      need = 1;
      c = b & 31;
    } else if (b >= 0xe0 && b < 0xf0) {
      need = 2;
      c = b & 15;
    } else if (b >= 0xf0 && b < 0xf5) {
      need = 3;
      c = b & 7;
    } else {
      return null;
    }
    if (need && i + need >= bytes.length) {
      return null;
    }
    for (let k = 1; k <= need; k++) {
      const x = bytes[i + k];
      if (x === undefined || (x & 0xc0) !== 0x80) {
        return null;
      }
      c = (c << 6) | (x & 63);
    }
    if (
      (need === 2 && (c < 0x800 || (c >= 0xd800 && c < 0xe000))) ||
      (need === 3 && (c < 0x10000 || c > 0x10ffff))
    ) {
      return null;
    }
    out += String.fromCodePoint(c);
    i += need + 1;
  }
  return out;
}

// --- pack / unpack ---------------------------------------------------------

/** The parts of a tool that travel; who made it stays on this device. */
export function shareableTool(tool: CustomTool): Record<string, unknown> {
  return tool.kind === 'instructions'
    ? {
        kind: tool.kind,
        name: tool.name,
        description: tool.description,
        instructions: tool.instructions,
      }
    : {
        kind: tool.kind,
        name: tool.name,
        description: tool.description,
        steps: tool.steps,
      };
}

/** A tool → its share code (`PA1:T:1:z:…` or `PA1:T:1:j:…`, the shorter). */
export function packTool(tool: CustomTool): string {
  const json = JSON.stringify(shareableTool(tool));
  const packed = `${PREFIX}z:${bytesToBase64(deflateRaw(utf8Encode(json)))}`;
  // ASCII only, so every character is one byte in the QR.
  const plain = `${PREFIX}j:${json.replace(
    /[\u007f-\uffff]/g,
    c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  )}`;
  return plain.length <= packed.length ? plain : packed;
}

/** True when the code fits in one QR; otherwise share it as a file or text. */
export const fitsOneQr = (code: string): boolean => code.length <= QR_MAX_CHARS;

/** Inflates at most `limit` bytes; null if bigger, broken or unfinished. */
function boundedInflate(data: Uint8Array, limit: number): Uint8Array | null {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let tooBig = false;
  const inflator = new Inflate({raw: true, chunkSize: 4096});
  inflator.onData = out => {
    const chunk = out as Uint8Array;
    total += chunk.length;
    if (total > limit) {
      tooBig = true;
      // Stops pako's loop at once: no more output is made.
      throw new Error('too big');
    }
    chunks.push(chunk);
  };
  try {
    inflator.push(data, true);
  } catch {
    return null;
  }
  const ended = (inflator as unknown as {ended?: boolean}).ended;
  if (tooBig || inflator.err || !ended) {
    return null;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export type UnpackResult =
  | {ok: true; tool: Record<string, unknown>}
  | {ok: false; error: string};

const fail = (error: string): UnpackResult => ({ok: false, error});

/**
 * A share code → the tool's raw definition (shape checked only; the install
 * flow runs the full tool_save checks). Never runs anything.
 */
export function unpackTool(code: string): UnpackResult {
  const text = (code ?? '').trim();
  if (!text.startsWith(TOOL_TAG)) {
    return fail('This is not a PocketAgent tool code.');
  }
  if (text.length > MAX_CODE_CHARS) {
    return fail('This code is too long for a tool.');
  }
  const m = /^PA1:T:(\d+):([a-z]):([\s\S]*)$/.exec(text);
  if (!m) {
    return fail('This tool code is damaged.');
  }
  if (m[1] !== TOOL_CODE_VERSION) {
    return fail(
      'This tool code is from a newer PocketAgent. Update the app to read it.',
    );
  }
  let json: string | null;
  if (m[2] === 'j') {
    json = m[3];
    if (utf8Encode(json).length > MAX_TOOL_BYTES) {
      return fail('This tool is too big.');
    }
  } else if (m[2] === 'z') {
    const packed = base64ToBytes(m[3]);
    if (!packed) {
      return fail('This tool code is damaged.');
    }
    const bytes = boundedInflate(packed, MAX_TOOL_BYTES);
    if (!bytes) {
      return fail('This tool code is damaged or the tool is too big.');
    }
    json = utf8Decode(bytes);
    if (json === null) {
      return fail('This tool code is damaged.');
    }
  } else {
    return fail('This tool code uses a form this app does not know.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fail('This tool code is damaged.');
  }
  const shape = checkShape(parsed);
  return typeof shape === 'string' ? fail(shape) : {ok: true, tool: shape};
}

/** Only the fields a tool has, with the right types; nothing else is kept. */
function checkShape(v: unknown): Record<string, unknown> | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return 'This code does not hold a tool.';
  }
  const t = v as Record<string, unknown>;
  if (typeof t.name !== 'string' || typeof t.description !== 'string') {
    return 'This code does not hold a tool (no name or description).';
  }
  if (t.kind === 'instructions') {
    if (typeof t.instructions !== 'string') {
      return 'This tool has no instructions.';
    }
    return {
      kind: 'instructions',
      name: t.name,
      description: t.description,
      instructions: t.instructions,
    };
  }
  if (t.kind === 'shortcut') {
    if (
      !Array.isArray(t.steps) ||
      !t.steps.every(
        s =>
          s &&
          typeof s === 'object' &&
          !Array.isArray(s) &&
          typeof (s as Record<string, unknown>).tool === 'string' &&
          (s as Record<string, unknown>).args !== null &&
          typeof ((s as Record<string, unknown>).args ?? {}) === 'object' &&
          !Array.isArray((s as Record<string, unknown>).args),
      )
    ) {
      return 'This shortcut has damaged steps.';
    }
    return {
      kind: 'shortcut',
      name: t.name,
      description: t.description,
      steps: (t.steps as Record<string, unknown>[]).map(s => ({
        tool: s.tool,
        args: s.args ?? {},
      })),
    };
  }
  return 'This code holds an unknown kind of tool.';
}

/** What a scanned or pasted PocketAgent code is. Unknown tags are refused. */
export type CodeKind = 'tool' | 'pairing' | 'unknown';

export function codeKind(text: string): CodeKind {
  const t = (text ?? '').trim();
  if (t.startsWith(TOOL_TAG)) {
    return 'tool';
  }
  if (isPairingCode(t)) {
    return 'pairing';
  }
  return 'unknown';
}
