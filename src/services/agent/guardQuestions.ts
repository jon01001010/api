/**
 * The chat guards' questions (chatGuard.ts), asked in the app through the
 * same approval window as the tools' own (fileApprovalGate.ts). The model
 * has no way to answer them: only the user's buttons do.
 */
import {
  requestFileApproval,
  type FileProposal,
} from '../talents/fileApprovalGate';
import {isLocalHost} from '../../utils/network';
import type {ServerConfig} from '../../utils/types';
import {
  ASK_WINDOW_MS,
  makeToolGuard,
  type GuardDeps,
  type GuardQuestion,
  type ToolGuard,
} from './chatGuard';

/** The approval window's content for one guard question: facts first. */
export function guardProposal(q: GuardQuestion): FileProposal {
  if (q.kind === 'too_many') {
    return {
      action: 'too_many',
      filename: `It asked for your answer more than ${q.count} times within ${ASK_WINDOW_MS / 60000} minutes in this chat. Continue, or stop this answer?`,
      content: '',
      chat: q.chat,
    };
  }
  return {
    action: 'sends_out',
    filename: `Earlier in this chat the model read private data (${q.tool === q.privateRead ? q.privateRead : `with ${q.privateRead}`}). Now ${q.tool} would send this out of this device:`,
    content: q.what,
    thinking: q.thinking || undefined,
    warning: q.warning,
    chat: q.chat,
  };
}

/** Asks one guard question in the app; false unless the user allows. */
export function askInApp(
  q: GuardQuestion,
  signal?: AbortSignal,
): Promise<boolean> {
  return requestFileApproval(guardProposal(q), signal);
}

/**
 * True when the chat's model runs on a server that is neither this device,
 * the home network nor the paired Home PC: a cloud model server.
 */
export function isCloudServer(server: ServerConfig | undefined): boolean {
  return Boolean(server && !server.homeLinkPc && !isLocalHost(server.url));
}

/** The guard for one chat, asking in the app. */
export function inAppGuard(
  chat: string,
  signal?: AbortSignal,
  more: Omit<GuardDeps, 'chat' | 'ask'> = {},
): ToolGuard {
  return makeToolGuard({chat, ask: q => askInApp(q, signal), ...more});
}
