/**
 * Installing a tool someone shared (QR, file or pasted code). The same checks
 * as tool_save, the full definition shown before anything is saved, and the
 * tool is always installed switched off. A name already in use is never
 * overwritten: the user picks another name. Nothing from a code is run.
 */
import {
  builtInToolNames,
  checkCustomTool,
  listCustomTools,
  saveCustomTool,
  switchOffTools,
  type CustomTool,
} from './customTools';
import {unpackTool} from './toolQr';

export type ReviewResult =
  /** Checked and ready to install as it is. */
  | {status: 'ready'; tool: CustomTool}
  /** Checked, but a custom tool with this name exists: ask for a new name. */
  | {status: 'name_taken'; tool: CustomTool}
  | {status: 'refused'; error: string};

/**
 * Checks a shared tool (a raw definition, e.g. from unpackTool) as tool_save
 * would. `rename` replaces the shared name (after a clash).
 */
export async function reviewSharedTool(
  raw: Record<string, unknown>,
  rename?: string,
): Promise<ReviewResult> {
  const existing = (await listCustomTools()).map(t => t.name);
  const input = {
    ...raw,
    ...(rename !== undefined ? {name: rename} : {}),
    // A shared tool is installed by the user here, not made by a model.
    createdBy: 'user',
  };
  // Every check but the clash first, so a clash can be answered with a name.
  const checked = checkCustomTool(input, {
    builtIns: builtInToolNames(),
    existing: [],
  });
  if (typeof checked === 'string') {
    return {status: 'refused', error: checked};
  }
  if (existing.includes(checked.name)) {
    return {status: 'name_taken', tool: checked};
  }
  return {status: 'ready', tool: checked};
}

/** A pasted or scanned code → its review. */
export async function reviewToolCode(code: string): Promise<ReviewResult> {
  const unpacked = unpackTool(code);
  if (!unpacked.ok) {
    return {status: 'refused', error: unpacked.error};
  }
  return reviewSharedTool(unpacked.tool);
}

/**
 * Saves a reviewed tool, switched off. Refuses (never replaces) a name that
 * is taken by now. Returns the saved tool or why not.
 */
export async function installSharedTool(
  tool: CustomTool,
): Promise<CustomTool | string> {
  // Off first, so a stale switch for this name can't turn it on.
  await switchOffTools([tool.name]);
  return saveCustomTool({...tool, createdBy: 'user'});
}
