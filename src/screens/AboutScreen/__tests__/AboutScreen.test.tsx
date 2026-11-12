import React from 'react';
import {Alert, Linking, Platform} from 'react-native';
import {
  render as baseRender,
  fireEvent,
  act,
} from '../../../../jest/test-utils';
import {AboutScreen} from '../AboutScreen';
import Clipboard from '@react-native-clipboard/clipboard';
import {l10n} from '../../../locales';

const render = (ui: React.ReactElement, options: any = {}) =>
  baseRender(ui, {withBottomSheetProvider: true, ...options});

// Mock DeviceInfo
jest.mock('react-native-device-info', () => ({
  getVersion: jest.fn().mockReturnValue('1.0.0'),
  getBuildNumber: jest.fn().mockReturnValue('100'),
}));

// Mock Clipboard
jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: jest.fn(),
}));

// Mock Linking - need to spy on the actual Linking object
const mockOpenURL = jest.fn().mockImplementation(() => Promise.resolve());
jest.spyOn(Linking, 'openURL').mockImplementation(mockOpenURL);

jest.spyOn(Alert, 'alert');

describe('AboutScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly', () => {
    const {getByText} = render(<AboutScreen />);

    expect(getByText('PocketAgent')).toBeTruthy();
    expect(getByText('v1.0.0 (100) · Build: development')).toBeTruthy();
    expect(getByText('Open-source foundations')).toBeTruthy();
    expect(getByText(l10n.en.about.githubButton)).toBeTruthy();
  });

  it('copies version to clipboard when version button is pressed', () => {
    const {getByText} = render(<AboutScreen />);

    fireEvent.press(getByText('v1.0.0 (100) · Build: development'));

    expect(Alert.alert).toHaveBeenCalledWith(
      l10n.en.about.versionCopiedTitle,
      l10n.en.about.versionCopiedDescription,
    );
  });

  it('opens GitHub URL when GitHub button is pressed', () => {
    const {getByText} = render(<AboutScreen />);

    fireEvent.press(getByText('Star on GitHub'));

    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://github.com/a-ghorbani/pocketpal-ai',
    );
  });

  describe.each(['android', 'ios'] as const)('on %s', os => {
    const originalOS = Platform.OS;

    beforeEach(() => {
      Platform.OS = os;
    });

    afterEach(() => {
      Platform.OS = originalOS;
    });

    it('shows no sponsorship option in the support section', () => {
      const {queryByText, getByText} = render(<AboutScreen />);

      expect(queryByText('Become a Sponsor')).toBeNull();
      expect(queryByText('or')).toBeNull();
      expect(getByText(l10n.en.about.githubButton)).toBeTruthy();
      expect(getByText(l10n.en.about.orBy)).toBeTruthy();
      expect(getByText(l10n.en.feedback.shareThoughtsButton)).toBeTruthy();
    });
  });

  it('opens feedback form when share thoughts button is pressed', async () => {
    const {getByText, findByText} = render(<AboutScreen />);

    fireEvent.press(getByText(l10n.en.feedback.shareThoughtsButton));

    expect(await findByText(l10n.en.feedback.useCase.label)).toBeTruthy();
    expect(
      await findByText(l10n.en.feedback.featureRequests.label),
    ).toBeTruthy();
    expect(
      await findByText(l10n.en.feedback.generalFeedback.label),
    ).toBeTruthy();
    expect(
      await findByText(l10n.en.feedback.usageFrequency.label),
    ).toBeTruthy();
  });

  it('submits feedback successfully', async () => {
    const {findByText, getByText, findByPlaceholderText} = render(
      <AboutScreen />,
    );

    // Open feedback form
    fireEvent.press(getByText(l10n.en.feedback.shareThoughtsButton));

    const useCaseInput = await findByPlaceholderText(
      l10n.en.feedback.useCase.placeholder,
    );
    fireEvent.changeText(useCaseInput, 'Test use case');

    const featureRequestsInput = await findByPlaceholderText(
      l10n.en.feedback.featureRequests.placeholder,
    );
    fireEvent.changeText(featureRequestsInput, 'Test feature request');

    const generalFeedbackInput = await findByPlaceholderText(
      l10n.en.feedback.generalFeedback.placeholder,
    );
    fireEvent.changeText(generalFeedbackInput, 'Test feedback');

    const dailyButton = await findByText(
      l10n.en.feedback.usageFrequency.options.daily,
    );
    fireEvent.press(dailyButton);

    // Submit form
    const submitButton = await findByText('Copy feedback');
    await act(async () => {
      fireEvent.press(submitButton);
    });

    // Copied, never sent.
    expect(
      JSON.parse((Clipboard.setString as jest.Mock).mock.calls.at(-1)[0]),
    ).toEqual({
      useCase: 'Test use case',
      featureRequests: 'Test feature request',
      generalFeedback: 'Test feedback',
      usageFrequency: 'daily',
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Feedback copied',
      expect.stringMatching(/Nothing was sent/),
    );
  });

  it('shows validation error when submitting empty feedback', async () => {
    const {getByText, findByText} = render(<AboutScreen />);

    // Open feedback form
    fireEvent.press(getByText(l10n.en.feedback.shareThoughtsButton));

    // Submit empty form
    const submitButton = await findByText('Copy feedback');
    await act(async () => {
      fireEvent.press(submitButton);
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      l10n.en.feedback.validation.required,
    );
    expect(Clipboard.setString).not.toHaveBeenCalled();
  });
});
