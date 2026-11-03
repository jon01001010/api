import type {Pal} from '../types/pal';
import {LOOKIE_DEFAULT_MODEL} from './builtinPalModels';

/**
 * Legacy Lookie and Pip were persisted with random database IDs, not a built-in
 * identifier. Match their complete stock signatures rather than hiding by
 * display name alone. A renamed, customized, or onboarding-created assistant
 * must remain visible.
 *
 * This only affects the in-memory list: no database records, chats, or model
 * downloads are deleted.
 */
export const isStockSeededPal = (pal: Pal): boolean => {
  if (
    pal.type !== 'local' ||
    pal.source !== 'local' ||
    pal.isSystemPromptChanged ||
    pal.useAIPrompt ||
    (pal.originalSystemPrompt != null &&
      pal.originalSystemPrompt !== pal.systemPrompt) ||
    pal.thumbnail_url ||
    pal.promptGenerationModel ||
    pal.generatingPrompt ||
    pal.completionSettings ||
    pal.pact ||
    pal.greeting ||
    pal.palshub_id ||
    pal.creator_info ||
    pal.rawPalshubGenerationSettings ||
    (pal.categories?.length ?? 0) > 0 ||
    (pal.tags?.length ?? 0) > 0
  ) {
    return false;
  }

  const colorsAre = (first: string, second: string) =>
    pal.color?.length === 2 &&
    pal.color[0] === first &&
    pal.color[1] === second;

  if (pal.name === 'Lookie') {
    return (
      pal.description ===
        'Real-time video analysis assistant that provides concise descriptions of your camera feed.' &&
      pal.systemPrompt ===
        'You are Lookie, an AI assistant giving real-time, concise descriptions of a video feed. Use few words. If unsure, say so clearly.' &&
      colorsAre('#9E204F', '#F6E1EA') &&
      pal.defaultModel?.id === LOOKIE_DEFAULT_MODEL.id &&
      pal.capabilities?.video === true &&
      Object.keys(pal.capabilities).length === 1 &&
      Object.keys(pal.parameters ?? {}).length === 1 &&
      pal.parameters.captureInterval === '3000' &&
      pal.parameterSchema.length === 1 &&
      pal.parameterSchema[0].key === 'captureInterval' &&
      pal.parameterSchema[0].type === 'text' &&
      pal.parameterSchema[0].label === 'Capture Interval (ms)' &&
      pal.parameterSchema[0].required === false
    );
  }

  if (pal.name === 'Pip') {
    return (
      pal.description ===
        'A friendly general-purpose pal that runs entirely on your phone.' &&
      pal.systemPrompt ===
        'You are Pip, a friendly and helpful assistant who runs locally on the user’s phone. Keep replies concise and warm.' &&
      colorsAre('#0E0D0C', '#FAFAFA') &&
      pal.defaultModel == null &&
      Object.keys(pal.capabilities ?? {}).length === 0 &&
      Object.keys(pal.parameters ?? {}).length === 0 &&
      pal.parameterSchema.length === 0
    );
  }

  return false;
};
