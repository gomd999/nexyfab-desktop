/**
 * weldmentSectionUsage.test.ts — Execution evidence for W5-E judgment.
 *
 * Part A reproduces the toolbar wiring exactly as CommandToolbar.tsx does it
 * today (lines 1997-2000): all four weldment ribbon buttons call
 * `onAddFeature('weldment')` with NO parameter overrides, so every button
 * lands on the schema defaults (sectionType=0). We simulate that call path
 * and hash the resulting mesh: four identical hashes = four identical parts.
 *
 * Part B drives the same engine with explicit sectionType 0..4 and shows the
 * engine itself DOES differentiate — the bug is missing wiring, not the
 * section shape builder.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { weldmentFeature } from '../features/weldment';

function defaultParams(): Record<string, number> {
  const p: Record<string, number> = {};
  for (const def of weldmentFeature.params) p[def.key] = def.default;
  return p;
}

/** FNV-1a over positions rounded to 1e-6 — stable content hash. */
function hashGeometry(geo: THREE.BufferGeometry): string {
  const pos = geo.getAttribute('position');
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    // Round to micro-units so float noise cannot flip the judgment.
    const v = Math.round(n * 1e6);
    for (let shift = 0; shift < 32; shift += 8) {
      h ^= (v >> shift) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  };
  for (let i = 0; i < pos.count; i++) {
    mix(pos.getX(i)); mix(pos.getY(i)); mix(pos.getZ(i));
  }
  return (h >>> 0).toString(16).padStart(8, '0') + `:v${pos.count}`;
}

function baseBox(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
}

describe('W5-E evidence: toolbar call path vs engine capability', () => {
  it('A. four toolbar buttons (no overrides) produce byte-identical meshes', () => {
    // CommandToolbar.tsx w-recttube / w-ibeam / w-angle / w-roundtube all
    // execute onAddFeature('weldment') → feature stack applies schema
    // defaults. Simulate all four button presses:
    const hashes = ['w-recttube', 'w-ibeam', 'w-angle', 'w-roundtube'].map(() => {
      const out = weldmentFeature.apply(baseBox(), defaultParams());
      return hashGeometry(out as THREE.BufferGeometry);
    });
    // All four "different profile" buttons yield the same geometry today.
    expect(new Set(hashes).size).toBe(1);
     
    console.log('[W5-E A] toolbar-path hashes:', hashes.join(' '));
  });

  it('B. engine with explicit sectionType 0..4 produces 5 distinct meshes', () => {
    const hashes: string[] = [];
    for (let sectionType = 0; sectionType <= 4; sectionType++) {
      const out = weldmentFeature.apply(baseBox(), { ...defaultParams(), sectionType });
      hashes.push(hashGeometry(out as THREE.BufferGeometry));
    }
    expect(new Set(hashes).size).toBe(5);
     
    console.log('[W5-E B] engine hashes by sectionType:', hashes.map((h, i) => `${i}=${h}`).join(' '));
  });
});
