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

it("shows a picture the Home PC made for this phone, from the app's cache folder only", async () => {
  const fs = require('@dr.pogodin/react-native-fs');
  const before = fs.CachesDirectoryPath;
  fs.CachesDirectoryPath = '/data/app/cache';
  try {
    const path = '/data/app/cache/pc-pictures/picture-20261115-101530-ab12.png';
    (RNFS.readFile as jest.Mock).mockClear();
    (RNFS.readFile as jest.Mock).mockResolvedValueOnce('iVBORw0KGgo=');
    const ui = new ImageTalentUI();
    const {getByTestId, getByText} = render(
      <>
        {ui.renderResult({
          type: 'image',
          path,
          name: 'picture-20261115-101530-ab12.png',
          summary: 'made',
        })}
      </>,
    );
    await waitFor(() => getByTestId('generated-picture-image'));
    expect(RNFS.readFile).toHaveBeenCalledWith(path, 'base64');
    getByText('picture-20261115-101530-ab12.png');
    // Anything else in the cache folder, or a way out of it: never read.
    (RNFS.readFile as jest.Mock).mockClear();
    for (const bad of [
      '/data/app/cache/attach-x.png',
      '/data/app/cache/pc-pictures/../secret.png',
      '/data/app/cache/pc-pictures/sub/picture-1.png',
      '/data/app/cache/pc-pictures/picture-1.jpg',
      '/data/app/cachex/pc-pictures/picture-1.png',
    ]) {
      render(
        <>
          {ui.renderResult({type: 'image', path: bad, name: 'x', summary: ''})}
        </>,
      );
    }
    expect(RNFS.readFile).not.toHaveBeenCalled();
  } finally {
    fs.CachesDirectoryPath = before;
  }
});
