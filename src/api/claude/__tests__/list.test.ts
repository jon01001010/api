const mockList = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = class extends APIError {};
    static PermissionDeniedError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    models = {list: mockList};
  }
  return {__esModule: true, default: Anthropic};
});

import {listClaudeModels} from '../list';
import {fetchModelsWithHeaders} from '../../openai';

describe('Claude model list', () => {
  beforeEach(() => {
    mockList.mockReturnValue(
      (async function* () {
        yield {
          id: 'claude-opus-5-5',
          display_name: 'Claude Opus 5.5',
          max_input_tokens: 1000000,
        };
        yield {id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5'};
      })(),
    );
  });

  it('lists the models the key can use, with vision and context', async () => {
    expect(await listClaudeModels('k')).toEqual([
      {
        id: 'claude-opus-5-5',
        object: 'model',
        owned_by: 'anthropic',
        architecture: {input_modalities: ['text', 'image']},
        meta: {n_ctx: 1000000, display_name: 'Claude Opus 5.5'},
      },
      {
        id: 'claude-haiku-4-5',
        object: 'model',
        owned_by: 'anthropic',
        architecture: {input_modalities: ['text', 'image']},
        meta: {display_name: 'Claude Haiku 4.5'},
      },
    ]);
  });

  it("is what the remote-model sheet gets for Anthropic's address", async () => {
    const {models} = await fetchModelsWithHeaders(
      'https://api.anthropic.com',
      'k',
    );
    expect(models.map(m => m.id)).toEqual([
      'claude-opus-5-5',
      'claude-haiku-4-5',
    ]);
  });
});
