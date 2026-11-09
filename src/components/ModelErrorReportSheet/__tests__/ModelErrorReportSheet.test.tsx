/**
 * The model error report: copied as text for the user to paste wherever
 * they choose. Nothing is sent from the app (no Google: PocketPal's
 * Firebase report service is never called).
 */
import React from 'react';
import {Alert} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {fireEvent, waitFor} from '@testing-library/react-native';

import {render} from '../../../../jest/test-utils';
import {ModelErrorReportSheet} from '../ModelErrorReportSheet';

const mockSubmit = jest.fn();
jest.mock('../../../api/feedback', () => ({
  submitModelLoadErrorReport: (...a: any[]) => mockSubmit(...a),
}));

it('copies the report and sends nothing', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const {getByText} = render(
    <ModelErrorReportSheet
      isVisible
      onClose={() => {}}
      error={{code: 'unknown', message: 'Model failed to load'} as any}
    />,
  );
  fireEvent.press(getByText('Copy report'));
  await waitFor(() => expect(Clipboard.setString).toHaveBeenCalled());
  const copied = JSON.parse(
    (Clipboard.setString as jest.Mock).mock.calls[0][0],
  );
  expect(copied.errorMessage).toBe('Model failed to load');
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'Copy report',
    expect.stringMatching(/^Copied/),
    expect.anything(),
  );
});
