import { describe, expect, it } from 'vitest';
import { validateToolArguments } from './toolArgumentsValidator';

const schema = {
  type: 'object',
  required: ['kind', 'count', 'tags'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['box', 'bracket'], minLength: 3, maxLength: 8 },
    count: { type: 'integer', minimum: 1, maximum: 10 },
    tags: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
} as const;

describe('tool argument schema validator', () => {
  it('accepts supported object, required, enum, bounds, and items rules', () => {
    expect(validateToolArguments(schema, { kind: 'box', count: 2, tags: ['cad'] })).toEqual({ ok: true });
  });

  it('rejects missing, extra, wrong-type, enum, length, bound, and item violations', () => {
    const cases = [
      {},
      { kind: 'box', count: 2, tags: [], extra: true },
      { kind: 'sphere', count: 2, tags: [] },
      { kind: 'box', count: 0, tags: [] },
      { kind: 'box', count: 11, tags: [] },
      { kind: 'box', count: 2, tags: [3] },
      { kind: 'x', count: 2, tags: [] },
    ];
    for (const value of cases) expect(validateToolArguments(schema, value)).toEqual({ ok: false, error: { code: 'INVALID_TOOL_ARGUMENTS' } });
  });

  it('fails closed on malformed or unsupported schemas without exposing values', () => {
    expect(validateToolArguments({ type: 'object', properties: { value: { oneOf: [] } } }, { value: 'secret-value' })).toEqual({ ok: false, error: { code: 'INVALID_TOOL_SCHEMA' } });
    const result = validateToolArguments(schema, { kind: 'secret-api-key-value', count: 1, tags: [] });
    expect(JSON.stringify(result)).not.toContain('secret-api-key-value');
    expect(JSON.stringify(result)).not.toContain('INVALID_TOOL_ARGUMENTS:');
  });
});
