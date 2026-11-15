import {AppState} from 'react-native';

import {
  type ApprovalFrom,
  allowNothingMore,
  nothingMoreAllowed,
  thinkingShown,
  thinkingWarning,
} from '../agent/chatGuard';

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
    | 'handoff_cap';
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
  /** The tool's context (fromContext): the raw thinking and the chat,
   *  turned into `thinking`, `warning` and `chat` when asked. */
  from?: ApprovalFrom;
};

type Active = {proposal: FileProposal; resolve: (approved: boolean) => void};
let active: Active | null = null;
const listeners = new Set<(proposal: FileProposal | null) => void>();
let uiMounted = 0;

function notify() {
  for (const fn of listeners) fn(active?.proposal ?? null);
}
export function subscribeFileApprovals(fn: (value: FileProposal | null) => void): () => void {
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
  old.resolve(false);
}
/**
 * The user's answer. `nothingMore`: "Don't allow anything more in this
 * chat" (a no, and every later tool that asks or sends is refused there).
 */
export function decideFileApproval(
  approved: boolean,
  nothingMore = false,
): void {
  if (!active) return;
  const old = active;
  if (nothingMore && old.proposal.chat) {
    allowNothingMore(old.proposal.chat);
    approved = false;
  }
  active = null;
  notify();
  old.resolve(approved);
}
export function requestFileApproval(
  proposal: FileProposal,
  signal?: AbortSignal,
): Promise<boolean> {
  const {from, ...rest} = proposal;
  proposal = rest;
  if (active || !uiMounted || signal?.aborted || AppState.currentState !== 'active') {
    return Promise.resolve(false);
  }
  const chat = proposal.chat ?? from?.chat;
  // "Don't allow anything more in this chat": no more questions there.
  if (chat && nothingMoreAllowed(chat)) {
    return Promise.resolve(false);
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
  return new Promise(resolve => {
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
