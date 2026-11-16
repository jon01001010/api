/**
 * Picture models (Stable Diffusion, FLUX, …) also come as GGUF files on
 * Hugging Face, but they are not chat models: llama.cpp can't load them.
 * These checks keep them out of the chat model list's Load button and point
 * to Toolbox → Image models instead (desktop app).
 *
 * The GGUF's `general.architecture` decides when known (Hugging Face reports
 * it for a repo, the phone reads it from a downloaded file); otherwise the
 * file and repo names do.
 */

export const PICTURE_MODEL_LABEL =
  'Picture model — not for chat (Toolbox → Image models)';

export const PICTURE_MODEL_NO_LOAD =
  'This is a picture model, not a chat model, so it can\'t be loaded for chat. In the PC app, open Toolbox → Image models and choose "Use this file for pictures".';

/** `general.architecture` values of picture-model GGUFs. */
const PICTURE_ARCHITECTURES = new Set([
  'sd1',
  'sd2',
  'sdxl',
  'sd3',
  'flux',
  'flux2',
  'stable-diffusion',
  'unet',
  'aura',
  'hyvid',
  'ltxv',
  'wan',
  'hidream',
  'cosmos',
  'lumina2',
  'chroma',
  'qwen_image',
]);

/** Name parts that only picture models use (on lower-case text). */
const PICTURE_NAMES: RegExp[] = [
  /stable[-_ .]?diffusion/,
  /(^|[^a-z0-9])sd[-_ .]?v?(1[-_.]?5|15|2[-_.]?1|21|xl|3(\.5)?)([^a-z0-9]|$)/,
  /sdxl/,
  /(^|[^a-z0-9])v1[-_.]5[-_.]pruned/,
  /(^|[^a-z])flux([^a-z]|$)/,
  /(^|[^a-z0-9])(unet|vae)([^a-z]|$)/,
];

/** Stable Diffusion 1.5 (one file holds all of it: what the PC can run). */
const SD15_NAMES: RegExp[] = [
  /stable[-_ .]?diffusion[-_ .]?v?1[-_.]?5/,
  /(^|[^a-z0-9])sd[-_ .]?v?(1[-_.]?5|15)([^0-9]|$)/,
  /(^|[^a-z0-9])v1[-_.]5[-_.]pruned/,
];

export type PictureModelHints = {
  filename?: string | null;
  repo?: string | null;
  /** The GGUF's general.architecture, when known. */
  architecture?: string | null;
  /** Hugging Face's tags for the repo (e.g. "text-to-image"). */
  tags?: string[] | null;
};

const PICTURE_TAGS = new Set(['text-to-image', 'stable-diffusion']);

const text = (h: PictureModelHints) =>
  [h.repo, h.filename]
    .filter((s): s is string => typeof s === 'string')
    .join(' ')
    .toLowerCase();

export function isPictureArchitecture(arch?: string | null): boolean {
  return !!arch && PICTURE_ARCHITECTURES.has(arch.toLowerCase());
}

/** Is this GGUF a picture model rather than a chat model? */
export function isPictureModel(hints: PictureModelHints): boolean {
  if (isPictureArchitecture(hints.architecture)) {
    return true;
  }
  if ((hints.tags ?? []).some(tag => PICTURE_TAGS.has(tag.toLowerCase()))) {
    return true;
  }
  const t = text(hints);
  return t.length > 0 && PICTURE_NAMES.some(re => re.test(t));
}

/**
 * A picture-model file the PC can run on its own: Stable Diffusion 1.5 in
 * one GGUF (not SDXL, SD 2/3, FLUX, or a lone UNet or VAE part).
 */
export function isSd15SingleFile(name: string): boolean {
  const t = name.toLowerCase();
  if (!t.endsWith('.gguf')) {
    return false;
  }
  if (/(^|[^a-z0-9])(unet|vae)([^a-z]|$)|sdxl|[^a-z]xl[^a-z]|flux/.test(t)) {
    return false;
  }
  return SD15_NAMES.some(re => re.test(t));
}

/** The hints for a chat-list model record. */
export function modelPictureHints(model: {
  filename?: string;
  repo?: string;
  ggufMetadata?: {architecture?: string};
  hfModel?: {
    id?: string;
    tags?: string[];
    specs?: {gguf?: {architecture?: string}};
  };
}): PictureModelHints {
  return {
    filename: model.filename,
    repo: model.repo ?? model.hfModel?.id,
    architecture:
      model.ggufMetadata?.architecture ??
      model.hfModel?.specs?.gguf?.architecture,
    tags: model.hfModel?.tags,
  };
}

/** The hints for a Hugging Face repo (and one of its files). */
export function repoPictureHints(
  repo: {id: string; tags?: string[]; specs?: {gguf?: {architecture?: string}}},
  filename?: string,
): PictureModelHints {
  return {
    filename,
    repo: repo.id,
    architecture: repo.specs?.gguf?.architecture,
    tags: repo.tags,
  };
}
