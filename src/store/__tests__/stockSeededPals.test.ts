import type {Pal} from '../../types/pal';
import {isStockSeededPal} from '../stockSeededPals';

const base: Pal = {
  type: 'local',
  id: 'id',
  name: 'Pip',
  description: 'A friendly general-purpose pal that runs entirely on your phone.',
  systemPrompt:
    'You are Pip, a friendly and helpful assistant who runs locally on the user’s phone. Keep replies concise and warm.',
  isSystemPromptChanged: false,
  useAIPrompt: false,
  source: 'local',
  parameters: {},
  parameterSchema: [],
  capabilities: {},
  color: ['#0E0D0C', '#FAFAFA'],
};

describe('legacy stock assistant filtering', () => {
  it('matches an unmodified default Pip', () => {
    expect(isStockSeededPal(base)).toBe(true);
  });

  it('preserves custom or user-selected Pip assistants', () => {
    expect(isStockSeededPal({...base, systemPrompt: 'My prompt'})).toBe(false);
    expect(isStockSeededPal({...base, defaultModel: {id: 'picked'} as any})).toBe(false);
    expect(isStockSeededPal({...base, greeting: {text: 'Hello'}})).toBe(false);
    expect(isStockSeededPal({...base, name: 'My Pip'})).toBe(false);
    expect(isStockSeededPal({...base, source: 'palshub'})).toBe(false);
  });

  it('preserves lookalike custom video assistants', () => {
    expect(isStockSeededPal({...base, name: 'Lookie', capabilities: {video: true}})).toBe(false);
  });
});
