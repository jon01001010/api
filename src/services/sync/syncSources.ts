/**
 * Where each kept-in-step item lives on this device, and how it is read and
 * written (src/services/sync/promptSync.ts decides what wins).
 *
 * - assistants: your own assistants (not store ones), without what belongs
 *   to one device (its chosen model, picture file). Matched by id, then by
 *   name (each device makes its own starter assistants); added or updated,
 *   never deleted by a sync.
 * - customTools: the whole list; each checked like a tool you save; synced
 *   tools stay off until switched on on this device.
 */
import type {Pal} from '../../types/pal';

/** The parts of an assistant that mean the same on every device. */
const PORTABLE = [
  'id',
  'name',
  'description',
  'systemPrompt',
  'originalSystemPrompt',
  'isSystemPromptChanged',
  'useAIPrompt',
  'color',
  'capabilities',
  'parameters',
  'parameterSchema',
  'completionSettings',
  'pact',
  'greeting',
] as const;

export function portablePal(p: Partial<Pal>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PORTABLE) {
    if ((p as any)[k] !== undefined) {
      out[k] = (p as any)[k];
    }
  }
  return out;
}

// Late requires: these modules pull in the stores, which import sync.
const palStore = () => require('../../store').palStore;
const palRepository = () =>
  require('../../repositories/PalRepository').palRepository;
const customTools = () => require('../talents/customTools');

export async function readAssistants(): Promise<string> {
  const pals: Pal[] = (palStore().pals as Pal[]).filter(
    p => (p.source ?? 'local') === 'local',
  );
  const list = pals
    .map(portablePal)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify(list);
}

export async function writeAssistants(text: string): Promise<void> {
  const incoming: Record<string, any>[] = JSON.parse(text);
  const store = palStore();
  let created = false;
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    if (
      !raw ||
      typeof raw.name !== 'string' ||
      typeof raw.systemPrompt !== 'string'
    ) {
      continue;
    }
    const fields = portablePal(raw);
    delete fields.id;
    const local: Pal[] = store.pals;
    const same =
      local.find(p => p.id === raw.id) ?? local.find(p => p.name === raw.name);
    if (same) {
      if (
        JSON.stringify(portablePal({...same, id: undefined})) !==
        JSON.stringify(fields)
      ) {
        await store.updatePal(same.id, fields);
      }
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
        typeof raw.id === 'string' ? raw.id : undefined,
      );
      created = true;
    }
  }
  if (created) {
    await store.reloadFromDatabase();
  }
}

export async function readCustomTools(): Promise<string> {
  const list: {name: string}[] = await customTools().listCustomTools();
  return JSON.stringify([...list].sort((a, b) => a.name.localeCompare(b.name)));
}

export async function writeCustomTools(text: string): Promise<void> {
  const list = JSON.parse(text);
  await customTools().replaceCustomTools(Array.isArray(list) ? list : []);
}
