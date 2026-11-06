import React from 'react';
import {fireEvent, render, waitFor} from '../../../jest/test-utils';

import {ToolboxScreen} from '../ToolboxScreen';
import {PHONE_TOOL_NAMES} from '../../services/talents/PhoneActionsEngine';
import {writeGlobalTools} from '../../utils/globalToolSettings';

jest.mock('../../utils/globalToolSettings', () => ({
  readGlobalTools: jest.fn().mockResolvedValue([]),
  writeGlobalTools: jest.fn().mockResolvedValue(undefined),
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
    await waitFor(() =>
      expect(writeGlobalTools).toHaveBeenCalledWith(PHONE_TOOL_NAMES),
    );
    fireEvent.press(getByTestId('toolbox-phone-actions-each'));
    expect(getByTestId('toolbox-toggle-set_timer')).toBeTruthy();
  });
});
