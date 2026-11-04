// The package ships types under another module name; declare its real one.
declare module '@fugood/react-native-audio-pcm-stream' {
  export interface Options {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    audioSource?: number;
    wavFile: string;
    bufferSize?: number;
  }
  const LiveAudioStream: {
    /** Rejects when the microphone can't be opened. */
    init: (options: Options) => Promise<void> | void;
    start: () => void;
    stop: () => Promise<string>;
    on: (event: 'data', callback: (data: string) => void) => unknown;
  };
  export default LiveAudioStream;
}
