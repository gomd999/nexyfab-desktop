import { describe, expect, it } from 'vitest';
import {
  MECHANICAL_CORE_30_FEATURES,
  MECHANICAL_CORE_AI_EDITABLE_FEATURES,
} from '@/lib/ai/mechanicalCoreFeatureContract';
import { FEATURE_MAP } from './index';
import { KNOWN_FEATURE_TYPES } from './featureParamSchema';

describe('mechanical core 30 runtime coverage', () => {
  it('binds every claimed feature to a buildable modeler execution path', () => {
    expect(MECHANICAL_CORE_30_FEATURES).toHaveLength(30);
    for (const feature of MECHANICAL_CORE_30_FEATURES) {
      expect(KNOWN_FEATURE_TYPES.has(feature), `${feature} missing from sanitizer/buildability contract`).toBe(true);
      expect(MECHANICAL_CORE_AI_EDITABLE_FEATURES.has(feature), `${feature} missing from revision-bound AI edit contract`).toBe(true);
      if (feature === 'sketchExtrude') continue;
      const definition = FEATURE_MAP[feature];
      expect(definition, `${feature} missing from FEATURE_MAP`).toBeDefined();
      expect(definition.type).toBe(feature);
      expect(typeof definition.apply).toBe('function');
      expect(new Set(definition.params.map(param => param.key)).size).toBe(definition.params.length);
      expect(definition.params.every(param => Number.isFinite(param.default))).toBe(true);
    }
  });

  it('keeps experimental modeler features outside the commercial 30 claim', () => {
    for (const experimental of [
      'boundarySurface', 'flatPattern', 'moldTools', 'nurbsSurface', 'weldment',
      'deleteFace', 'variableSectionSweep', 'multiSectionSweep',
    ]) {
      expect(MECHANICAL_CORE_AI_EDITABLE_FEATURES.has(experimental)).toBe(false);
    }
  });
});
