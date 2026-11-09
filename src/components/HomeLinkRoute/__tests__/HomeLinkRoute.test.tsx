import React from 'react';
import {NativeModules} from 'react-native';
import {render, waitFor} from '@testing-library/react-native';

import {HomeLinkRoute} from '../HomeLinkRoute';

const PC = 'd'.repeat(64);

afterEach(() => {
  delete (NativeModules as any).HomeLink;
});

it('says how the phone reaches the PC and what Load would start', async () => {
  (NativeModules as any).HomeLink = {
    status: jest.fn(async () =>
      JSON.stringify({
        ok: true,
        running: false,
        apiKey: null,
        route: 'direct, 14 ms',
        lastModel: 'Qwen3.5-4B.gguf',
      }),
    ),
  };
  const {getByTestId} = render(<HomeLinkRoute pc={PC} />);
  await waitFor(() =>
    expect(getByTestId('home-link-route').props.children).toBe(
      'Home link: direct, 14 ms · no model running (Load starts Qwen3.5-4B.gguf)',
    ),
  );
});

it("says when the PC can't be reached", async () => {
  (NativeModules as any).HomeLink = {
    status: jest.fn(async () =>
      JSON.stringify({ok: false, error: 'Could not reach the PC'}),
    ),
  };
  const {getByTestId} = render(<HomeLinkRoute pc={PC} />);
  await waitFor(() =>
    expect(getByTestId('home-link-route').props.children).toMatch(
      /can't reach the PC/,
    ),
  );
});
