import {
  isPictureModel,
  isSd15SingleFile,
  modelPictureHints,
  repoPictureHints,
} from '../pictureModel';

describe('picture models are told apart from chat models', () => {
  it('finds the picture model the owner downloaded', () => {
    expect(
      isPictureModel({
        filename: 'stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf',
        repo: 'second-state/stable-diffusion-v1-5-GGUF',
      }),
    ).toBe(true);
  });

  it('by name: SD 1.5, SDXL, SD 3, FLUX, a UNet or VAE', () => {
    for (const filename of [
      'sd-v1-5-Q8_0.gguf',
      'sd15-q4.gguf',
      'v1-5-pruned-emaonly-Q4_0.gguf',
      'sd_xl_base_1.0-Q4_0.gguf',
      'sdxl-turbo.gguf',
      'sd3.5_large-Q4_0.gguf',
      'sd3-medium.gguf',
      'flux1-schnell-Q4_K_S.gguf',
      'flux-2-klein-4b-Q4_K_M.gguf',
      'unet-Q8_0.gguf',
      'ae_vae.gguf',
    ]) {
      expect([filename, isPictureModel({filename})]).toEqual([filename, true]);
    }
    expect(
      isPictureModel({
        filename: 'model.gguf',
        repo: 'city96/FLUX.1-schnell-gguf',
      }),
    ).toBe(true);
  });

  it('by the GGUF architecture when known', () => {
    expect(isPictureModel({filename: 'model.gguf', architecture: 'sd1'})).toBe(
      true,
    );
    expect(isPictureModel({filename: 'model.gguf', architecture: 'FLUX'})).toBe(
      true,
    );
    expect(
      isPictureModel({filename: 'model.gguf', architecture: 'llama'}),
    ).toBe(false);
  });

  it('leaves chat models alone', () => {
    for (const filename of [
      'Qwen3-4B-Q4_K_M.gguf',
      'gemma-2-2b-it-Q4_K_M.gguf',
      'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
      'SmolLM2-1.7B-Instruct-Q8_0.gguf',
      'Phi-3.5-mini-instruct-Q4_K_M.gguf',
      'mmproj-model-f16.gguf',
      'reflux-7b.Q4_0.gguf',
      'Mistral-7B-v0.3-sdpa.gguf',
      'gpt-oss-20b-MXFP4.gguf',
    ]) {
      expect([filename, isPictureModel({filename})]).toEqual([filename, false]);
    }
    expect(isPictureModel({})).toBe(false);
  });

  it('reads the hints from a model record', () => {
    expect(
      isPictureModel(
        modelPictureHints({
          filename: 'model-q4.gguf',
          hfModel: {id: 'x/y', specs: {gguf: {architecture: 'sdxl'}}},
        }),
      ),
    ).toBe(true);
    expect(
      modelPictureHints({
        filename: 'a.gguf',
        repo: 'r',
        ggufMetadata: {architecture: 'qwen3'},
      }),
    ).toEqual({
      filename: 'a.gguf',
      repo: 'r',
      architecture: 'qwen3',
      tags: undefined,
    });
    expect(
      isPictureModel(
        repoPictureHints({id: 'someone/model-GGUF', tags: ['text-to-image']}),
      ),
    ).toBe(true);
    expect(
      isPictureModel(
        repoPictureHints(
          {id: 'Qwen/Qwen3-4B-GGUF', tags: ['text-generation']},
          'Qwen3-4B-Q4_K_M.gguf',
        ),
      ),
    ).toBe(false);
  });
});

describe('which picture files the PC can run from one file', () => {
  it('Stable Diffusion 1.5 only, as a GGUF', () => {
    expect(
      isSd15SingleFile('stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf'),
    ).toBe(true);
    expect(isSd15SingleFile('sd-v1-5-Q8_0.gguf')).toBe(true);
    expect(isSd15SingleFile('sd15-q4.gguf')).toBe(true);
    expect(isSd15SingleFile('v1-5-pruned-emaonly-Q4_0.gguf')).toBe(true);
    for (const no of [
      'stable-diffusion-v1-5-pruned-emaonly.safetensors',
      'sd_xl_base_1.0-Q4_0.gguf',
      'sd3.5_large-Q4_0.gguf',
      'flux1-schnell-Q4_K_S.gguf',
      'sd15-unet-Q8_0.gguf',
      'sd15-vae.gguf',
      'stable-diffusion-2-1-Q4_0.gguf',
      'Qwen3-4B-Q4_K_M.gguf',
    ]) {
      expect([no, isSd15SingleFile(no)]).toEqual([no, false]);
    }
  });
});
