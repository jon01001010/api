/** Test stand-in: emit() feeds audio chunks (base64) to the listener. */
let listener: ((data: string) => void) | null = null;

const LiveAudioStream = {
  init: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(() => Promise.resolve('')),
  on: jest.fn((_event: string, cb: (data: string) => void) => {
    listener = cb;
    return {
      remove: () => {
        listener = null;
      },
    };
  }),
  emit: (data: string) => listener?.(data),
};

export default LiveAudioStream;
