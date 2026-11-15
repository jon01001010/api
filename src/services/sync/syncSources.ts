/**
 * Where each kept-in-step item lives on this device, and how it is read and
 * written (src/services/sync/promptSync.ts decides what wins).
 *
 * - assistants: your own assistants (not store ones: those are never read,
 *   matched, rewritten or deleted), without what belongs to one device (its
 *   chosen model, picture file), each with when it last changed here, and
 *   the ones deleted here (tombstones, see assistantDeletes.ts). Merged one
 *   by one (promptSync.ts → mergeAssistants). Matched by id, then by name
 *   (each device makes its own starter assistants); added or updated; one
 *   deleted on the other device is removed here only if it hasn't changed
 *   since (kept 30 days under Recently deleted; more than 5 at once: asked).
 * - customTools: the whole list; each checked like a tool you save; synced
 *   tools stay off until switched on on this device.
 */
import type {Pal} from '../../types/pal';

import {
  applyAssistantTombstones,
  askAboutHeldAssistants,
  editTimes,
  forgetAssistantTombstones,
  isOwn,
  knownAssistantTombstones,
  parseAssistants,
  portablePal,
  setEditTime,
  type AssistantReport,
} from './assistantDeletes';

export {portablePal} from './assistantDeletes';

// Late requires: these modules pull in the stores, which import sync.
const palStore = () => require('../../store').palStore;
const palRepository = () =>
  require('../../repositories/PalRepository').palRepository;
const customTools = () => require('../talents/customTools');

export async function readAssistants(): Promise<string> {
  const pals: Pal[] = (palStore().pals as Pal[]).filter(isOwn);
  const times = await editTimes();
  const live = new Set(pals.map(p => p.id));
  const list: Record<string, unknown>[] = [
    ...pals.map(p => ({...portablePal(p), editedAt: times.get(p.id) ?? 0})),
    // Deleted here (one back again here is not).
    ...(await knownAssistantTombstones())
      .filter(t => !live.has(t.id))
      .map(t => ({...t})),
  ];
  return JSON.stringify(
    list.sort((a, b) => String(a.id).localeCompare(String(b.id))),
  );
}

export interface WriteOptions {
  /** Which device it came from ("the PC", or the device's name). */
  from?: string;
  /** The item's time, for entries without their own (an older app). */
  at?: number;
  /** Filled in: assistants deleted here, or waiting for an answer. */
  report?: AssistantReport;
}

/**
 * Writes an agreed list here: adds or updates your own assistants, removes
 * the ones deleted elsewhere that haven't changed here since. Returns
 * whether anything here changed.
 */
export async function writeAssistants(
  text: string,
  opts: WriteOptions = {},
): Promise<boolean> {
  const now = Date.now();
  const parsed = parseAssistants(text, opts.at ?? now, now);
  if (!parsed) {
    return false;
  }
  const store = palStore();
  let created = false;
  let changed = false;
  /** Your own assistants here that this list keeps. */
  const keep = new Set<string>();
  /** Their agreed times (what came is not a new edit here). */
  const times = new Map<string, number>();
  for (const raw of parsed.live) {
    const fields = portablePal(raw);
    delete fields.id;
    const all: Pal[] = store.pals;
    if (all.some(p => p.id === raw.id && !isOwn(p))) {
      // Same id as a downloaded assistant: never rewritten by a sync.
      continue;
    }
    // Only your own assistants are matched (store ones are never rewritten).
    const local = all.filter(isOwn);
    const same =
      local.find(p => p.id === raw.id && !keep.has(p.id)) ??
      local.find(p => p.name === raw.name && !keep.has(p.id));
    if (same) {
      keep.add(same.id);
      if (
        JSON.stringify(portablePal({...same, id: undefined})) !==
        JSON.stringify(fields)
      ) {
        await store.updatePal(same.id, fields);
        changed = true;
      }
      times.set(same.id, raw.editedAt);
    } else {
      await palRepository().createPal(
        {
          type: 'local',
          source: 'local',
          parameters: {},
          parameterSchema: [],
          isSystemPromptChanged: false,
          useAIPrompt: false,
          ...fields,
        },
        raw.id,
      );
      times.set(raw.id, raw.editedAt);
      keep.add(raw.id);
      created = true;
    }
  }
  // Back again (edited after a deletion): no longer deleted here.
  await forgetAssistantTombstones(parsed.live.map(e => e.id));
  if (created) {
    await store.reloadFromDatabase();
  }
  for (const [id, at] of times) {
    // As it is here now (a part the list didn't carry stays as it was).
    const pal = (store.pals as Pal[]).find(p => p.id === id);
    if (pal) {
      await setEditTime(pal, at);
    }
  }
  const from = opts.from ?? 'another device';
  const del = await applyAssistantTombstones(parsed.dead, keep, from);
  if (opts.report) {
    opts.report.assistantsDeleted += del.deleted.length;
    opts.report.assistantsHeld += del.held.length;
  }
  if (del.held.length) {
    askAboutHeldAssistants(del.held, from);
  }
  return created || changed || del.deleted.length > 0;
}

export async function readCustomTools(): Promise<string> {
  const list: {name: string}[] = await customTools().listCustomTools();
  return JSON.stringify([...list].sort((a, b) => a.name.localeCompare(b.name)));
}

export async function writeCustomTools(text: string): Promise<void> {
  const list = JSON.parse(text);
  await customTools().replaceCustomTools(Array.isArray(list) ? list : []);
}
