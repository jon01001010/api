import React from 'react';

import {render} from '../../../../jest/test-utils';
import {PHOSPHOR_FONT} from '../../../theme/phosphor';
import {ReasoningBlock} from '../ReasoningBlock';

const mockRenderHtmlProps = jest.fn();
jest.mock('react-native-render-html', () => {
  const actual = jest.requireActual('react-native-render-html');
  return {
    ...actual,
    __esModule: true,
    default: (props: {systemFonts: string[]}) => {
      mockRenderHtmlProps(props);
      return null;
    },
  };
});

describe('ReasoningBlock', () => {
  it('registers the Phosphor mono font so it is not dropped', () => {
    render(<ReasoningBlock text="thinking..." maxWidth={300} />);
    const {systemFonts} = mockRenderHtmlProps.mock.calls.at(-1)[0];
    expect(systemFonts).toEqual(
      expect.arrayContaining([PHOSPHOR_FONT.regular, PHOSPHOR_FONT.medium]),
    );
  });

  it('renders nothing for empty reasoning', () => {
    mockRenderHtmlProps.mockClear();
    render(<ReasoningBlock text="   " maxWidth={300} />);
    expect(mockRenderHtmlProps).not.toHaveBeenCalled();
  });
});
