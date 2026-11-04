import {useEffect, useRef} from 'react';
import {reaction} from 'mobx';

import {chatSessionStore, modelStore} from '../../store';
import {WARNING_THRESHOLD} from '../../utils/bannerVariantResolver';
import type {CompletionResultSnapshot} from '../../utils/completionTypes';
import {summarizeWithNotice} from '../../services/chatSummary';

// A turn ends in 'done', 'failed' or 'idle'; these mean it is still going.
const AGENT_RUNNING = new Set<string>([
  'prefill',
  'streaming_text',
  'generating_tool_call',
  'executing_tool',
]);

/** True when a finished turn left the local chat full or nearly full. */
export function needsAutoSummary(
  snapshot: CompletionResultSnapshot | undefined,
  contextTokens: number | undefined,
): boolean {
  if (!snapshot || snapshot.isRemote) {
    return false;
  }
  if (snapshot.contextFull) {
    return true;
  }
  return (
    !!contextTokens &&
    snapshot.used !== undefined &&
    snapshot.used / contextTokens >= WARNING_THRESHOLD
  );
}

/**
 * Summarize automatically once a turn ends with the chat nearly full. Runs
 * once per finished turn, waits until the model is free, and ignores the
 * snapshot a chat was opened with (only turns finished while watching count).
 */
export function useAutoSummary(userId: string, summarizable: boolean) {
  const summarizableRef = useRef(summarizable);
  summarizableRef.current = summarizable;

  useEffect(() => {
    let handled: CompletionResultSnapshot | undefined =
      chatSessionStore.lastCompletionResult;
    let session = chatSessionStore.activeSessionId;
    return reaction(
      () => ({
        snapshot: chatSessionStore.lastCompletionResult,
        // Wait for the whole agent turn, not just one generation.
        busy:
          modelStore.isGenerationBusy ||
          AGENT_RUNNING.has(chatSessionStore.agentUiState.status),
        sessionId: chatSessionStore.activeSessionId,
      }),
      ({snapshot, busy, sessionId}) => {
        if (sessionId !== session) {
          session = sessionId;
          handled = snapshot;
          return;
        }
        if (!snapshot || snapshot === handled || busy) {
          return;
        }
        handled = snapshot;
        if (
          summarizableRef.current &&
          needsAutoSummary(
            snapshot,
            modelStore.activeModelCaps.effectiveContextLength,
          )
        ) {
          summarizeWithNotice(userId, {automatic: true}).catch(() => {});
        }
      },
    );
  }, [userId]);
}
