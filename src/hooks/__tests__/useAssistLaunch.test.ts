import {listenForAssist} from '../useAssistLaunch';
import {startVoiceInput} from '../../services/voice/voiceController';

jest.mock('../../services/voice/voiceController', () => ({
  startVoiceInput: jest.fn(),
}));

describe('opened as the phone assistant', () => {
  it('goes to Chat and starts listening once the chat input is ready', async () => {
    (startVoiceInput as jest.Mock)
      .mockResolvedValueOnce('no-sender')
      .mockResolvedValueOnce('started');
    const navigate = jest.fn();
    await listenForAssist(navigate);
    expect(navigate).toHaveBeenCalledWith('Chat');
    expect(startVoiceInput).toHaveBeenCalledTimes(2);
  });

  it('gives up after a few tries instead of waiting forever', async () => {
    (startVoiceInput as jest.Mock).mockResolvedValue('no-sender');
    await listenForAssist(jest.fn(), 3);
    expect(startVoiceInput).toHaveBeenCalledTimes(3);
  });
});
