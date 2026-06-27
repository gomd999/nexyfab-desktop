/** suggestMates / mateSuggestionLabel — auto-mate proposals. Coverage-gap closure. */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { suggestMates, mateSuggestionLabel } from './mateSuggestionEngine';

describe('suggestMates', () => {
  it('returns an array of suggestions for two solids (no throw)', () => {
    const out = suggestMates(new THREE.BoxGeometry(20, 20, 20), new THREE.BoxGeometry(20, 20, 20));
    expect(Array.isArray(out)).toBe(true);
  });
  it('labels a suggestion when one is produced', () => {
    const out = suggestMates(new THREE.BoxGeometry(20, 20, 20), new THREE.BoxGeometry(20, 20, 20));
    if (out.length > 0) {
      expect(typeof mateSuggestionLabel(out[0], 'en')).toBe('string');
      expect(mateSuggestionLabel(out[0], 'en').length).toBeGreaterThan(0);
    }
  });
});
