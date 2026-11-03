import React from 'react';

import {fireEvent, render} from '../../../../jest/test-utils';
import {uiStore} from '../../../store';
import {PhosphorTintControls} from '../PhosphorTintControls';

describe('PhosphorTintControls', () => {
  beforeEach(() => {
    (uiStore as any).phosphorTint = [133, 255, 155];
    (uiStore.setPhosphorTint as jest.Mock).mockClear();
  });

  it('shows R/G/B sliders at the saved colour and Reset disabled', () => {
    const {getByTestId} = render(<PhosphorTintControls />);
    expect(getByTestId('phosphor-tint-r').props.value).toBe(133);
    expect(getByTestId('phosphor-tint-g').props.value).toBe(255);
    expect(getByTestId('phosphor-tint-b').props.value).toBe(155);
    expect(
      getByTestId('phosphor-tint-reset').props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it('updates the swatch live and saves on release', () => {
    const {getByTestId} = render(<PhosphorTintControls />);
    const r = getByTestId('phosphor-tint-r');
    fireEvent(r, 'valueChange', 10);
    expect(getByTestId('phosphor-tint-swatch').props.accessibilityLabel).toBe(
      'rgb(10, 255, 155)',
    );
    expect(uiStore.setPhosphorTint).not.toHaveBeenCalled();
    fireEvent(r, 'slidingComplete', 10);
    expect(uiStore.setPhosphorTint).toHaveBeenCalledWith([10, 255, 155]);
  });

  it('resets to the original green', () => {
    (uiStore as any).phosphorTint = [0, 0, 255];
    const {getByTestId} = render(<PhosphorTintControls />);
    fireEvent.press(getByTestId('phosphor-tint-reset'));
    expect(uiStore.setPhosphorTint).toHaveBeenCalledWith([133, 255, 155]);
  });
});
