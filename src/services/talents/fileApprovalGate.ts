import {AppState} from 'react-native';

export type FileProposal = {
  action: 'file_create' | 'file_edit';
  filename: string;
  content: string;
  previous?: string;
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
export function decideFileApproval(approved: boolean): void {
  if (!active) return;
  const old = active;
  active = null;
  notify();
  old.resolve(approved);
}
export function requestFileApproval(proposal: FileProposal, signal?: AbortSignal): Promise<boolean> {
  if (active || !uiMounted || signal?.aborted || AppState.currentState !== 'active') {
    return Promise.resolve(false);
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
