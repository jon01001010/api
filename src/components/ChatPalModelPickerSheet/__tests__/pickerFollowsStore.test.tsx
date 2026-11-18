/**
 * The chat screen's model list follows the store: models found after the
 * sheet first appeared (on the PC they are found after the app starts) show
 * up, even though the list (like the real FlatList) only draws its items
 * again when its own props change.
 */
import React from 'react';
import {render, act} from '@testing-library/react-native';
import {observable, runInAction} from 'mobx';

import {L10nContext} from '../../../utils';
import {l10n} from '../../../locales';

const mockModels = observable.array<any>([]);
const mockPals = observable.array<any>([]);

jest.mock('../../../store', () => ({
  modelStore: {
    get availableModels() {
      return mockModels;
    },
    activeModel: undefined,
    activeModelId: undefined,
    initContext: jest.fn(),
    selectModel: jest.fn(),
    hasRequiredProjectionModel: jest.fn().mockReturnValue(true),
    getProjectionModelStatus: jest
      .fn()
      .mockReturnValue({isAvailable: true, state: 'not_needed'}),
    getModelVisionPreference: jest.fn().mockReturnValue(true),
  },
  palStore: {
    get pals() {
      return mockPals;
    },
  },
  chatSessionStore: {activePalId: undefined, setActivePal: jest.fn()},
}));

jest.mock('@gorhom/bottom-sheet', () => {
  const mockReact = require('react');
  // Like FlatList: items are drawn again only when its props change.
  const List = mockReact.memo(({data, renderItem}: any) =>
    mockReact.createElement(
      'View',
      null,
      data.map((item: any, index: number) =>
        mockReact.createElement(
          'View',
          {key: item.id},
          renderItem({item, index}),
        ),
      ),
    ),
  );
  const Pass = ({children}: any) =>
    mockReact.createElement('View', null, children);
  return {
    __esModule: true,
    default: mockReact.forwardRef(({children}: any, _ref: any) =>
      mockReact.createElement('View', null, children),
    ),
    BottomSheetFlatList: mockReact.forwardRef((props: any, _ref: any) =>
      mockReact.createElement(List, props),
    ),
    BottomSheetScrollView: Pass,
    BottomSheetView: Pass,
    BottomSheetBackdrop: Pass,
  };
});

import {ChatPalModelPickerSheet} from '../ChatPalModelPickerSheet';

describe('the chat model picker follows the store', () => {
  it('shows models found after it first appeared', () => {
    const view = render(
      <L10nContext.Provider value={l10n.en}>
        <ChatPalModelPickerSheet
          isVisible
          onClose={jest.fn()}
          onModelSelect={jest.fn()}
          onPalSelect={jest.fn()}
          chatInputHeight={0}
        />
      </L10nContext.Provider>,
    );
    expect(view.queryByText('Late Model')).toBeNull();
    act(() => {
      runInAction(() => {
        mockModels.push({
          id: 'late',
          name: 'Late Model',
          isDownloaded: true,
          supportsMultimodal: false,
        });
        mockPals.push({id: 'p1', name: 'Late Pal', palType: 'assistant'});
      });
    });
    expect(view.getByText('Late Model')).toBeTruthy();
    expect(view.getByText('Late Pal')).toBeTruthy();
  });
});
