import {guardedFetch} from '../guardedFetch';
import {checkNetworkUrl} from '../networkPolicy';

const response = (status: number, location?: string) => ({
  status,
  headers: {get: (key: string) => key === 'location' ? location ?? null : null},
}) as Response;

describe('network boundary', () => {
  it.each(['http://localhost/a', 'https://127.0.0.1/', 'https://10.1.2.3/',
    'https://169.254.169.254/latest/meta-data/', 'file:///etc/passwd'])('rejects %s', url => {
    expect(checkNetworkUrl(url).allowed).toBe(false);
  });
  it('allows public HTTPS', () => {
    expect(checkNetworkUrl('https://example.com/').allowed).toBe(true);
  });
  it('blocks redirect to localhost without fetching it', async () => {
    const transport = jest.fn().mockResolvedValue(response(302, 'http://127.0.0.1/admin'));
    await expect(guardedFetch('https://example.com/', {}, {fetchImpl: transport})).rejects.toThrow('Redirect denied');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('follows a public relative redirect', async () => {
    const transport = jest.fn().mockResolvedValueOnce(response(302, '/next')).mockResolvedValueOnce(response(200));
    await expect(guardedFetch('https://example.com/start', {}, {fetchImpl: transport})).resolves.toMatchObject({status: 200});
    expect(transport.mock.calls[1][0]).toBe('https://example.com/next');
  });
  it('rejects redirect loops at the configured limit', async () => {
    const transport = jest.fn().mockResolvedValue(response(301, '/again'));
    await expect(guardedFetch('https://example.com/', {}, {maxRedirects: 1, fetchImpl: transport})).rejects.toThrow('Too many redirects');
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
