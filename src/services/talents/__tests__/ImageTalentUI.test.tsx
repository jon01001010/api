import React from 'react';
import * as RNFS from '@dr.pogodin/react-native-fs';
import Share from 'react-native-share';

import {fireEvent, render, waitFor} from '../../../../jest/test-utils';
import {ImageTalentUI} from '../ImageTalentUI';

jest.mock('react-native-share', () => ({
  __esModule: true,
  default: {open: jest.fn(async () => ({}))},
}));

const PATH =
  '/pocketagent/Documents/PocketAgentFiles/images/picture-20261115-101530-ab12.png';

it('shows a made picture inline and saves a copy through Save a copy', async () => {
  (RNFS.readFile as jest.Mock).mockResolvedValueOnce('iVBORw0KGgo=');
  const node = new ImageTalentUI().renderResult({
    type: 'image',
    path: PATH,
    name: 'picture-20261115-101530-ab12.png',
    summary: 'made',
  });
  const {getByTestId} = render(<>{node}</>);
  await waitFor(() =>
    expect(getByTestId('generated-picture-image').props.source).toEqual({
      uri: 'data:image/png;base64,iVBORw0KGgo=',
    }),
  );
  expect(RNFS.readFile).toHaveBeenCalledWith(PATH, 'base64');
  fireEvent.press(getByTestId('generated-picture-save'));
  expect(Share.open).toHaveBeenCalledWith(
    expect.objectContaining({url: 'file://' + PATH}),
  );
});

it('ignores other results and never reads other paths', () => {
  const ui = new ImageTalentUI();
  expect(ui.renderResult({type: 'text', summary: 'x'})).toBeNull();
  (RNFS.readFile as jest.Mock).mockClear();
  const node = ui.renderResult({
    type: 'image',
    path: 'C:/Users/u/secret.png',
    name: 'secret.png',
    summary: 'x',
  });
  render(<>{node}</>);
  expect(RNFS.readFile).not.toHaveBeenCalled();
});
