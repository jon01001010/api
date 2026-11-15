/* eslint-disable no-bitwise -- SHA-256 is bit arithmetic. */
/**
 * PBKDF2-HMAC-SHA256 in plain JavaScript, for the Home PC PIN (homePcLock).
 * The phone's JavaScript engine (Hermes) has no WebCrypto, and the app adds
 * no native code for this, so it is written out here and checked against
 * the standard test vectors (RFC 7914 section 11) and Node's own crypto in
 * the tests.
 *
 * Only a salted hash of the PIN is ever stored, never the PIN.
 */

/**
 * PBKDF2 rounds for a new PIN. Measured (2026-11-15) on a server core:
 * 100,000 rounds take 0.06 s with a JIT (Node; the desktop app's web view
 * is like this) but 3.4 s without one (`node --jitless`, close to the
 * phone's Hermes, which has no JIT), and a phone core is slower still. So
 * 100,000 would mean a 3-6 s wait at every unlock on the phone; 30,000 is
 * about 1 s without a JIT here (1-2 s on a phone). A stored hash keeps its
 * own count, so this can change later without breaking saved PINs.
 *
 * What it buys: the hash is only useful to someone who has already copied
 * the app's key store off the phone (rooted phone); for a 4-8 digit PIN the
 * rounds slow such a search, they can't stop it. The real protection is
 * the try limit (homePcLock) and the key store's own encryption.
 */
export const PIN_ITERATIONS = 30_000;

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INIT = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];

const W = new Int32Array(64);

/** One SHA-256 block (16 words in `w`) into the state `h`. */
function compress(h: Int32Array, w: Int32Array): void {
  for (let i = 0; i < 16; i++) {
    W[i] = w[i];
  }
  for (let i = 16; i < 64; i++) {
    const a = W[i - 15];
    const b = W[i - 2];
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = h[0];
  let b = h[1];
  let c = h[2];
  let d = h[3];
  let e = h[4];
  let f = h[5];
  let g = h[6];
  let k = h[7];
  for (let i = 0; i < 64; i++) {
    const S1 =
      ((e >>> 6) | (e << 26)) ^
      ((e >>> 11) | (e << 21)) ^
      ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (k + S1 + ch + K[i] + W[i]) | 0;
    const S0 =
      ((a >>> 2) | (a << 30)) ^
      ((a >>> 13) | (a << 19)) ^
      ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    k = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  h[0] = (h[0] + a) | 0;
  h[1] = (h[1] + b) | 0;
  h[2] = (h[2] + c) | 0;
  h[3] = (h[3] + d) | 0;
  h[4] = (h[4] + e) | 0;
  h[5] = (h[5] + f) | 0;
  h[6] = (h[6] + g) | 0;
  h[7] = (h[7] + k) | 0;
}

/** SHA-256 state after `prefix` (whole 64-byte blocks) and then `data`. */
function sha256From(
  start: Int32Array,
  prefixBytes: number,
  data: Uint8Array,
): Int32Array {
  const h = new Int32Array(start);
  const total = prefixBytes + data.length;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const bits = total * 8;
  const at = padded.length - 8;
  padded[at + 3] = Math.floor(bits / 2 ** 32) & 0xff;
  padded[at + 4] = (bits >>> 24) & 0xff;
  padded[at + 5] = (bits >>> 16) & 0xff;
  padded[at + 6] = (bits >>> 8) & 0xff;
  padded[at + 7] = bits & 0xff;
  const w = new Int32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const p = off + i * 4;
      w[i] =
        (padded[p] << 24) |
        (padded[p + 1] << 16) |
        (padded[p + 2] << 8) |
        padded[p + 3];
    }
    compress(h, w);
  }
  return h;
}

