import {renderHook} from '@testing-library/react-native';
import {runInAction} from 'mobx';

import * as chatSummary from '../../../services/chatSummary';

// The shared store mock is a plain object; the hook needs observables.
jest.mock('../../../store', () => {
  const {observable: obs} = jest.requireActual('mobx');
  return {
    chatSessionStore: obs({
      lastCompletionResult: undefined as any,
      activeSessionId: 's1',
      agentUiState: {status: 'idle'},
    }),
    modelStore: obs({
      isGenerationBusy: false,
      activeModelCaps: {effectiveContextLength: 4096},
    }),
  };
});
const {chatSessionStore} = jest.requireMock('../../../store');

import {needsAutoSummary, useAutoSummary} from '../useAutoSummary';

describe('needsAutoSummary', () => {
  it('fires on a full or nearly full local chat only', () => {
    expect(needsAutoSummary(undefined, 4096)).toBe(false);
    expect(
      needsAutoSummary({contextFull: true, isRemote: false}, undefined),
    ).toBe(true);
    expect(
      needsAutoSummary({used: 3300, contextFull: false, isRemote: false}, 4096),
    ).toBe(true);
    expect(
      needsAutoSummary({used: 1000, contextFull: false, isRemote: false}, 4096),
    ).toBe(false);
    expect(needsAutoSummary({contextFull: true, isRemote: true}, 4096)).toBe(
      false,
    );
  });
});

describe('useAutoSummary', () => {
  let spy: jest.SpyInstance;
  beforeEach(() => {
    spy = jest
      .spyOn(chatSummary, 'summarizeWithNotice')
      .mockResolvedValue('done');
    runInAction(() => {
      chatSessionStore.lastCompletionResult = {
        contextFull: true,
        isRemote: false,
      };
    });
  });
  afterEach(() => {
    spy.mockRestore();
    runInAction(() => {
      chatSessionStore.lastCompletionResult = undefined;
      chatSessionStore.activeSessionId = 's1';
      chatSessionStore.agentUiState = {status: 'idle'};
    });
  });

  it('ignores the snapshot the chat opened with', () => {
    renderHook(() => useAutoSummary('u', true));
    expect(spy).not.toHaveBeenCalled();
  });

  it('runs once after a turn ends full', () => {
    renderHook(() => useAutoSummary('u', true));
    const snapshot = {contextFull: true, isRemote: false};
    runInAction(() => {
      chatSessionStore.lastCompletionResult = snapshot;
    });
    expect(spy).toHaveBeenCalledWith('u', {automatic: true});
    // Other store changes (a new run starting and ending) do not repeat it.
    runInAction(() => {
      chatSessionStore.agentUiState = {status: 'prefill'};
    });
    runInAction(() => {
      chatSessionStore.agentUiState = {status: 'idle'};
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('waits for the agent turn to finish', () => {
    renderHook(() => useAutoSummary('u', true));
    runInAction(() => {
      chatSessionStore.agentUiState = {status: 'executing_tool'};
      chatSessionStore.lastCompletionResult = {
        contextFull: true,
        isRemote: false,
      };
    });
    expect(spy).not.toHaveBeenCalled();
    runInAction(() => {
      chatSessionStore.agentUiState = {status: 'done'};
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ignores a chat switched to', () => {
    renderHook(() => useAutoSummary('u', true));
    runInAction(() => {
      chatSessionStore.activeSessionId = 's2';
      chatSessionStore.lastCompletionResult = {
        contextFull: true,
        isRemote: false,
      };
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('waits when there is nothing older to summarize', () => {
    renderHook(() => useAutoSummary('u', false));
    runInAction(() => {
      chatSessionStore.lastCompletionResult = {
        contextFull: true,
        isRemote: false,
      };
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
