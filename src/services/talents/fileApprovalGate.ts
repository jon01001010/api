import {AppState} from 'react-native';

import {
  type ApprovalFrom,
  allowNothingMore,
  nothingMoreAllowed,
  thinkingShown,
  thinkingWarning,
} from '../agent/chatGuard';
import {appUnlockedNow, subscribeAppLock} from '../appLock/appLock';

export type FileProposal = {
  action:
    | 'file_create'
    | 'file_edit'
    | 'file_append'
    | 'file_patch'
    | 'file_undo'
    // A phone action (timer, alarm, …): `filename` is the one-line question,
    // `content` any details.
    | 'phone_action'
    // Saving or deleting a custom tool: `filename` is the question,
    // `content` the full definition.
    | 'custom_tool'
    // After private data was read in this chat, something going out
    // (chatGuard.ts): `filename` the question, `content` exactly what.
    | 'sends_out'
    // "The model is asking a lot": Continue / Stop (chatGuard.ts).
    | 'too_many'
    // Handing a task to another model (ask_other_model): `filename` the
    // facts, `content` exactly the text that goes.
    | 'ask_other_model'
    // A chat's hand-off limit reached: Continue / Stop (subAgent.ts).
    | 'handoff_cap'
    // The same task to several models at once (ask_models): `filename`
    // the facts, `content` the exact text, `targets` one box each.
    | 'ask_models'
    // A fallback chain (ask_model_chain): `filename` the facts, `content`
    // the exact text, `targets` the chain in order (no boxes).
    | 'ask_model_chain';
  filename: string;
  content: string;
  previous?: string;
  /** Line-by-line changes (existing files), shown above the full contents. */
  diff?: string;
  /** The model's thinking from just before the request, as shown
   *  (chatGuard.thinkingShown), after the facts. */
  thinking?: string;
  /** Shown in red above the thinking (chatGuard.thinkingWarning). */
  warning?: string | null;
  /** An app-written warning shown in red with the facts (e.g. private
   *  data read in this chat, and this goes to a cloud model). */
  alert?: string;
  /** The model's own words for the request, under "The model says:",
   *  after the facts. */
  modelSays?: string;
  /** The chat asking: offers "Don't allow anything more in this chat". */
  chat?: string;
  /** ask_models / ask_model_chain: the models, in order, as listed. For
   *  ask_models each has a box, ticked to start; Allow sends to the ticked
   *  ones only (requestChoices). */
  targets?: {id: string; label: string; detail: string; cloud: boolean}[];
  /** The tool's context (fromContext): the raw thinking and the chat,
   *  turned into `thinking`, `warning` and `chat` when asked. */
  from?: ApprovalFrom;
};

type Answer = {approved: boolean; chosen?: string[]};
type Active = {proposal: FileProposal; resolve: (answer: Answer) => void};
let active: Active | null = null;
const listeners = new Set<(proposal: FileProposal | null) => void>();
let uiMounted = 0;

function notify() {
  for (const fn of listeners) fn(active?.proposal ?? null);
}
export function subscribeFileApprovals(
  fn: (value: FileProposal | null) => void,
): () => void {
  uiMounted++;
  listeners.add(fn);
  fn(active?.proposal ?? null);
  return () => {
    listeners.delete(fn);
    uiMounted--;
    if (!uiMounted) rejectFileApproval();
  };
}
export function rejectFileApproval(): void {
  if (!active) return;
  const old = active;
  active = null;
  notify();
  old.resolve({approved: false});
}
/**
 * The user's answer. `nothingMore`: "Don't allow anything more in this
 * chat" (a no, and every later tool that asks or sends is refused there).
 */
export function decideFileApproval(
  approved: boolean,
  nothingMore = false,
  chosen?: string[],
): void {
  if (!active) return;
  const old = active;
  if (nothingMore && old.proposal.chat) {
    allowNothingMore(old.proposal.chat);
    approved = false;
  }
  active = null;
  notify();
  old.resolve({approved, ...(chosen ? {chosen} : {})});
}
export function requestFileApproval(
  proposal: FileProposal,
  signal?: AbortSignal,
): Promise<boolean> {
  return ask(proposal, signal).then(a => a.approved);
}
/**
 * A question with a box per target (ask_models): the ids the user left
 * ticked, in the question's order, or null for no (or none ticked). Only
 * ids from the question count.
 */
export function requestChoices(
  proposal: FileProposal,
  signal?: AbortSignal,
): Promise<string[] | null> {
  const ids = (proposal.targets ?? []).map(t => t.id);
  return ask(proposal, signal).then(a => {
    if (!a.approved) return null;
    const chosen = a.chosen ? ids.filter(id => a.chosen!.includes(id)) : ids;
    return chosen.length ? chosen : null;
  });
}
function ask(proposal: FileProposal, signal?: AbortSignal): Promise<Answer> {
  const {from, ...rest} = proposal;
  proposal = rest;
  if (
    active ||
    !uiMounted ||
    signal?.aborted ||
    AppState.currentState !== 'active' ||
    // Locked (app PIN): no question over the PIN screen; refused like one
    // asked in the background (security review 2, 2026-11-18).
    !appUnlockedNow()
  ) {
    return Promise.resolve({approved: false});
  }
  const chat = proposal.chat ?? from?.chat;
  // "Don't allow anything more in this chat": no more questions there.
  if (chat && nothingMoreAllowed(chat)) {
    return Promise.resolve({approved: false});
  }
  if (from?.thinking !== undefined && proposal.thinking === undefined) {
    proposal = {
      ...proposal,
      thinking: thinkingShown(from.thinking),
      warning: thinkingWarning(from.thinking),
    };
  }
  if (chat) {
    proposal = {...proposal, chat};
  }
  return new Promise<Answer>(resolve => {
    active = {proposal, resolve};
    const abort = () => rejectFileApproval();
    signal?.addEventListener('abort', abort, {once: true});
    const currentResolve = resolve;
    active.resolve = value => {
      signal?.removeEventListener('abort', abort);
      currentResolve(value);
    };
    notify();
  });
}
AppState.addEventListener('change', state => {
  if (state !== 'active') rejectFileApproval();
});
// The app locked while a question was open: it is refused.
subscribeAppLock(locked => {
  if (locked) rejectFileApproval();
});
