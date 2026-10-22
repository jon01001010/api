/** Pure URL gate. This is defense-in-depth, NOT a DNS-rebinding-safe transport. */
export type NetworkDecision = {allowed: true; url: string} | {allowed: false; reason: string};

function ipv4Number(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p))) return null;
  const nums = parts.map(Number);
  return nums.every(n => n >= 0 && n <= 255) ? nums : null;
}

export function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host.includes(':')) {
    if (host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host)) return true;
    const mapped = /^(?:0:){0,5}(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(host);
    return mapped ? isPrivateHost(mapped[1]) : false;
  }
  const ip = ipv4Number(host);
  if (!ip) return false;
  const [a, b] = ip;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}

export function checkNetworkUrl(raw: string, allowHttp = false): NetworkDecision {
  let url: URL;
  try { url = new URL(raw); } catch { return {allowed: false, reason: 'Invalid URL'}; }
  if (url.username || url.password) return {allowed: false, reason: 'URL credentials are not allowed'};
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) return {allowed: false, reason: 'HTTPS required'};
  if (isPrivateHost(url.hostname)) return {allowed: false, reason: 'Private or local network destination blocked'};
  if (url.port && !['443', ...(allowHttp ? ['80'] : [])].includes(url.port)) return {allowed: false, reason: 'Nonstandard network port blocked'};
  return {allowed: true, url: url.toString()};
}
