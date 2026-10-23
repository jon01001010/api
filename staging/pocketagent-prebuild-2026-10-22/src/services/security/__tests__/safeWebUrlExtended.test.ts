import {validatePublicWebUrl} from '../safeWebUrl';

describe('URL security additional cases', () => {
  it.each([
    'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/',
    'http://0x7f000001/', 'http://0177.0.0.1/',
    'https://foo.internal/', 'https://foo.test/',
    'https://example.com:443@localhost/',
    'http://192.0.0.1/', 'http://255.255.255.255/',
    'https://example.com/\r\nHost: localhost',
  ])('rejects unsafe address %s', value => {
    expect(validatePublicWebUrl(value)).toBeNull();
  });
  it.each(['https://example.com/', 'https://api.github.com/zen'])('accepts %s', value => {
    expect(validatePublicWebUrl(value)).toBe(value);
  });
});
