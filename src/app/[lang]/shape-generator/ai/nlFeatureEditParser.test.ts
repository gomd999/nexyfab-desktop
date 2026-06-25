/**
 * nlFeatureEditParser — deterministic NL → FeatureEditIntent.
 */
import { describe, it, expect } from 'vitest';
import { parseFeatureEditPrompt } from './nlFeatureEditParser';
import type { FeatureInstance } from '../features/types';
import type { FaceSelectionInfo, EdgeSelectionInfo } from '../editing/selectionInfo';

function feat(id: string, type: FeatureInstance['type']): FeatureInstance {
  return { id, type, params: {}, enabled: true } as FeatureInstance;
}

const FACE: FaceSelectionInfo = {
  type: 'face', normal: [0, 1, 0], position: [0, 10, 0], area: 100,
  triangleCount: 2, normalLabel: '+Y Top', triangleIndices: [0, 1],
};
const EDGE: EdgeSelectionInfo = {
  type: 'edge', position: [10, 0, 0], length: 20, normal: [0, 1, 0],
};

describe('parseFeatureEditPrompt', () => {
  it('adds a fillet with the given radius', () => {
    const r = parseFeatureEditPrompt('add a 5mm fillet', []);
    expect(r.intents).toEqual([{ kind: 'add_feature', featureType: 'fillet', params: { radius: 5 } }]);
  });

  it('adds a chamfer (distance) and a hole (diameter) with their primary params', () => {
    expect(parseFeatureEditPrompt('put a 2mm chamfer on it', []).intents)
      .toEqual([{ kind: 'add_feature', featureType: 'chamfer', params: { distance: 2 } }]);
    expect(parseFeatureEditPrompt('drill a 10mm hole', []).intents)
      .toEqual([{ kind: 'add_feature', featureType: 'hole', params: { diameter: 10 } }]);
  });

  it('adds with default size when no number is given', () => {
    const r = parseFeatureEditPrompt('add a fillet', []);
    expect(r.intents).toEqual([{ kind: 'add_feature', featureType: 'fillet', params: {} }]);
    expect(r.explanation).toMatch(/default size/);
  });

  it('removes the last feature', () => {
    const r = parseFeatureEditPrompt('remove the last feature', [feat('f1', 'fillet'), feat('h1', 'hole')]);
    expect(r.intents).toEqual([{ kind: 'remove_feature', featureId: 'h1' }]);
  });

  it('clears all features', () => {
    const r = parseFeatureEditPrompt('clear all', [feat('f1', 'fillet')]);
    expect(r.intents).toEqual([{ kind: 'clear_all' }]);
  });

  it('suppresses and enables the last feature', () => {
    const fs = [feat('f1', 'fillet')];
    expect(parseFeatureEditPrompt('suppress the last feature', fs).intents)
      .toEqual([{ kind: 'toggle_feature', featureId: 'f1', enabled: false }]);
    expect(parseFeatureEditPrompt('enable it', fs).intents)
      .toEqual([{ kind: 'toggle_feature', featureId: 'f1', enabled: true }]);
  });

  it('UPDATES the last feature param rather than adding when an edit verb + keyword is present', () => {
    const r = parseFeatureEditPrompt('make the fillet 8mm', [feat('f1', 'fillet')]);
    // must NOT add a second fillet
    expect(r.intents).toEqual([{ kind: 'update_param', featureId: 'f1', paramKey: 'radius', value: 8 }]);
  });

  it('"make it 8mm" updates the last feature primary param', () => {
    expect(parseFeatureEditPrompt('make it 8mm', [feat('h1', 'hole')]).intents)
      .toEqual([{ kind: 'update_param', featureId: 'h1', paramKey: 'diameter', value: 8 }]);
  });

  it('understands common Korean commands', () => {
    expect(parseFeatureEditPrompt('5mm 필렛 추가', []).intents)
      .toEqual([{ kind: 'add_feature', featureType: 'fillet', params: { radius: 5 } }]);
    expect(parseFeatureEditPrompt('전체 삭제', [feat('f1', 'fillet')]).intents)
      .toEqual([{ kind: 'clear_all' }]);
  });

  it('adds a thread for "나사" without forcing a nonsensical numeric param', () => {
    // "50mm" is not a thread param (pitch/depth/angle) — must add with defaults,
    // not pitch:50. This is the command that previously failed to map.
    const r = parseFeatureEditPrompt('50mm 나사', []);
    expect(r.intents).toEqual([{ kind: 'add_feature', featureType: 'thread', params: {} }]);
  });

  it('adds a draft with its angle from the prompt', () => {
    expect(parseFeatureEditPrompt('add 3 degree draft', []).intents)
      .toEqual([{ kind: 'add_feature', featureType: 'draft', params: { angle: 3 } }]);
    expect(parseFeatureEditPrompt('구배 5도 넣어줘', []).intents)
      .toEqual([{ kind: 'add_feature', featureType: 'draft', params: { angle: 5 } }]);
  });

  describe('selection-based (face/edge) edits', () => {
    it('offsets the SELECTED face by the given distance', () => {
      const r = parseFeatureEditPrompt('offset 5mm', [], FACE);
      expect(r.intents).toEqual([
        { kind: 'add_feature_on_selection', featureType: 'offsetFace', params: { distance: 5 }, faceSelections: [FACE] },
      ]);
    });

    it('offsets the selected face — Korean "이 면 8mm 옵셋"', () => {
      const r = parseFeatureEditPrompt('이 면 8mm 옵셋', [], FACE);
      expect(r.intents).toEqual([
        { kind: 'add_feature_on_selection', featureType: 'offsetFace', params: { distance: 8 }, faceSelections: [FACE] },
      ]);
    });

    it('requires a face for offset — guides the user when nothing is selected', () => {
      const r = parseFeatureEditPrompt('offset 5mm', [], null);
      expect(r.intents).toEqual([]);
      expect(r.explanation).toMatch(/select a face first/i);
    });

    it('tolerates a space in "off set" (user phrasing)', () => {
      const r = parseFeatureEditPrompt('off set 4mm', [], FACE);
      expect(r.intents).toEqual([
        { kind: 'add_feature_on_selection', featureType: 'offsetFace', params: { distance: 4 }, faceSelections: [FACE] },
      ]);
    });

    it('deletes the selected face', () => {
      const r = parseFeatureEditPrompt('delete face', [], FACE);
      expect(r.intents).toEqual([
        { kind: 'add_feature_on_selection', featureType: 'deleteFace', params: {}, faceSelections: [FACE] },
      ]);
    });

    it('drafts the selected face (attaches it) when one is selected', () => {
      const r = parseFeatureEditPrompt('draft 3 degrees', [], FACE);
      expect(r.intents).toEqual([
        { kind: 'add_feature_on_selection', featureType: 'draft', params: { angle: 3 }, faceSelections: [FACE] },
      ]);
    });

    it('fillets the SELECTED edge instead of all edges', () => {
      const r = parseFeatureEditPrompt('fillet 2mm', [], EDGE);
      expect(r.intents).toEqual([
        { kind: 'add_feature_on_selection', featureType: 'fillet', params: { radius: 2 }, edgeSelections: [EDGE] },
      ]);
    });

    it('falls back to all-edges fillet when nothing is selected', () => {
      const r = parseFeatureEditPrompt('fillet 2mm', [], null);
      expect(r.intents).toEqual([{ kind: 'add_feature', featureType: 'fillet', params: { radius: 2 } }]);
    });
  });

  it('returns guidance (no intents) for an unrecognised prompt', () => {
    const r = parseFeatureEditPrompt('do something amazing', []);
    expect(r.intents).toEqual([]);
    expect(r.explanation).toMatch(/Try:/);
  });

  it('returns guidance for an empty prompt', () => {
    expect(parseFeatureEditPrompt('   ', []).intents).toEqual([]);
  });

  it('handles remove when there is nothing to remove', () => {
    const r = parseFeatureEditPrompt('remove the last feature', []);
    expect(r.intents).toEqual([]);
    expect(r.explanation).toMatch(/no features/i);
  });
});
