/**
 * nlFeatureEditParser — deterministic NL → FeatureEditIntent.
 */
import { describe, it, expect } from 'vitest';
import { parseFeatureEditPrompt } from './nlFeatureEditParser';
import type { FeatureInstance } from '../features/types';

function feat(id: string, type: FeatureInstance['type']): FeatureInstance {
  return { id, type, params: {}, enabled: true } as FeatureInstance;
}

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
