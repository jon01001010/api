import {validatePublicWebUrl} from '../safeWebUrl';

describe('validatePublicWebUrl', () => {
  it.each(['https://example.com/a?q=1', 'http://example.org/'])('accepts public URL %s', url => {
    expect(validatePublicWebUrl(url)).toBe(url);
  });
  it.each([
    'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi',
    'http://localhost/', 'http://sub.localhost/', 'http://printer.local/',
    'http://127.0.0.1/', 'http://10.1.2.3/', 'http://192.168.1.1/',
    'http://172.16.0.1/', 'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/', 'http://[::1]/', 'http://2130706433/',
    'http://user:pass@example.com/', 'http://host/', ' https://example.com/',
    'https://example.com/\n', 'http://203.0.113.1/',
  ])('rejects unsafe URL %s', url => expect(validatePublicWebUrl(url)).toBeNull());
});
