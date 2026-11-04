// The real store: it only touches mocked storage and file system.
const {VoiceStore} = jest.requireActual('../../src/store/VoiceStore');

export const mockVoiceStore = new VoiceStore();
