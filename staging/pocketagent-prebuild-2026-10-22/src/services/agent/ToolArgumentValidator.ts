/** Validate model-provided tool arguments before passing them to an engine. */
export type ArgumentValidation =
  | {ok: true; args: Record<string, unknown>}
  | {ok: false; reason: 'invalid-json' | 'not-object' | 'too-large' | 'too-deep'};

export function validateToolArguments(raw: string, maxBytes = 32768, maxDepth = 16): ArgumentValidation {
  if (typeof raw !== 'string' || raw.length > maxBytes) return {ok: false, reason: 'too-large'};
  let value: unknown;
  try { value = JSON.parse(raw || '{}'); } catch { return {ok: false, reason: 'invalid-json'}; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {ok: false, reason: 'not-object'};
  const stack: Array<{value: unknown; depth: number}> = [{value, depth: 0}];
  let visited = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if (++visited > 5000) return {ok: false, reason: 'too-large'};
    if (current.depth > maxDepth) return {ok: false, reason: 'too-deep'};
    if (current.value !== null && typeof current.value === 'object') {
      for (const child of Object.values(current.value)) stack.push({value: child, depth: current.depth + 1});
    }
  }
  return {ok: true, args: value as Record<string, unknown>};
}
