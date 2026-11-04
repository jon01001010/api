import React from 'react';
import {runInAction} from 'mobx';

import {fireEvent, render, waitFor} from '../../../../jest/test-utils';

import {chatSessionStore, uiStore} from '../../../store';
import {l10n} from '../../../locales';

import {SummaryNotice} from '../SummaryNotice';

const show = (notice: any) =>
  runInAction(() => {
    uiStore.summaryNotice = notice;
  });

describe('SummaryNotice', () => {
  afterEach(() => show(null));

  it('shows progress, then the automatic result with Undo', async () => {
    show({kind: 'working'});
    const view = render(<SummaryNotice />);
    expect(view.getByText(l10n.en.chat.summaryWorking)).toBeTruthy();
    expect(view.queryByText(l10n.en.chat.summaryUndo)).toBeNull();
    view.unmount();

    show({kind: 'done', messageId: 'summary-9', automatic: true});
    const done = render(<SummaryNotice />);
    expect(done.getByText(l10n.en.chat.summaryDoneAuto)).toBeTruthy();
    fireEvent.press(done.getByText(l10n.en.chat.summaryUndo));
    await waitFor(() =>
      expect(chatSessionStore.deleteMessageFromSession).toHaveBeenCalledWith(
        chatSessionStore.activeSessionId,
        'summary-9',
      ),
    );
  });

  it('explains a failure', () => {
    show({kind: 'failed'});
    const {getByText} = render(<SummaryNotice />);
    expect(getByText(l10n.en.chat.summaryFailed)).toBeTruthy();
  });
});
