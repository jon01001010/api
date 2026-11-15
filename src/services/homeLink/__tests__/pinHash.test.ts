import {createHash, createHmac, pbkdf2Sync, randomBytes} from 'crypto';

import {
  fromHex,
  hmacSha256,
  pbkdf2Sha256,
  pbkdf2Sha256Async,
  PIN_ITERATIONS,
  sameBytes,
  sha256,
  toHex,
  utf8,
} from '../pinHash';

describe('SHA-256, HMAC and PBKDF2 in plain JavaScript', () => {
  it('SHA-256 matches Node for many lengths (block edges too)', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 1000]) {
      const data = randomBytes(n);
      expect(toHex(sha256(new Uint8Array(data)))).toBe(
        createHash('sha256').update(data).digest('hex'),
      );
    }
  });

  it('HMAC-SHA256 matches Node, short and long keys', () => {
    for (const k of [0, 5, 64, 100]) {
      const key = randomBytes(k);
      const data = randomBytes(77);
      expect(toHex(hmacSha256(new Uint8Array(key), new Uint8Array(data)))).toBe(
        createHmac('sha256', key).update(data).digest('hex'),
      );
    }
  });

  it('PBKDF2 gives the RFC 7914 test vectors', () => {
    expect(toHex(pbkdf2Sha256(utf8('passwd'), utf8('salt'), 1, 64))).toBe(
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
    );
    expect(toHex(pbkdf2Sha256(utf8('Password'), utf8('NaCl'), 80000, 64))).toBe(
      '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d',
    );
  });

  it('PBKDF2 matches Node for PINs and random salts', () => {
    for (const pin of ['1234', '00000000', '987654']) {
      const salt = randomBytes(16);
      expect(toHex(pbkdf2Sha256(utf8(pin), new Uint8Array(salt), 1000))).toBe(
        pbkdf2Sync(pin, salt, 1000, 32, 'sha256').toString('hex'),
      );
    }
  });

  it('refuses a bad iteration count', () => {
    expect(() => pbkdf2Sha256(utf8('1'), utf8('s'), 0)).toThrow();
    expect(() => pbkdf2Sha256(utf8('1'), utf8('s'), 1.5)).toThrow();
  });

  it('hex both ways, and whole comparisons', () => {
    expect(toHex(fromHex('00ff10'))).toBe('00ff10');
    expect(() => fromHex('zz')).toThrow();
    expect(sameBytes(fromHex('0102'), fromHex('0102'))).toBe(true);
    expect(sameBytes(fromHex('0102'), fromHex('0103'))).toBe(false);
    expect(sameBytes(fromHex('0102'), fromHex('010200'))).toBe(false);
  });

  it('the step-by-step version gives the same key', async () => {
    const salt = new Uint8Array(randomBytes(16));
    expect(toHex(await pbkdf2Sha256Async(utf8('2468'), salt, 4500))).toBe(
      pbkdf2Sync('2468', salt, 4500, 32, 'sha256').toString('hex'),
    );
  });

  it(`a PIN check (${PIN_ITERATIONS} rounds) is quick with a JIT`, () => {
    const start = Date.now();
    pbkdf2Sha256(utf8('1234'), new Uint8Array(16), PIN_ITERATIONS);
    const ms = Date.now() - start;
    // Seen: about 0.02 s here with a JIT, 1 s with `node --jitless` (close
    // to the phone's Hermes); see PIN_ITERATIONS for the choice.
    expect(PIN_ITERATIONS).toBeGreaterThanOrEqual(30_000);
    expect(ms).toBeLessThan(5000);
  });
});
