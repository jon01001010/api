/* eslint-disable no-bitwise -- UTF-8 encoding is bit manipulation. */
/**
 * UTF-8 encode/decode without relying on TextEncoder/TextDecoder, which
 * React Native's engine may not provide. Installed as globals only when
 * missing (the Anthropic SDK decodes stream bytes with TextDecoder).
 */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code < 0x10000) {
      out.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
    }
  }
  return new Uint8Array(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    let code: number;
    if (b < 0x80) {
      code = b;
    } else if (b >= 0xf0) {
      code =
        ((b & 7) << 18) |
        ((bytes[i++] & 63) << 12) |
        ((bytes[i++] & 63) << 6) |
        (bytes[i++] & 63);
    } else if (b >= 0xe0) {
      code = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    } else if (b >= 0xc0) {
      code = ((b & 31) << 6) | (bytes[i++] & 63);
    } else {
      code = 0xfffd;
    }
    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 1023));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

class Utf8TextDecoder {
  readonly encoding = 'utf-8';
  decode(input?: ArrayBuffer | ArrayBufferView): string {
    if (!input) {
      return '';
    }
    const bytes =
      input instanceof Uint8Array
        ? input
        : ArrayBuffer.isView(input)
          ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
          : new Uint8Array(input);
    return utf8Decode(bytes);
  }
}

class Utf8TextEncoder {
  readonly encoding = 'utf-8';
  encode(text = ''): Uint8Array {
    return utf8Encode(text);
  }
}

/** Provide TextEncoder/TextDecoder if the engine lacks them. */
export function ensureTextCodecs(): void {
  const g = globalThis as any;
  if (typeof g.TextDecoder === 'undefined') {
    g.TextDecoder = Utf8TextDecoder;
  }
  if (typeof g.TextEncoder === 'undefined') {
    g.TextEncoder = Utf8TextEncoder;
  }
}
