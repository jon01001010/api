import React from 'react';

import {fireEvent, render, waitFor} from '../../../../jest/test-utils';

import {chatSessionStore, uiStore} from '../../../store';
import {l10n} from '../../../locales';
import {SUMMARY_AUTHOR_ID} from '../../../services/chatSummary';

import {ContextSummaryCard} from '../ContextSummaryCard';

const message = {
  id: 'summary-1',
  author: {id: SUMMARY_AUTHOR_ID},
  createdAt: 0,
  type: 'text',
  text: 'They planned a trip to Rome.',
  metadata: {contextSummary: true, keptIds: [], summarizedCount: 6},
} as any;

describe('ContextSummaryCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the count and toggles the summary text', () => {
    const {getByText, getByTestId, queryByTestId} = render(
      <ContextSummaryCard message={message} />,
    );
    expect(getByText('Earlier messages summarized (6)')).toBeTruthy();
    expect(queryByTestId('context-summary-text')).toBeNull();
    fireEvent.press(getByTestId('context-summary-toggle'));
    expect(getByTestId('context-summary-text')).toHaveTextContent(
      'They planned a trip to Rome.',
    );
    expect(getByText(l10n.en.chat.summaryHide)).toBeTruthy();
  });

  it('Undo removes the marker', async () => {
    const {getByTestId} = render(<ContextSummaryCard message={message} />);
    fireEvent.press(getByTestId('context-summary-undo'));
    await waitFor(() =>
      expect(chatSessionStore.deleteMessageFromSession).toHaveBeenCalledWith(
        chatSessionStore.activeSessionId,
        'summary-1',
      ),
    );
    expect(uiStore.setSummaryNotice).toHaveBeenCalledWith(null);
  });

  it('Edit saves the new text', async () => {
    const {getByTestId} = render(<ContextSummaryCard message={message} />);
    fireEvent.press(getByTestId('context-summary-edit'));
    fireEvent.changeText(
      getByTestId('context-summary-input'),
      'They planned a trip to Paris.',
    );
    fireEvent.press(getByTestId('context-summary-save'));
    await waitFor(() =>
      expect(chatSessionStore.updateMessage).toHaveBeenCalledWith(
        'summary-1',
        chatSessionStore.activeSessionId,
        {text: 'They planned a trip to Paris.'},
      ),
    );
  });
});
