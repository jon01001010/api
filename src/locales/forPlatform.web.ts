/**
 * The desktop app (Windows / Linux, built from the web version) is called
 * DesktopAgent and runs on a PC, so its texts say so. The phone app's texts
 * are untouched (forPlatform.ts).
 */
const SWAPS: [RegExp, string][] = [
  [/Android secure storage/g, "your system's secure key store"],
  [/PocketAgent AI/g, 'DesktopAgent'],
  [/PocketAgent/g, 'DesktopAgent'],
  [/\bon your phone\b/g, 'on your PC'],
  [/\byour phone\b/g, 'your PC'],
  [/\bYour phone\b/g, 'Your PC'],
];

export function desktopText(text: string): string {
  return SWAPS.reduce((out, [from, to]) => out.replace(from, to), text);
}

function swap(value: unknown): unknown {
  if (typeof value === 'string') {
    return desktopText(value);
  }
  if (Array.isArray(value)) {
    return value.map(swap);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        swap(v),
      ]),
    );
  }
  return value;
}

export function forPlatform<T>(texts: T): T {
  return swap(texts) as T;
}
