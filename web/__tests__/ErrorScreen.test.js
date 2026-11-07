import React from 'react';
import {render} from '@testing-library/react-native';

import {ErrorScreen, describeError} from '../ErrorScreen';

function Broken() {
  throw new Error('sheet exploded');
}

describe('desktop error screen', () => {
  it('shows the error instead of an empty window', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const {getByTestId, getByText} = render(
      <ErrorScreen>
        <Broken />
      </ErrorScreen>,
    );
    expect(getByTestId('desktop-error-screen')).toBeTruthy();
    expect(getByText(/sheet exploded/)).toBeTruthy();
    expect(getByText('Reload')).toBeTruthy();
    spy.mockRestore();
  });

  it('describes errors with their stack', () => {
    const e = new Error('x');
    expect(describeError(e)).toContain('Error: x');
    expect(describeError(null)).toBe('Unknown error');
  });
});