const wordsToBytes = (h: Int32Array): Uint8Array => {
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (h[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff;
    out[i * 4 + 3] = h[i] & 0xff;
  }
  return out;
};

export function sha256(data: Uint8Array): Uint8Array {
  return wordsToBytes(sha256From(new Int32Array(INIT), 0, data));
}

/** The HMAC key's inner and outer states (one block each, kept). */
function hmacStates(key: Uint8Array): {inner: Int32Array; outer: Int32Array} {
  const k = new Uint8Array(64);
  k.set(key.length > 64 ? sha256(key) : key);
  const block = (pad: number) => {
    const h = new Int32Array(INIT);
    const w = new Int32Array(16);
    for (let i = 0; i < 16; i++) {
      w[i] =
        ((k[i * 4] ^ pad) << 24) |
        ((k[i * 4 + 1] ^ pad) << 16) |
        ((k[i * 4 + 2] ^ pad) << 8) |
        (k[i * 4 + 3] ^ pad);
    }
    compress(h, w);
    return h;
  };
  return {inner: block(0x36), outer: block(0x5c)};
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const {inner, outer} = hmacStates(key);
  const i = wordsToBytes(sha256From(inner, 64, data));
  return wordsToBytes(sha256From(outer, 64, i));
}

/**
 * HMAC of a 32-byte message from the kept states, word to word: the hot
 * loop of PBKDF2 (two compressions per round, no allocation).
 */
function hmac32(
  inner: Int32Array,
  outer: Int32Array,
  msg: Int32Array,
  out: Int32Array,
  h: Int32Array,
  w: Int32Array,
): void {
  // Inner: 64 key bytes already in `inner`, then 32 bytes, padding, length.
  h.set(inner);
  for (let i = 0; i < 8; i++) {
    w[i] = msg[i];
  }
  w[8] = 0x80000000;
  for (let i = 9; i < 15; i++) {
    w[i] = 0;
  }
  w[15] = (64 + 32) * 8;
  compress(h, w);
  for (let i = 0; i < 8; i++) {
    w[i] = h[i];
  }
  h.set(outer);
  compress(h, w);
  out.set(h);
}

/** PBKDF2-HMAC-SHA256 (RFC 8018), `length` bytes. */
export function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  length = 32,
): Uint8Array {
  const run = pbkdf2Steps(password, salt, iterations, length);
  let step = run.next();
  while (!step.done) {
    step = run.next();
  }
  return step.value;
}

/**
 * The same, letting the app breathe every few thousand rounds (the PIN
 * screen stays responsive while the phone works it out).
 */
export async function pbkdf2Sha256Async(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  length = 32,
): Promise<Uint8Array> {
  const run = pbkdf2Steps(password, salt, iterations, length);
  let step = run.next();
  while (!step.done) {
    await new Promise(resolve => setTimeout(resolve, 0));
    step = run.next();
  }
  return step.value;
}

const ROUNDS_PER_STEP = 2000;

function* pbkdf2Steps(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  length: number,
): Generator<void, Uint8Array, void> {
  if (!Number.isSafeInteger(iterations) || iterations < 1) {
    throw new Error('PBKDF2: bad iteration count');
  }
  const {inner, outer} = hmacStates(password);
  const out = new Uint8Array(length);
  const u = new Int32Array(8);
  const t = new Int32Array(8);
  const h = new Int32Array(8);
  const w = new Int32Array(16);
  const blocks = Math.ceil(length / 32);
  for (let block = 1; block <= blocks; block++) {
    const first = new Uint8Array(salt.length + 4);
    first.set(salt);
    first[salt.length] = (block >>> 24) & 0xff;
    first[salt.length + 1] = (block >>> 16) & 0xff;
    first[salt.length + 2] = (block >>> 8) & 0xff;
    first[salt.length + 3] = block & 0xff;
    const u1 = sha256From(
      outer,
      64,
      wordsToBytes(sha256From(inner, 64, first)),
    );
    u.set(u1);
    t.set(u1);
    for (let i = 1; i < iterations; i++) {
      hmac32(inner, outer, u, u, h, w);
      for (let j = 0; j < 8; j++) {
        t[j] ^= u[j];
      }
      if (i % ROUNDS_PER_STEP === 0) {
        yield;
      }
    }
    const bytes = wordsToBytes(t);
    out.set(
      bytes.subarray(0, Math.min(32, length - (block - 1) * 32)),
      (block - 1) * 32,
    );
  }
  return out;
}

export const utf8 = (text: string): Uint8Array =>
  new TextEncoder().encode(text);

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export const fromHex = (hex: string): Uint8Array => {
  if (!/^([0-9a-f]{2})*$/.test(hex)) {
    throw new Error('not hex');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

/** Equal byte strings, compared whole (time doesn't depend on where they differ). */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
