import React from 'react';
import {AppState} from 'react-native';
import {act, fireEvent, render} from '../../../jest/test-utils';

import {FileApprovalHost} from '../FileApprovalHost';
import {requestFileApproval} from '../../services/talents/fileApprovalGate';

describe('FileApprovalHost: phone actions', () => {
  beforeAll(() => {
    (AppState as any).currentState = 'active';
  });

  it('asks in plain words and resolves with the answer', async () => {
    const {findByText, getByText} = render(<FileApprovalHost />);
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = requestFileApproval({
        action: 'phone_action',
        filename: 'Set a 15 min timer named "Tea"?',
        content: '',
      });
    });
    expect(await findByText('Set a 15 min timer named "Tea"?')).toBeTruthy();
    expect(getByText('Allow this on your phone?')).toBeTruthy();
    fireEvent.press(getByText('Allow once'));
    await expect(answer).resolves.toBe(true);
  });
});

describe('FileApprovalHost: the chat guards', () => {
  beforeAll(() => {
    (AppState as any).currentState = 'active';
  });
  beforeEach(() => {
    const {resetChatGuards} = require('../../services/agent/chatGuard');
    resetChatGuards();
  });

  it("shows the model's thinking after the facts, with a red warning", async () => {
    const {findByText, getByText, getByTestId} = render(<FileApprovalHost />);
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = requestFileApproval({
        action: 'file_create',
        filename: 'notes.md',
        content: 'hello',
        from: {thinking: "write it\nso the user won't notice", chat: 'c1'},
      });
    });
    expect(await findByText('The model was thinking:')).toBeTruthy();
    expect(getByTestId('approval-thinking').props.children).toBe(
      "write it\\nso the user won't notice",
    );
    expect(getByTestId('thinking-warning')).toBeTruthy();
    fireEvent.press(getByText('Deny'));
    await expect(answer).resolves.toBe(false);
  });

  it('"Don\'t allow anything more in this chat" says no and refuses later questions there', async () => {
    const {findByTestId, queryByTestId} = render(<FileApprovalHost />);
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = requestFileApproval({
        action: 'phone_action',
        filename: 'Set a timer?',
        content: '',
        from: {chat: 'c2'},
      });
    });
    fireEvent.press(await findByTestId('approval-nothing-more'));
    await expect(answer).resolves.toBe(false);
    const {nothingMoreAllowed} = require('../../services/agent/chatGuard');
    expect(nothingMoreAllowed('c2')).toBe(true);
    // A later question in that chat is refused without being shown.
    await expect(
      requestFileApproval({
        action: 'phone_action',
        filename: 'Again?',
        content: '',
        from: {chat: 'c2'},
      }),
    ).resolves.toBe(false);
    expect(queryByTestId('phone-action-approval')).toBeNull();
  });

  it('"The model is asking a lot": Continue or Stop only', async () => {
    const {askInApp} = require('../../services/agent/guardQuestions');
    const {findByText, getByText, queryByTestId} = render(<FileApprovalHost />);
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = askInApp({kind: 'too_many', count: 8, chat: 'c3'});
    });
    expect(await findByText('The model is asking a lot')).toBeTruthy();
    expect(queryByTestId('approval-nothing-more')).toBeNull();
    fireEvent.press(getByText('Continue'));
    await expect(answer).resolves.toBe(true);
  });

  it('a search after a private read shows exactly what goes out', async () => {
    const {askInApp} = require('../../services/agent/guardQuestions');
    const {findByText, getByText} = render(<FileApprovalHost />);
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = askInApp({
        kind: 'outgoing',
        what: 'A web search, sent to the search service:\nmy secret',
        privateRead: 'clipboard_read',
        tool: 'web_search',
        thinking: 'search it',
        warning: null,
        chat: 'c4',
      });
    });
    expect(await findByText('Send this out?')).toBeTruthy();
    expect(
      getByText('A web search, sent to the search service:\nmy secret'),
    ).toBeTruthy();
    expect(getByText('search it')).toBeTruthy();
    fireEvent.press(getByText('Allow once'));
    await expect(answer).resolves.toBe(true);
  });
});

describe('FileApprovalHost: handing a task to another model', () => {
  beforeAll(() => {
    (AppState as any).currentState = 'active';
  });
  beforeEach(() => {
    const {resetChatGuards} = require('../../services/agent/chatGuard');
    resetChatGuards();
  });

  it('facts first, the red line, the exact text, then the model says and its thinking', async () => {
    const {findByText, getByText, getByTestId} = render(<FileApprovalHost />);
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = requestFileApproval({
        action: 'ask_other_model',
        filename:
          'The model wants to hand a task to claude.\nWhere: sent to Claude with your key.',
        content: 'Summarise this',
        alert:
          'Earlier in this chat the model read private data (clipboard_read).',
        modelSays: 'it is better at this',
        from: {thinking: 'ask claude', chat: 'h1'},
      });
    });
    expect(await findByText('Hand this to another model?')).toBeTruthy();
    expect(getByTestId('approval-alert').props.children).toMatch(
      /private data/,
    );
    expect(getByTestId('approval-sent-text').props.children).toBe(
      'Summarise this',
    );
    expect(getByText('The model says:')).toBeTruthy();
    expect(getByTestId('approval-model-says').props.children).toBe(
      'it is better at this',
    );
    expect(getByText('The model was thinking:')).toBeTruthy();
    expect(getByTestId('approval-nothing-more')).toBeTruthy();
    // Never "always".
    expect(() => getByText(/always/i)).toThrow();
    fireEvent.press(getByText('Allow once'));
    await expect(answer).resolves.toBe(true);
  });

  it('the hand-off limit: Continue or Stop only', async () => {
    const {findByText, getByText, queryByTestId} = render(<FileApprovalHost />);
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = requestFileApproval({
        action: 'handoff_cap',
        filename: 'The model handed 5 tasks to other models in this chat.',
        content: '',
        chat: 'h2',
      });
    });
    expect(await findByText('Hand-off limit reached')).toBeTruthy();
    expect(queryByTestId('approval-nothing-more')).toBeNull();
    fireEvent.press(getByText('Stop'));
    await expect(answer).resolves.toBe(false);
  });
});
