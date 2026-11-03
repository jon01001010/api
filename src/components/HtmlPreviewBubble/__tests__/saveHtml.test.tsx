import React from 'react';
import {Alert} from 'react-native';
import Share from 'react-native-share';
import * as RNFS from '@dr.pogodin/react-native-fs';

import {fireEvent, render, waitFor} from '../../../../jest/test-utils';
import {HtmlPreviewBubble} from '../HtmlPreviewBubble';
import {htmlFilename, saveHtmlToWorkspace, shareHtmlFile} from '../saveHtml';
import {importWorkspace} from '../../../services/talents/fileWorkspace';

jest.mock('../../../services/talents/fileWorkspace', () => ({
  importWorkspace: jest.fn(async (name: string) => name),
}));
jest.mock('react-native-share', () => ({
  __esModule: true,
  default: {open: jest.fn(async () => ({}))},
}));

describe('htmlFilename', () => {
  it.each([
    ['Current Time', 'Current Time.html'],
    ['  My   Clock!! ', 'My Clock.html'],
    ['../../etc/passwd', 'etc passwd.html'],
    ['', 'preview.html'],
    [undefined, 'preview.html'],
    ['🕒', 'preview.html'],
    ['x'.repeat(100), 'x'.repeat(60) + '.html'],
  ])('%p -> %p', (title, expected) => {
    expect(htmlFilename(title as string | undefined)).toBe(expected);
  });
});

describe('saving', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saves into the workspace without overwriting (via importWorkspace)', async () => {
    (importWorkspace as jest.Mock).mockResolvedValueOnce('Clock-2.html');
    await expect(saveHtmlToWorkspace('<p>x</p>', 'Clock')).resolves.toBe(
      'Clock-2.html',
    );
    expect(importWorkspace).toHaveBeenCalledWith('Clock.html', '<p>x</p>');
  });

  it('shares an .html file through the share sheet', async () => {
    await shareHtmlFile('<p>x</p>', 'Clock');
    expect(RNFS.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/\/Clock\.html$/),
      '<p>x</p>',
      'utf8',
    );
    expect(Share.open).toHaveBeenCalledWith(
      expect.objectContaining({type: 'text/html', filename: 'Clock.html'}),
    );
  });
});

describe('Save button', () => {
  it('offers workspace or share, and saves the raw HTML', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const {getByTestId} = render(
      <HtmlPreviewBubble html="<p>hi</p>" title="Clock" />,
      {withNavigation: true},
    );
    fireEvent.press(getByTestId('html-preview-save'));
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe('Save as .html');
    expect(message).toBe('Clock.html');
    expect(buttons?.map(b => b.text)).toEqual([
      'Save to workspace',
      'Share / save to phone',
      'Cancel',
    ]);
    buttons![0].onPress!();
    await waitFor(() =>
      expect(importWorkspace).toHaveBeenCalledWith('Clock.html', '<p>hi</p>'),
    );
    alert.mockRestore();
  });
});
