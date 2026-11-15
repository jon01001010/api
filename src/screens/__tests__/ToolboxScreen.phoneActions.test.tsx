import React from 'react';
import {fireEvent, render, waitFor} from '../../../jest/test-utils';

import {ToolboxScreen} from '../ToolboxScreen';
import {PHONE_TOOL_NAMES} from '../../services/talents/PhoneActionsEngine';
import {readGlobalTools, setToolsEnabled} from '../../utils/globalToolSettings';

const mockListeners: (() => void)[] = [];
jest.mock('../../utils/globalToolSettings', () => ({
  readGlobalTools: jest.fn().mockResolvedValue([]),
  writeGlobalTools: jest.fn().mockResolvedValue(undefined),
  setToolsEnabled: jest.fn(async (names: string[], on: boolean) =>
    on ? names : [],
  ),
  onToolSwitchesChanged: jest.fn((listener: () => void) => {
    mockListeners.push(listener);
    return () => {};
  }),
  readGlobalPrompt: jest.fn().mockResolvedValue(''),
  writeGlobalPrompt: jest.fn().mockResolvedValue(undefined),
  generatedToolPrompt: jest.fn().mockReturnValue(''),
  readAgentMaxTurns: jest.fn().mockResolvedValue(20),
  writeAgentMaxTurns: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../components/PalsSheets/MemorySection', () => ({
  MemorySection: () => null,
}));

describe('Toolbox: phone actions group', () => {
  it('turns every phone action on with one switch, each listed on request', async () => {
    const {getByTestId, queryByTestId} = render(<ToolboxScreen />, {
      withNavigation: true,
    });
    // Individual switches stay folded away until asked for.
    expect(queryByTestId('toolbox-toggle-set_timer')).toBeNull();
    const all = getByTestId('toolbox-toggle-phone-actions');
    await waitFor(() => expect(all.props.disabled).toBeFalsy());
    fireEvent(all, 'onValueChange', true);
    // Only these names, against the stored list (not this screen's copy).
    await waitFor(() =>
      expect(setToolsEnabled).toHaveBeenCalledWith(PHONE_TOOL_NAMES, true),
    );
    fireEvent.press(getByTestId('toolbox-phone-actions-each'));
    expect(getByTestId('toolbox-toggle-set_timer')).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId('toolbox-toggle-set_timer').props.value).toBe(true),
    );
  });

  it('shows switches changed elsewhere (a sync) while open', async () => {
    const {getByTestId} = render(<ToolboxScreen />, {withNavigation: true});
    const all = getByTestId('toolbox-toggle-phone-actions');
    await waitFor(() => expect(all.props.disabled).toBeFalsy());
    fireEvent(all, 'onValueChange', true);
    await waitFor(() =>
      expect(getByTestId('toolbox-toggle-phone-actions').props.value).toBe(
        true,
      ),
    );
    // Stored list changed elsewhere: the screen reads it again.
    (readGlobalTools as jest.Mock).mockResolvedValueOnce([]);
    mockListeners.forEach(listener => listener());
    await waitFor(() =>
      expect(getByTestId('toolbox-toggle-phone-actions').props.value).toBe(
        false,
      ),
    );
  });
});

describe('Toolbox: test drafts are a developer setting', () => {
  const {uiStore} = require('../../store');
  afterEach(() => {
    uiStore.showDevSettings = false;
  });

  it('hides test drafts while developer settings are off', () => {
    uiStore.showDevSettings = false;
    const {queryByText} = render(<ToolboxScreen />, {withNavigation: true});
    expect(queryByText('Create test draft')).toBeNull();
  });

  it('shows test drafts when developer settings are on', () => {
    uiStore.showDevSettings = true;
    const {getByText} = render(<ToolboxScreen />, {withNavigation: true});
    expect(getByText('Create test draft')).toBeTruthy();
  });
});
