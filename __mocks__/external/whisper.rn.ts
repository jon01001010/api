export const mockTranscribeData = jest.fn(() => ({
  stop: jest.fn(),
  promise: Promise.resolve({
    result: ' Hello there',
    language: 'en',
    segments: [],
    isAborted: false,
  }),
}));
export const mockWhisperRelease = jest.fn(() => Promise.resolve());

export const initWhisper = jest.fn(() =>
  Promise.resolve({
    id: 1,
    transcribeData: mockTranscribeData,
    release: mockWhisperRelease,
  }),
);
export const releaseAllWhisper = jest.fn(() => Promise.resolve());
