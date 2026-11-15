/**
 * A local mark on messages that came from another device (mirrored chats):
 * `metadata.mirroredFrom` (which device). Added here when a sync writes a
 * chat (chatSync.ts `writeChats` with `from`); never taken from another
 * device (the mirrored metadata keys don't include it, so it doesn't travel
 * and doesn't change a chat's version). Memory search over earlier chats
 * (pastChats.ts) only reads messages without it: text typed on this device.
 */
export const MIRROR_MARK = 'mirroredFrom';

const parse = (metadata: unknown): Record<string, unknown> | null => {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  if (typeof metadata !== 'string' || !metadata) {
    return null;
  }
  try {
    const v = JSON.parse(metadata);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

/**
 * Did this message come from another device? Metadata that can't be read
 * counts as mirrored (not searched): only plainly local text is.
 */
export function isMirrored(metadata: unknown): boolean {
  if (metadata === undefined || metadata === null || metadata === '') {
    return false;
  }
  const m = parse(metadata);
  return !m || m[MIRROR_MARK] !== undefined;
}

/** The metadata with the mark (JSON text). */
export function withMirrorMark(metadata: unknown, from: string): string {
  return JSON.stringify({
    ...(parse(metadata) ?? {}),
    [MIRROR_MARK]: from.slice(0, 100) || 'another device',
  });
}
