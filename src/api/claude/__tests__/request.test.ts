import {buildClaudeRequest} from '../engine';

const msgs = [{role: 'user', content: 'Hi'}];
const build = (model: string, params: any = {}, maxOutput?: number) =>
  buildClaudeRequest(params, msgs, model, new Map(), maxOutput);

describe('buildClaudeRequest', () => {
  it('Opus 5.5: summarized thinking, drop_block, fallbacks, effort', () => {
    const {body, betas} = build('claude-opus-5-5', {
      reasoning: {enabled: true, effort: 'high'},
      temperature: 0.7,
      top_p: 0.9,
      stop: ['<|im_end|>'],
    });
    expect(body.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
      block_binding: {prefix_mismatch_behavior: 'drop_block'},
    });
    expect(body.output_config).toEqual({effort: 'high'});
    expect(body.fallbacks).toBe('default');
    expect(betas).toEqual([
      'thinking-binding-controls-2026-08-01',
      'server-side-fallback-2026-07-01',
    ]);
    // No sampling settings or local stop words.
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('stop_sequences');
    expect(body.max_tokens).toBe(32000);
  });

  it('Opus 5.5 with thinking off: stays on (required), low effort, hidden', () => {
    const {body} = build('claude-opus-5-5', {reasoning: {enabled: false}});
    expect(body.thinking).toEqual({
      type: 'adaptive',
      block_binding: {prefix_mismatch_behavior: 'drop_block'},
    });
    expect(body.output_config).toEqual({effort: 'low'});
  });

  it('Sonnet 5.5 off: between_tools, effort capped at high, no fallbacks', () => {
    const {body, betas, keepThinking} = build('claude-sonnet-5-5', {
      reasoning: {enabled: false, effort: 'max'},
    });
    expect(body.thinking).toEqual({type: 'between_tools'});
    expect(body.output_config).toEqual({effort: 'high'});
    expect(body).not.toHaveProperty('fallbacks');
    expect(betas).toEqual([]);
    expect(keepThinking).toBe(false);
  });

  it('Opus 4.8 off: disabled; no binding or fallbacks', () => {
    const {body, betas} = build('claude-opus-4-8', {
      reasoning: {enabled: false},
    });
    expect(body.thinking).toEqual({type: 'disabled'});
    expect(betas).toEqual([]);
  });

  it("maps efforts to the model's levels", () => {
    expect(
      build('claude-opus-4-6', {reasoning: {enabled: true, effort: 'xhigh'}})
        .body.output_config,
    ).toEqual({effort: 'max'});
    expect(
      build('claude-opus-4-8', {reasoning: {enabled: true, effort: 'minimal'}})
        .body.output_config,
    ).toEqual({effort: 'low'});
  });

  it('older models get no thinking or effort', () => {
    const {body, betas} = build('claude-haiku-4-5', {
      reasoning: {enabled: true, effort: 'high'},
    });
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('output_config');
    expect(betas).toEqual([]);
  });

  it("respects the model's output cap and the app's n_predict", () => {
    expect(build('claude-haiku-4-5', {}, 8192).body.max_tokens).toBe(8192);
    expect(build('claude-opus-5-5', {n_predict: 500}).body.max_tokens).toBe(
      500,
    );
  });

  it('passes tools and JSON output', () => {
    const {body} = build('claude-opus-5-5', {
      tools: [{type: 'function', function: {name: 'memory_get'}}],
      tool_choice: 'required',
      response_format: {
        type: 'json_schema',
        json_schema: {schema: {type: 'object'}},
      },
    });
    expect(body.tools).toEqual([
      {name: 'memory_get', description: '', input_schema: {type: 'object'}},
    ]);
    expect(body.tool_choice).toEqual({type: 'auto'});
    expect(body.output_config.format).toEqual({
      type: 'json_schema',
      schema: {type: 'object'},
    });
  });
});
