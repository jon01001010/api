import * as RNFS from '@dr.pogodin/react-native-fs';

import {fetchModels} from '../../../api/hf';
import {
  downloadWhisperModel,
  isWhisperModelFile,
  searchWhisperModels,
  whisperModelPath,
} from '../whisperModels';

jest.mock('../../../api/hf', () => ({
  fetchModels: jest.fn(),
  fetchModelFilesDetails: jest.fn(),
}));

describe('whisperModels', () => {
  beforeEach(() => jest.clearAllMocks());

  it('recognises Whisper GGML files only', () => {
    expect(isWhisperModelFile('ggml-base.en.bin')).toBe(true);
    expect(isWhisperModelFile('models/ggml-small-q5_1.bin')).toBe(true);
    expect(isWhisperModelFile('ggml-silero-v5.1.2.bin')).toBe(false);
    expect(isWhisperModelFile('ggml-base-encoder.mlmodelc.zip')).toBe(false);
    expect(isWhisperModelFile('model.gguf')).toBe(false);
    expect(isWhisperModelFile('pytorch_model.bin')).toBe(false);
  });

  it('keeps each model in a folder named after its repo', () => {
    expect(
      whisperModelPath({repo: 'ggerganov/whisper.cpp', file: 'ggml-base.bin'}),
    ).toMatch(/voice-models\/ggerganov__whisper\.cpp\/ggml-base\.bin$/);
  });

  it('finds Whisper files in any repo', async () => {
    (fetchModels as jest.Mock).mockResolvedValue({
      models: [
        {
          id: 'ggerganov/whisper.cpp',
          downloads: 10,
          siblings: [
            {rfilename: 'ggml-base.en.bin', size: 148e6},
            {rfilename: 'README.md'},
            {rfilename: 'ggml-silero-v5.1.2.bin'},
          ],
        },
        {id: 'someone/other', siblings: [{rfilename: 'model.onnx'}]},
      ],
      nextLink: null,
    });
    const results = await searchWhisperModels('');
    expect(fetchModels).toHaveBeenCalledWith(
      expect.objectContaining({search: 'whisper', full: true}),
    );
    expect(results).toEqual([
      {
        repo: 'ggerganov/whisper.cpp',
        file: 'ggml-base.en.bin',
        downloads: 10,
        size: 148e6,
      },
    ]);
  });

  it('downloads to a temporary file, then moves it into place', async () => {
    (RNFS.downloadFile as jest.Mock).mockReturnValue({
      promise: Promise.resolve({statusCode: 200}),
    });
    (RNFS as any).moveFile = jest.fn(() => Promise.resolve());
    (RNFS.stat as jest.Mock).mockResolvedValue({size: 1234});
    (RNFS.exists as jest.Mock).mockResolvedValue(false);
    const m = {repo: 'ggerganov/whisper.cpp', file: 'ggml-tiny.bin'};
    const done = await downloadWhisperModel(m);
    const call = (RNFS.downloadFile as jest.Mock).mock.calls[0][0];
    expect(call.fromUrl).toBe(
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    );
    expect(call.toFile).toBe(`${whisperModelPath(m)}.part`);
    expect((RNFS as any).moveFile).toHaveBeenCalledWith(
      `${whisperModelPath(m)}.part`,
      whisperModelPath(m),
    );
    expect(done.size).toBe(1234);
  });

  it('removes the partial file when a download fails', async () => {
    (RNFS.downloadFile as jest.Mock).mockReturnValue({
      promise: Promise.resolve({statusCode: 404}),
    });
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    await expect(
      downloadWhisperModel({repo: 'a/b', file: 'ggml-x.bin'}),
    ).rejects.toThrow('HTTP 404');
    expect(RNFS.unlink).toHaveBeenCalledWith(
      expect.stringMatching(/ggml-x\.bin\.part$/),
    );
  });
});
