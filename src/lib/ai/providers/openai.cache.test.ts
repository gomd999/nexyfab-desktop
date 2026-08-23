import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest } from '../types';
import { buildOpenAiChatBody } from './openai';

function request(userText: string, systemText = 'You are the stable NexyFab CAD planner.'): ChatCompletionRequest {
  return {
    task: 'cad-plan',
    messages: [
      { role: 'system', content: systemText },
      { role: 'user', content: userText },
    ],
    maxTokens: 1200,
    temperature: 0.7,
  };
}

describe('OpenAI explicit prompt caching', () => {
  it('uses the GPT-5.6 completion and explicit-cache request contract', () => {
    const stablePrefix = `Stable NexyFab CAD contract. ${'x'.repeat(4_100)}`;
    const body = buildOpenAiChatBody(request('Create a bracket.', stablePrefix), 'gpt-5.6-luna');

    expect(body).toMatchObject({
      model: 'gpt-5.6-luna',
      max_completion_tokens: 1200,
      prompt_cache_options: { mode: 'explicit', ttl: '30m' },
    });
    expect(body.prompt_cache_key).toMatch(/^nexyfab:cad-plan:gpt-5\.6-luna:/);
    expect(body.messages).toEqual([
      {
        role: 'system',
        content: [{ type: 'text', text: stablePrefix, prompt_cache_breakpoint: { type: 'default' } }],
      },
      { role: 'user', content: 'Create a bracket.' },
    ]);
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('temperature');
  });

  it('keeps the cache key stable across user inputs sharing the same prefix', () => {
    const prefix = `Stable contract ${'x'.repeat(4_100)}`;
    const first = buildOpenAiChatBody(request('Create a bracket.', prefix), 'gpt-5.6-terra');
    const second = buildOpenAiChatBody(request('Create a gearbox.', prefix), 'gpt-5.6-terra');
    const changed = buildOpenAiChatBody(
      request('Create a gearbox.', `A different system contract. ${'y'.repeat(4_100)}`),
      'gpt-5.6-terra',
    );

    expect(first.prompt_cache_key).toBe(second.prompt_cache_key);
    expect(changed.prompt_cache_key).not.toBe(first.prompt_cache_key);
  });

  it('uses provider implicit caching for a short GPT-5.6 prefix', () => {
    const body = buildOpenAiChatBody(request('Create a bracket.'), 'gpt-5.6-luna');
    expect(body).toMatchObject({ model: 'gpt-5.6-luna', max_completion_tokens: 1200 });
    expect(body).not.toHaveProperty('prompt_cache_key');
    expect(body).not.toHaveProperty('prompt_cache_options');
    expect(body.messages).toEqual(request('Create a bracket.').messages);
  });

  it('preserves the legacy chat-completions body for non-GPT-5.6 models', () => {
    const body = buildOpenAiChatBody(request('Create a bracket.'), 'gpt-4o-mini');

    expect(body).toMatchObject({ max_tokens: 1200, temperature: 0.7 });
    expect(body).not.toHaveProperty('prompt_cache_key');
    expect(body).not.toHaveProperty('prompt_cache_options');
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  it('forwards a strict JSON Schema through response_format', () => {
    const schema = {
      name: 'cad_plan',
      strict: true as const,
      schema: {
        type: 'object',
        properties: { length: { type: 'number' } },
        required: ['length'],
        additionalProperties: false,
      },
    };
    const body = buildOpenAiChatBody({ ...request('Create a bracket.'), jsonSchema: schema }, 'gpt-4o-mini');

    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: schema });
  });
});
