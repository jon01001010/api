import React from 'react';
import {Alert, Platform} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

import {fireEvent, render, waitFor} from '../../../jest/test-utils';
import {CustomToolsSection} from '../CustomToolsSection';
import * as customTools from '../../services/talents/customTools';
import * as toolImport from '../../services/talents/toolImport';
import {packTool, QR_MAX_CHARS} from '../../services/talents/toolQr';
import {pairHomePc} from '../../services/homeLink/pairHomePc';
import type {CustomTool} from '../../services/talents/customTools';

jest.mock('../../services/homeLink/pairHomePc', () => ({
  pairHomePc: jest.fn(async () => ({ok: true, message: 'paired'})),
}));

const shortcut: CustomTool = {
  kind: 'shortcut',
  name: 'morning_routine',
  description: 'when I say good morning',
  steps: [
    {tool: 'set_alarm', args: {hour: '{{hour}}', minute: 0}},
    {tool: 'open_app', args: {name: 'Radio'}},
  ],
  createdBy: 'user',
};

const section = () =>
  render(
    <CustomToolsSection
      enabledTools={[]}
      disabled={false}
      onToggle={() => {}}
      errorColor="red"
    />,
  );
/** Rendered, with the tool list loaded. */
const loaded = async () => {
  const r = section();
  await waitFor(() => r.getByText(/Custom tools \(\d+\)/));
  await waitFor(() => expect(customTools.listCustomTools).toHaveBeenCalled());
  await waitFor(() => r.getAllByText(/routine|big_one/));
  return r;
};

