import {checkNetworkUrl} from './networkPolicy';

/**
 * Restricts model-directed HTTP fetches. Redirects are handled manually and
 * every Location is checked BEFORE the next request. This is defense in depth;
 * JS fetch cannot pin resolved IPs, so DNS rebinding is NOT solved here.
 * Use a native resolver/socket layer for strong SSRF isolation.
 */
export async function guardedFetch(
  input: string,
  init: RequestInit = {},
  options: {maxRedirects?: number; fetchImpl?: typeof fetch; allowHttp?: boolean} = {},
): Promise<Response> {
  const transport = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? 3;
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
    throw new Error('Invalid redirect limit');
  }
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const decision = checkNetworkUrl(current, options.allowHttp ?? false);
    if (!decision.allowed) throw new Error(`Network request denied: ${decision.reason}`);
    const response = await transport(decision.url, {...init, redirect: 'manual'});
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('Redirect missing Location');
    if (hop === maxRedirects) throw new Error('Too many redirects');
    const next = new URL(location, decision.url).toString();
    const nextDecision = checkNetworkUrl(next, options.allowHttp ?? false);
    if (!nextDecision.allowed) throw new Error(`Redirect denied: ${nextDecision.reason}`);
    current = next;
  }
  throw new Error('Too many redirects');
}
