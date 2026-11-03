/** #35: Decision layer only. Never silently transmit local content to a remote API. */
export type Provider = 'local' | 'openai' | 'claude';
export type FailureReason = 'timeout' | 'context_limit' | 'tool_unavailable' | 'backend_error' | 'user_request';
export interface HandoffRequest {
  current: Provider;
  target: Provider;
  reason: FailureReason;
  userApprovedRemote: boolean;
  remoteConfigured: boolean;
  containsPrivateFiles: boolean;
  fileSharingApproved: boolean;
  activeToolCall: boolean;
}
export type HandoffDecision =
  | {allowed: true; target: Provider; preserveConversation: true; note: string}
  | {allowed: false; reason: string};
export function decideModelHandoff(request: HandoffRequest): HandoffDecision {
  if (request.current === request.target) return {allowed: false, reason: 'Target is already active'};
  if (request.activeToolCall) return {allowed: false, reason: 'Finish or cancel the active tool call first'};
  if (request.target !== 'local') {
    if (!request.remoteConfigured) return {allowed: false, reason: 'Remote provider is not configured'};
    if (!request.userApprovedRemote) return {allowed: false, reason: 'Ask permission before sending conversation to a remote provider'};
    if (request.containsPrivateFiles && !request.fileSharingApproved)
      return {allowed: false, reason: 'Private file content requires separate sharing approval'};
  }
  return {allowed: true, target: request.target, preserveConversation: true,
    note: 'Transfer conversation context, not in-flight tool calls; keep an audit entry'};
}