let installed: CustomTool[] = [];
beforeEach(() => {
  installed = [];
  jest
    .spyOn(customTools, 'listCustomTools')
    .mockImplementation(async () => [shortcut, ...installed]);
  jest
    .spyOn(customTools, 'builtInToolNames')
    .mockReturnValue(['set_alarm', 'open_app', 'datetime']);
  jest
    .spyOn(customTools, 'saveCustomTool')
    .mockImplementation(async (t: any) => {
      installed.push(t);
      return t;
    });
  jest.spyOn(customTools, 'switchOffTools').mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

describe('sharing a tool', () => {
  it('shows a QR, copies the code and offers a file', async () => {
    const {getByTestId, queryByTestId} = section();
    await waitFor(() => getByTestId('custom-tool-share-morning_routine'));
    fireEvent.press(getByTestId('custom-tool-share-morning_routine'));
    expect(getByTestId('tool-share-qr')).toBeTruthy();
    expect(queryByTestId('tool-share-too-big')).toBeNull();
    fireEvent.press(getByTestId('tool-share-copy'));
    expect(Clipboard.setString).toHaveBeenCalledWith(packTool(shortcut));
    expect(getByTestId('tool-share-file')).toBeTruthy();
  });

  it('says when a tool is too big for one QR', async () => {
    const big: CustomTool = {
      kind: 'instructions',
      name: 'big_one',
      description: 'x',
      // Random-ish text that doesn't pack small.
      instructions: Array.from({length: 3000}, (_, i) =>
        ((i * 7919) % 9973).toString(36),
      ).join(''),
      createdBy: 'user',
    };
    expect(packTool(big).length).toBeGreaterThan(QR_MAX_CHARS);
    (customTools.listCustomTools as jest.Mock).mockResolvedValue([big]);
    const {getByTestId, queryByTestId} = section();
    await waitFor(() => getByTestId('custom-tool-share-big_one'));
    fireEvent.press(getByTestId('custom-tool-share-big_one'));
    expect(getByTestId('tool-share-too-big')).toBeTruthy();
    expect(queryByTestId('tool-share-qr')).toBeNull();
  });
});

describe('reading a code', () => {
  it('shows the full definition, then installs switched off', async () => {
    const install = jest.spyOn(toolImport, 'installSharedTool');
    const {getByTestId} = await loaded();
    fireEvent.press(getByTestId('custom-tool-paste'));
    fireEvent.changeText(
      getByTestId('tool-receive-paste'),
      packTool({...shortcut, name: 'evening_routine'}),
    );
    fireEvent.press(getByTestId('tool-receive-read'));
    await waitFor(() => getByTestId('tool-receive-definition'));
    const shown = getByTestId('tool-receive-definition').props.children;
    expect(shown).toMatch(/Fill-ins: hour/);
    expect(shown).toMatch(/1\. set_alarm \{"hour":"\{\{hour\}\}","minute":0\}/);
    expect(shown).toMatch(/2\. open_app \{"name":"Radio"\}/);
    expect(install).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('tool-receive-install'));
    await waitFor(() => expect(installed).toHaveLength(1));
    expect(customTools.switchOffTools).toHaveBeenCalledWith([
      'evening_routine',
    ]);
    expect(installed[0]).toMatchObject({
      name: 'evening_routine',
      createdBy: 'user',
    });
  });

  it('asks for another name on a clash', async () => {
    const {getByTestId, queryByTestId} = await loaded();
    fireEvent.press(getByTestId('custom-tool-paste'));
    fireEvent.changeText(getByTestId('tool-receive-paste'), packTool(shortcut));
    fireEvent.press(getByTestId('tool-receive-read'));
    await waitFor(() => getByTestId('tool-receive-new-name'));
    expect(queryByTestId('tool-receive-install')).toBeNull();
    fireEvent.changeText(getByTestId('tool-receive-new-name'), 'morning_two');
    fireEvent.press(getByTestId('tool-receive-rename'));
    await waitFor(() => getByTestId('tool-receive-install'));
    fireEvent.press(getByTestId('tool-receive-install'));
    await waitFor(() => expect(installed).toHaveLength(1));
    expect(installed[0].name).toBe('morning_two');
  });

  it('refuses unknown codes and tools that fail the checks', async () => {
    const {getByTestId} = await loaded();
    fireEvent.press(getByTestId('custom-tool-paste'));
    fireEvent.changeText(getByTestId('tool-receive-paste'), 'PA1:X:hello');
    fireEvent.press(getByTestId('tool-receive-read'));
    await waitFor(() =>
      expect(getByTestId('tool-receive-error').props.children).toMatch(
        /Not a PocketAgent code/,
      ),
    );
    fireEvent.changeText(
      getByTestId('tool-receive-paste'),
      packTool({
        ...shortcut,
        name: 'sneaky',
        steps: [{tool: 'tool_save', args: {}}],
      }),
    );
    fireEvent.press(getByTestId('tool-receive-read'));
    await waitFor(() =>
      expect(getByTestId('tool-receive-error').props.children).toMatch(
        /not a built-in tool a shortcut can use/,
      ),
    );
    expect(installed).toHaveLength(0);
  });

  it('hands a pairing code to the existing pairing, after asking', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const code = `PA1:P:${'a'.repeat(64)}:${'b'.repeat(32)}`;
    const {getByTestId} = await loaded();
    fireEvent.press(getByTestId('custom-tool-paste'));
    fireEvent.changeText(getByTestId('tool-receive-paste'), code);
    fireEvent.press(getByTestId('tool-receive-read'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(pairHomePc).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as any[];
    buttons.find(b => b.text === 'Pair').onPress();
    expect(pairHomePc).toHaveBeenCalledWith(code);
  });

  it('opens the camera from Scan QR on the phone', async () => {
    const {getByTestId} = await loaded();
    fireEvent.press(getByTestId('custom-tool-scan'));
    await waitFor(() => getByTestId('code-scanner-camera'));
  });

  it('opens the paste box from Scan QR on the desktop (no camera)', async () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', {value: 'web', configurable: true});
    try {
      const {getByTestId, queryByTestId} = await loaded();
      fireEvent.press(getByTestId('custom-tool-scan'));
      expect(getByTestId('tool-receive-paste')).toBeTruthy();
      expect(queryByTestId('code-scanner-camera')).toBeNull();
      expect(queryByTestId('tool-receive-camera')).toBeNull();
    } finally {
      Object.defineProperty(Platform, 'OS', {value: os, configurable: true});
    }
  });
});
