import React from 'react';

import {render, fireEvent} from '../../../../jest/test-utils';

import {HeaderRight} from '../HeaderRight';

import {chatSessionStore, uiStore} from '../../../store';
import {L10nContext} from '../../../utils';
import {l10n} from '../../../locales';

jest.mock('../../UsageStats', () => ({
  UsageStats: jest.fn(() => {
    const {View} = require('react-native');
    return <View testID="usage-stats" />;
  }),
}));

const renderWithI18n = (ui: React.ReactElement) => {
  return render(
    <L10nContext.Provider value={l10n.en as any}>{ui}</L10nContext.Provider>,
  );
};

describe('HeaderRight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chatSessionStore.sessions = [];
    chatSessionStore.activeSessionId = null;
  });

  it('renders without UsageStats when displayMemUsage is false', () => {
    uiStore.displayMemUsage = false;
    const {queryByTestId} = renderWithI18n(<HeaderRight />);
    expect(queryByTestId('usage-stats')).toBeNull();
    expect(queryByTestId('reset-button')).toBeTruthy();
  });

  it('renders UsageStats when displayMemUsage is true', () => {
    uiStore.displayMemUsage = true;
    const {queryByTestId} = renderWithI18n(<HeaderRight />);
    expect(queryByTestId('usage-stats')).toBeTruthy();
    expect(queryByTestId('reset-button')).toBeTruthy();
  });

  it('calls resetActiveSession when reset button is pressed', () => {
    const {queryByTestId} = renderWithI18n(<HeaderRight />);
    const resetButton = queryByTestId('reset-button');
    expect(resetButton).toBeTruthy();
    if (resetButton) {
      fireEvent.press(resetButton);
    }
    expect(chatSessionStore.resetActiveSession).toHaveBeenCalled();
  });

  it('has no ⋮ menu: its items moved to Settings and the side menu', () => {
    const {queryByTestId} = renderWithI18n(<HeaderRight />);
    expect(queryByTestId('menu-button')).toBeNull();
  });
});
