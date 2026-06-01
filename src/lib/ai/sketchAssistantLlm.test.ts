/**
 * sketchAssistantLlm — LLM wrapper tests (mocked chatFn).
 */
import { describe, it, expect } from 'vitest';
import { interpretSketchCommandLlm } from './sketchAssistantLlm';

describe('interpretSketchCommandLlm', () => {
  it('useStub:true bypasses LLM and uses rule-based stub', async () => {
    const r = await interpretSketchCommandLlm(
      { prompt: 'horizontal line', state: { lineIds: [] } },
      { useStub: true },
    );
    expect(r.matched).toBe(true);
    expect(r.suggestions[0]!.op.type).toBe('add_line');
  });

  it('LLM returns valid JSON array → parsed into Suggestion[]', async () => {
    const fake = async () => ({
      text: JSON.stringify([
        {
          op: { type: 'add_circle', center: { x: 5, y: 5 }, radius: 10 },
          confidence: 0.9,
          rationale: 'Add 10mm circle at (5,5)',
        },
      ]),
    });
    const r = await interpretSketchCommandLlm(
      { prompt: 'add circle radius 10', state: { lineIds: [] } },
      { chatFn: fake },
    );
    expect(r.matched).toBe(true);
    expect(r.suggestions.length).toBe(1);
    const op = r.suggestions[0]!.op;
    expect(op.type).toBe('add_circle');
    if (op.type === 'add_circle') expect(op.radius).toBe(10);
  });

  it('strips ```json fences before parsing', async () => {
    const fake = async () => ({
      text: '```json\n[{"op":{"type":"delete_last"},"confidence":1,"rationale":"undo"}]\n```',
    });
    const r = await interpretSketchCommandLlm(
      { prompt: 'undo', state: { lineIds: [] } },
      { chatFn: fake },
    );
    expect(r.matched).toBe(true);
    expect(r.suggestions[0]!.op.type).toBe('delete_last');
  });

  it('LLM returns invalid JSON → falls back to stub', async () => {
    const fake = async () => ({ text: 'sorry, I cannot' });
    const r = await interpretSketchCommandLlm(
      { prompt: 'horizontal line', state: { lineIds: [] } },
      { chatFn: fake },
    );
    // Stub matches "horizontal line" → returns at least one suggestion.
    expect(r.matched).toBe(true);
  });

  it('LLM throws → falls back to stub', async () => {
    const fake = async () => {
      throw new Error('provider down');
    };
    const r = await interpretSketchCommandLlm(
      { prompt: 'square 30', state: { lineIds: [] } },
      { chatFn: fake },
    );
    expect(r.matched).toBe(true);
    const rect = r.suggestions.find((s) => s.op.type === 'add_rect');
    expect(rect).toBeTruthy();
  });

  it('LLM returns non-array → falls back to stub', async () => {
    const fake = async () => ({ text: '{"op":{"type":"add_line"}}' });
    const r = await interpretSketchCommandLlm(
      { prompt: 'horizontal line', state: { lineIds: [] } },
      { chatFn: fake },
    );
    // Falls back to stub for "horizontal line".
    expect(r.matched).toBe(true);
  });

  it('drops items with unknown op types from the LLM response', async () => {
    const fake = async () => ({
      text: JSON.stringify([
        { op: { type: 'add_line', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }, confidence: 1, rationale: 'valid' },
        { op: { type: 'invalid_op', x: 5 }, confidence: 1, rationale: 'bad' },
      ]),
    });
    const r = await interpretSketchCommandLlm(
      { prompt: 'do a line and then a bad op', state: { lineIds: [] } },
      { chatFn: fake },
    );
    expect(r.suggestions.length).toBe(1);
    expect(r.suggestions[0]!.op.type).toBe('add_line');
  });

  it('default confidence 0.5 + empty rationale when LLM omits them', async () => {
    const fake = async () => ({
      text: JSON.stringify([{ op: { type: 'delete_last' } }]),
    });
    const r = await interpretSketchCommandLlm(
      { prompt: 'undo', state: { lineIds: [] } },
      { chatFn: fake },
    );
    expect(r.suggestions[0]!.confidence).toBe(0.5);
    expect(r.suggestions[0]!.rationale).toBe('');
  });
});
