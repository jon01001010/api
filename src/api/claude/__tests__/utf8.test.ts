import {ensureTextCodecs, utf8Decode, utf8Encode} from '../utf8';

describe('utf8', () => {
  it.each(['plain', 'café ☕', 'emoji 🐱🍎', '中文', ''])(
    'round-trips %p like the platform codec',
    text => {
      const bytes = utf8Encode(text);
      expect([...bytes]).toEqual([...new TextEncoder().encode(text)]);
      expect(utf8Decode(bytes)).toBe(text);
    },
  );

  it('installs codecs only when missing', () => {
    const g = globalThis as any;
    const saved = g.TextDecoder;
    delete g.TextDecoder;
    ensureTextCodecs();
    expect(new g.TextDecoder().decode(utf8Encode('héllo'))).toBe('héllo');
    g.TextDecoder = saved;
    ensureTextCodecs();
    expect(g.TextDecoder).toBe(saved);
  });
});
