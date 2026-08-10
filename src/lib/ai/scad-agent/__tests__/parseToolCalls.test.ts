import { describe, it, expect } from 'vitest';
import { parseToolCalls } from '../parseToolCalls';

describe('parseToolCalls', () => {
  it('extracts a single tool_call code-fenced block', () => {
    const text = 'Sure, let me render.\n\n```tool_call\n{"id":"c1","name":"render","args":{}}\n```\n\nDone.';
    const out = parseToolCalls(text);
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].name).toBe('render');
    expect(out.toolCalls[0].id).toBe('c1');
    expect(out.narration).toContain('Sure');
    expect(out.narration).toContain('Done');
    expect(out.narration).not.toContain('tool_call');
  });

  it('extracts multiple tool calls in order', () => {
    const text = `Step 1
\`\`\`tool_call
{"id":"a","name":"write_scad","args":{"code":"cube(10);"}}
\`\`\`
Step 2
\`\`\`tool_call
{"id":"b","name":"render","args":{}}
\`\`\``;
    const out = parseToolCalls(text);
    expect(out.toolCalls).toHaveLength(2);
    expect(out.toolCalls[0].name).toBe('write_scad');
    expect(out.toolCalls[1].name).toBe('render');
  });

  it('returns empty toolCalls when none present', () => {
    const out = parseToolCalls('Just a final message, no tools.');
    expect(out.toolCalls).toEqual([]);
    expect(out.narration).toContain('Just a final');
  });

  it('rejects unknown tool names', () => {
    const text = '```tool_call\n{"id":"c1","name":"hack_db","args":{}}\n```';
    const out = parseToolCalls(text);
    expect(out.toolCalls).toEqual([]);
  });

  it('tolerates ```json ... ``` blocks too', () => {
    const text = '```json\n{"name":"render","args":{}}\n```';
    const out = parseToolCalls(text);
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].name).toBe('render');
  });

  it('auto-assigns id when missing', () => {
    const text = '```tool_call\n{"name":"render","args":{}}\n```';
    const out = parseToolCalls(text);
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].id).toMatch(/^call_/);
  });

  it('drops malformed JSON blocks (does not throw)', () => {
    const text = '```tool_call\n{ not json }\n```\n\nfollow-up';
    const out = parseToolCalls(text);
    expect(out.toolCalls).toEqual([]);
    expect(out.narration).toContain('follow-up');
  });

  it('rejects oversized tool envelopes before they enter history', () => {
    const text = '```tool_call\n' + JSON.stringify({
      id: 'large', name: 'write_scad', args: { code: 'x'.repeat(111_000) },
    }) + '\n```';
    expect(parseToolCalls(text).toolCalls).toEqual([]);
  });

  it('rejects prototype keys and non-object args', () => {
    const poisoned = '```tool_call\n{"id":"p","name":"render","args":{"__proto__":{"polluted":true}}}\n```';
    expect(parseToolCalls(poisoned).toolCalls).toEqual([]);
    expect(parseToolCalls('```tool_call\n{"id":"a","name":"render","args":[]}\n```').toolCalls).toEqual([]);
  });

  it('caps tool batches to the execution budget ceiling', () => {
    const text = Array.from({ length: 40 }, (_, i) =>
      `\`\`\`tool_call\n{"id":"r${i}","name":"render","args":{}}\n\`\`\``).join('\n');
    expect(parseToolCalls(text).toolCalls).toHaveLength(30);
  });

  it('accepts precision tools that are present in the executor map', () => {
    const out = parseToolCalls('```tool_call\n{"id":"v1","name":"verify_spec","args":{}}\n```');
    expect(out.toolCalls[0]?.name).toBe('verify_spec');
  });
});
