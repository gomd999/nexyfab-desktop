/**
 * Phase 6 — sketch + feature tree AI assistant stubs.
 */
import { describe, it, expect } from 'vitest';
import { interpretSketchCommand } from './sketchAssistant';
import { interpretTreeCommand } from './featureTreeAssistant';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

function extrudeNode(id: string, name: string, depth = 5): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }],
    depth, direction: 'one_sided', mode: 'add',
  };
  return { id, name, dependencies: [], payload };
}

// ─── sketch assistant ────────────────────────────────────────────────────

describe('interpretSketchCommand', () => {
  it('horizontal line (EN): suggests add_line + constraint', () => {
    const r = interpretSketchCommand({
      prompt: 'Add a horizontal line',
      state: { lineIds: ['l1' as never], lastLineId: 'l1' as never },
    });
    expect(r.matched).toBe(true);
    expect(r.suggestions.some((s) => s.op.type === 'add_line')).toBe(true);
    expect(r.suggestions.some((s) => s.op.type === 'add_constraint_horizontal')).toBe(true);
  });

  it('horizontal line (KR): same suggestions', () => {
    const r = interpretSketchCommand({ prompt: '수평선', state: { lineIds: [] } });
    expect(r.matched).toBe(true);
    expect(r.suggestions[0]!.op.type).toBe('add_line');
  });

  it('square 30: suggests add_rect 30x30', () => {
    const r = interpretSketchCommand({ prompt: 'square 30', state: { lineIds: [] } });
    expect(r.matched).toBe(true);
    const rect = r.suggestions.find((s) => s.op.type === 'add_rect')!;
    if (rect.op.type === 'add_rect') {
      expect(rect.op.width).toBe(30);
      expect(rect.op.height).toBe(30);
    }
  });

  it('circle radius 20: suggests add_circle r=20', () => {
    const r = interpretSketchCommand({ prompt: 'circle radius 20', state: { lineIds: [] } });
    expect(r.matched).toBe(true);
    const c = r.suggestions.find((s) => s.op.type === 'add_circle')!;
    if (c.op.type === 'add_circle') expect(c.op.radius).toBe(20);
  });

  it('make parallel needs ≥2 lines', () => {
    const empty = interpretSketchCommand({ prompt: 'make parallel', state: { lineIds: [] } });
    expect(empty.matched).toBe(false);
    const ok = interpretSketchCommand({
      prompt: 'make parallel',
      state: { lineIds: ['l1' as never, 'l2' as never] },
    });
    expect(ok.matched).toBe(true);
    expect(ok.suggestions[0]!.op.type).toBe('add_constraint_parallel');
  });

  it('delete last: triggers delete_last op', () => {
    const r = interpretSketchCommand({ prompt: 'delete last', state: { lineIds: [] } });
    expect(r.matched).toBe(true);
    expect(r.suggestions[0]!.op.type).toBe('delete_last');
  });

  it('Korean delete: 마지막 삭제', () => {
    const r = interpretSketchCommand({ prompt: '마지막 삭제', state: { lineIds: [] } });
    expect(r.matched).toBe(true);
    expect(r.suggestions[0]!.op.type).toBe('delete_last');
  });

  it('unrecognized: matched=false', () => {
    const r = interpretSketchCommand({ prompt: 'do something weird', state: { lineIds: [] } });
    expect(r.matched).toBe(false);
  });
});

// ─── tree assistant ──────────────────────────────────────────────────────

describe('interpretTreeCommand', () => {
  it('change extrude depth (EN): suggests set_payload on the extrude node', () => {
    const tree: FeatureTree = { nodes: [extrudeNode('e1', 'Base', 5)] };
    const r = interpretTreeCommand({ prompt: 'Change extrude depth to 12', tree });
    expect(r.matched).toBe(true);
    const op = r.suggestions[0]!.op;
    expect(op.type).toBe('set_payload');
    if (op.type === 'set_payload') {
      const p = op.payload as ExtrudeFeature;
      expect(p.depth).toBe(12);
    }
  });

  it('change depth (KR): 두께 8로', () => {
    const tree: FeatureTree = { nodes: [extrudeNode('e1', 'Base', 5)] };
    const r = interpretTreeCommand({ prompt: '두께 8로 변경', tree });
    expect(r.matched).toBe(true);
    const op = r.suggestions[0]!.op;
    if (op.type === 'set_payload') {
      const p = op.payload as ExtrudeFeature;
      expect(p.depth).toBe(8);
    }
  });

  it('delete by name (EN)', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('e1', 'Base'), extrudeNode('e2', 'Hole')],
    };
    const r = interpretTreeCommand({ prompt: 'delete Hole', tree });
    expect(r.matched).toBe(true);
    expect(r.suggestions[0]!.op).toEqual({ type: 'remove_node', nodeId: 'e2' });
  });

  it('rename (EN): rename Base to Plate', () => {
    const tree: FeatureTree = { nodes: [extrudeNode('e1', 'Base')] };
    const r = interpretTreeCommand({ prompt: 'rename Base to Plate', tree });
    expect(r.matched).toBe(true);
    expect(r.suggestions[0]!.op).toEqual({ type: 'set_name', nodeId: 'e1', name: 'Plate' });
  });

  it('suppress hides node', () => {
    const tree: FeatureTree = { nodes: [extrudeNode('e1', 'Hole')] };
    const r = interpretTreeCommand({ prompt: 'suppress Hole', tree });
    expect(r.matched).toBe(true);
    expect(r.suggestions[0]!.op).toEqual({ type: 'set_suppressed', nodeId: 'e1', suppressed: true });
  });

  it('show all un-suppresses every suppressed node', () => {
    const a = extrudeNode('a', 'A');
    const b = { ...extrudeNode('b', 'B'), suppressed: true };
    const c = { ...extrudeNode('c', 'C'), suppressed: true };
    const tree: FeatureTree = { nodes: [a, b, c] };
    const r = interpretTreeCommand({ prompt: 'show all', tree });
    expect(r.matched).toBe(true);
    expect(r.suggestions.length).toBe(2); // b + c (a is already shown)
    for (const s of r.suggestions) {
      expect(s.op.type).toBe('set_suppressed');
    }
  });

  it('unrecognized: matched=false', () => {
    const tree: FeatureTree = { nodes: [] };
    const r = interpretTreeCommand({ prompt: 'do something random', tree });
    expect(r.matched).toBe(false);
  });
});
