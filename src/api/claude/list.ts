import {claudeClient, readableError} from './client';

/** Claude models this key can use, from Anthropic's Models API. */
export async function listClaudeModels(
  apiKey: string | undefined,
  timeoutMs?: number,
) {
  const client = claudeClient(apiKey, timeoutMs);
  const rows: any[] = [];
  try {
    for await (const m of client.models.list({limit: 100}) as any) {
      rows.push({
        id: m.id,
        object: 'model',
        owned_by: 'anthropic',
        // Every current Claude model reads images.
        architecture: {input_modalities: ['text', 'image']},
        meta: {
          ...(typeof m.max_input_tokens === 'number'
            ? {n_ctx: m.max_input_tokens}
            : {}),
          display_name: m.display_name,
        },
      });
    }
  } catch (error) {
    throw readableError(error);
  }
  return rows;
}
