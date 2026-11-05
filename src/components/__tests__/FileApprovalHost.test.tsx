import React from 'react';
import {AppState} from 'react-native';
import {act, fireEvent, render} from '../../../jest/test-utils';

import {FileApprovalHost} from '../FileApprovalHost';
import {requestFileApproval} from '../../services/talents/fileApprovalGate';

describe('FileApprovalHost: phone actions', () => {
  beforeAll(() => {
    (AppState as any).currentState = 'active';
  });

  it('asks in plain words and resolves with the answer', async () => {
    const {findByText, getByText} = render(<FileApprovalHost />);
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = requestFileApproval({
        action: 'phone_action',
        filename: 'Set a 15 min timer named "Tea"?',
        content: '',
      });
    });
    expect(await findByText('Set a 15 min timer named "Tea"?')).toBeTruthy();
    expect(getByText('Allow this on your phone?')).toBeTruthy();
    fireEvent.press(getByText('Allow once'));
    await expect(answer).resolves.toBe(true);
  });
});
