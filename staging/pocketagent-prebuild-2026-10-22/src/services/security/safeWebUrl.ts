/** Fail-closed validation for agent-supplied PUBLIC web URLs.
 * This is a preflight filter, not a replacement for validating DNS resolution,
 * every redirect hop, or network-layer IP addresses at request time.
 */
const forbiddenHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') ||
      h.endsWith('.local') || h.endsWith('.internal') ||
      h.endsWith('.test') || h.endsWith('.invalid')) return true;
  // IPv6 literal: disallow entirely until a resolver-backed IP policy exists.
  if (h.includes(':') || h.startsWith('[')) return true;
  if (/^\d+$/.test(h)) return true; // alternate numeric IPv4 forms
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const octets = h.split('.').map(Number);
    if (octets.some(n => n < 0 || n > 255)) return true;
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 88) || (a === 198 && b === 51) ||
      (a === 203 && b === 0);
  }
  return !h.includes('.') || h.split('.').some(label => !label || label.startsWith('-') || label.endsWith('-'));
};

export function validatePublicWebUrl(input: string): string | null {
  if (typeof input !== 'string' || input.length > 2048 || /[\u0000-\u001f\u007f]/.test(input) || input.trim() !== input) return null;
  try {
    const url = new URL(input);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') ||
        url.username || url.password || forbiddenHost(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}
