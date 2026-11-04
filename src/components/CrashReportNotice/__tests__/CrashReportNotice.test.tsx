import React from 'react';
import Clipboard from '@react-native-clipboard/clipboard';

import {fireEvent, render, waitFor} from '../../../../jest/test-utils';
import * as reports from '../../../services/diagnostics/crashReports';

import {CrashReportNotice} from '../CrashReportNotice';

const crash = {
  time: Date.UTC(2026, 10, 4, 12),
  kind: 'Native crash',
  summary: 'PocketAgent crashed in native code (librnwhisper.so).',
  details: 'Trace: ...librnwhisper.so',
};

describe('CrashReportNotice', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('tells the user on the next launch, with Copy details', async () => {
    jest.spyOn(reports, 'takeNewCrashReports').mockResolvedValue([crash]);
    const {findByText, getByTestId} = render(<CrashReportNotice />);
    expect(await findByText('PocketAgent closed unexpectedly')).toBeTruthy();
    expect(await findByText(/librnwhisper\.so\)\./)).toBeTruthy();
    fireEvent.press(getByTestId('crash-report-copy'));
    expect(Clipboard.setString).toHaveBeenCalledWith(
      'Trace: ...librnwhisper.so',
    );
  });

  it('stays hidden when nothing new happened', async () => {
    const take = jest
      .spyOn(reports, 'takeNewCrashReports')
      .mockResolvedValue([]);
    const {queryByText} = render(<CrashReportNotice />);
    await waitFor(() => expect(take).toHaveBeenCalled());
    expect(queryByText('PocketAgent closed unexpectedly')).toBeNull();
  });

  it('lists given reports (from Settings)', () => {
    const {getByText} = render(
      <CrashReportNotice reports={[]} visible onClose={jest.fn()} />,
    );
    expect(getByText('No recent crashes recorded.')).toBeTruthy();
  });
});
