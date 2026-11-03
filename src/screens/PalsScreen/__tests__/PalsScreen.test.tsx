/**
 * PalsScreen in this fork is a simple "local assistants" screen: no
 * account, sync, PalsHub library or filters (those upstream features were
 * removed). These tests cover what the screen does now.
 */
import React from 'react';
import {fireEvent} from '@testing-library/react-native';

import {render} from '../../../../jest/test-utils';
import {PalsScreen} from '../PalsScreen';
import {palStore} from '../../../store';
import {createPal} from '../../../../jest/fixtures/pals';

const mockSheetProps = jest.fn();
jest.mock('../../../components/PalsSheets', () => ({
  PalSheet: (props: {pal: {name?: string; type?: string}}) => {
    mockSheetProps(props);
    const {View: MockView} = require('react-native');
    return <MockView testID="pal-sheet" />;
  },
}));

describe('PalsScreen (local assistants)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    palStore.pals = [];
  });

  it('shows the empty state when there are no local assistants', () => {
    const {getByText, queryByTestId} = render(<PalsScreen />, {
      withNavigation: true,
    });
    expect(getByText('Local assistants')).toBeTruthy();
    expect(
      getByText('No local assistants yet. Create one with the + button.'),
    ).toBeTruthy();
    expect(queryByTestId('pal-sheet')).toBeNull();
  });

  it('lists only local assistants', () => {
    palStore.pals = [
      createPal({id: 'mine', name: 'My Helper', source: 'local'}),
      createPal({id: 'hub', name: 'Hub Pal', source: 'palshub'} as any),
    ];
    const {getByTestId, queryByTestId} = render(<PalsScreen />, {
      withNavigation: true,
    });
    expect(getByTestId('local-pal-card-mine')).toBeTruthy();
    expect(queryByTestId('palshub-pal-card-hub')).toBeNull();
  });

  it('opens the editor when an assistant is tapped', () => {
    palStore.pals = [
      createPal({id: 'mine', name: 'My Helper', source: 'local'}),
    ];
    const {getByTestId} = render(<PalsScreen />, {withNavigation: true});
    fireEvent.press(getByTestId('local-pal-card-mine'));
    expect(getByTestId('pal-sheet')).toBeTruthy();
    expect(mockSheetProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pal: expect.objectContaining({name: 'My Helper'}),
      }),
    );
  });

  it.each([
    ['Assistant', false],
    ['Roleplay', true],
  ])('creates a new %s from the + menu', (label, hasSchema) => {
    const {getByTestId, getByText} = render(<PalsScreen />, {
      withNavigation: true,
    });
    fireEvent.press(getByTestId('bottom-action-add'));
    fireEvent.press(getByText(label));
    expect(getByTestId('pal-sheet')).toBeTruthy();
    const {pal} = mockSheetProps.mock.calls.at(-1)[0];
    expect(pal).toMatchObject({name: '', source: 'local'});
    expect(String(pal.originalSystemPrompt).includes('json-schema')).toBe(
      hasSchema,
    );
  });
});

