/**
 * How a chain's or a shortcut's steps are read, in one place, so the chat
 * guard (agent/chatGuard.ts) sees exactly what the run does (security review
 * 2026-11-17): a chain step's action name trimmed and its arguments only
 * from `args` (PhoneActionChain.ts), a shortcut's {{fill-ins}} with the same
 * pattern and the same empty value for a missing one (customTools.ts).
 */

/** A {{fill-in}} in a shortcut step (spaces inside allowed, any case). */
export const FILL_IN = /\{\{\s*([a-z][a-z0-9_]{0,30})\s*\}\}/gi;

/** Step arguments with each {{fill-in}} replaced by the value given. */
export function fillIn(v: unknown, values: Record<string, unknown>): unknown {
  if (typeof v === 'string') {
    return v.replace(FILL_IN, (_m, n: string) => {
      const value = values[n.toLowerCase()];
      return value === undefined || value === null ? '' : String(value);
    });
  }
  if (Array.isArray(v)) {
    return v.map(x => fillIn(x, values));
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, fillIn(x, values)]),
    );
  }
  return v;
}

/** One step of a phone action chain as the chain runs it. */
export function chainStep(raw: unknown): {
  action: string;
  args: Record<string, unknown>;
} {
  const s = (raw ?? {}) as Record<string, unknown>;
  const action = typeof s.action === 'string' ? s.action.trim() : '';
  const args =
    s.args && typeof s.args === 'object' && !Array.isArray(s.args)
      ? (s.args as Record<string, unknown>)
      : {};
  return {action, args};
}
