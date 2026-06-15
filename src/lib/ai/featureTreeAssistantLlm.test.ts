/**
 * featureTreeAssistantLlm — LLM wrapper tests (mocked chatFn).
 */
import { describe, it, expect } from 'vitest';
import { interpretTreeCommandLlm } from './featureTreeAssistantLlm';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

function ex(id: string, name: string, depth = 5): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }],
    depth, direction: 'one_sided', mode: 'add',
  };
  return { id, name, dependencies: [], payload };
}

describe('interpretTreeCommandLlm', () => {
  it('useStub:true bypasses LLM', async () => {
    const tree: FeatureTree = { nodes: [ex('e1', 'Base')] };
    const r = await interpretTreeCommandLlm(
      { prompt: 'delete Base', tree },
      { useStub: true },
    );
    expect(r.matched).toBe(true);
    expect(r.suggestions[0]!.op.type).toBe('remove_node');
  });

  it('LLM JSON array parsed into Suggestion[]', async () => {
    const fake = async () => ({
      text: JSON.stringify([
        {
          op: { type: 'set_name', nodeId: 'e1', name: 'Plate' },
          confidence: 0.95,
          rationale: 'Rename Base → Plate',
        },
      ]),
    });
    const tree: FeatureTree = { nodes: [ex('e1', 'Base')] };
    const r = await interpretTreeCommandLlm(
      { prompt: 'rename Base to Plate', tree },
      { chatFn: fake },
    );
    expect(r.matched).toBe(true);
    expect(r.suggestions[0]!.op).toEqual({ type: 'set_name', nodeId: 'e1', name: 'Plate' });
  });

  it('strips ```json fences', async () => {
    const fake = async () => ({
      text: '```json\n[{"op":{"type":"remove_node","nodeId":"e1"},"confidence":1,"rationale":""}]\n```',
    });
    const tree: FeatureTree = { nodes: [ex('e1', 'X')] };
    const r = await interpretTreeCommandLlm({ prompt: 'delete X', tree }, { chatFn: fake });
    expect(r.suggestions[0]!.op.type).toBe('remove_node');
  });

  it('invalid JSON → fallback to stub', async () => {
    const fake = async () => ({ text: 'I cannot help with that' });
    const tree: FeatureTree = { nodes: [ex('e1', 'Base', 5)] };
    const r = await interpretTreeCommandLlm({ prompt: 'change depth to 12', tree }, { chatFn: fake });
    // Stub handles "change depth to 12" → matches.
    expect(r.matched).toBe(true);
    if (r.suggestions[0]!.op.type === 'set_payload') {
      const p = r.suggestions[0]!.op.payload as ExtrudeFeature;
      expect(p.depth).toBe(12);
    }
  });

  it('LLM throws → fallback', async () => {
    const fake = async () => { throw new Error('500'); };
    const tree: FeatureTree = { nodes: [ex('e1', 'Hole')] };
    const r = await interpretTreeCommandLlm({ prompt: 'suppress Hole', tree }, { chatFn: fake });
    expect(r.matched).toBe(true);
    expect(r.suggestions[0]!.op.type).toBe('set_suppressed');
  });

  it('drops items with unknown op types', async () => {
    const fake = async () => ({
      text: JSON.stringify([
        { op: { type: 'set_name', nodeId: 'e1', name: 'Q' }, confidence: 1, rationale: '' },
        { op: { type: 'nuke_universe' }, confidence: 1, rationale: '' },
      ]),
    });
    const tree: FeatureTree = { nodes: [ex('e1', 'X')] };
    const r = await interpretTreeCommandLlm({ prompt: 'something', tree }, { chatFn: fake });
    expect(r.suggestions.length).toBe(1);
    expect(r.suggestions[0]!.op.type).toBe('set_name');
  });

  it('default confidence + rationale when omitted', async () => {
    const fake = async () => ({
      text: JSON.stringify([{ op: { type: 'set_suppressed', nodeId: 'e1', suppressed: true } }]),
    });
    const tree: FeatureTree = { nodes: [ex('e1', 'X')] };
    const r = await interpretTreeCommandLlm({ prompt: '', tree }, { chatFn: fake });
    expect(r.suggestions[0]!.confidence).toBe(0.5);
    expect(r.suggestions[0]!.rationale).toBe('');
  });
});
