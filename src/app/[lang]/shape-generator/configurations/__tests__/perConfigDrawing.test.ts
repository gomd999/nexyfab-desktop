/**
 * perConfigDrawing.test.ts — per-config drawing bridge regression.
 *
 * Verifies:
 *  - empty configs list → empty result + empty diagnostics
 *  - all configs resolve → every SVG present and non-empty
 *  - some configs resolve null → those map to null + diagnostics filled
 *  - resolveGeometry throws → caught into diagnostics
 *  - drawing pipeline throws → caught into diagnostics
 *  - titleBlock.partName is overridden per config (template not mutated)
 *  - drawingsByConfigId keys cover every input config (success or fail)
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateDrawingsForConfigs } from '../perConfigDrawing';
import type { DrawingConfig } from '../../analysis/autoDrawing';

function makeTemplate(): DrawingConfig {
  return {
    views: ['front'],
    scale: 1,
    paperSize: 'A4',
    orientation: 'landscape',
    showDimensions: false,
    showCenterlines: false,
    tolerance: { linear: '±0.1', angular: "±0°30'" },
    roughness: [],
    titleBlock: {
      partName: 'TEMPLATE_PART',
      material: 'Al6061',
      drawnBy: 'vitest',
      date: '2026-05-29',
      scale: '1:1',
      revision: 'A',
    },
  };
}

describe('generateDrawingsForConfigs — boundary cases', () => {
  it('empty configs returns empty maps', () => {
    const result = generateDrawingsForConfigs({
      configs: [],
      resolveGeometry: () => new THREE.BoxGeometry(1, 1, 1),
      drawingConfigTemplate: makeTemplate(),
    });
    expect(Object.keys(result.drawingsByConfigId)).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe('generateDrawingsForConfigs — happy path', () => {
  it('all configs with geometry → every SVG non-empty', () => {
    const configs = [
      { id: 'c1', name: 'Baseline' },
      { id: 'c2', name: 'Tall' },
      { id: 'c3', name: 'Wide' },
    ];
    const geomByConfig: Record<string, THREE.BufferGeometry> = {
      c1: new THREE.BoxGeometry(10, 10, 10),
      c2: new THREE.BoxGeometry(5, 30, 5),
      c3: new THREE.BoxGeometry(40, 5, 5),
    };

    const result = generateDrawingsForConfigs({
      configs,
      resolveGeometry: (id) => geomByConfig[id] ?? null,
      drawingConfigTemplate: makeTemplate(),
    });

    expect(result.diagnostics).toHaveLength(0);
    expect(Object.keys(result.drawingsByConfigId).sort()).toEqual(['c1', 'c2', 'c3']);
    for (const cfg of configs) {
      const svg = result.drawingsByConfigId[cfg.id];
      expect(svg).not.toBeNull();
      expect(typeof svg).toBe('string');
      expect((svg as string).length).toBeGreaterThan(0);
      expect(svg as string).toMatch(/^<\?xml/);
      expect(svg as string).toContain('</svg>');
    }
  });
});

describe('generateDrawingsForConfigs — partial null resolution', () => {
  it('configs returning null geometry land in diagnostics + map to null', () => {
    const configs = [
      { id: 'ok-1', name: 'Good A' },
      { id: 'bad-1', name: 'Bad A' },
      { id: 'ok-2', name: 'Good B' },
      { id: 'bad-2', name: 'Bad B' },
    ];

    const result = generateDrawingsForConfigs({
      configs,
      resolveGeometry: (id) =>
        id.startsWith('ok-') ? new THREE.BoxGeometry(2, 4, 6) : null,
      drawingConfigTemplate: makeTemplate(),
    });

    expect(result.drawingsByConfigId['ok-1']).not.toBeNull();
    expect(result.drawingsByConfigId['ok-2']).not.toBeNull();
    expect(result.drawingsByConfigId['bad-1']).toBeNull();
    expect(result.drawingsByConfigId['bad-2']).toBeNull();

    expect(result.diagnostics).toHaveLength(2);
    const badIds = result.diagnostics.map((d) => d.configId).sort();
    expect(badIds).toEqual(['bad-1', 'bad-2']);
    for (const d of result.diagnostics) {
      expect(d.reason).toMatch(/null/i);
    }
  });
});

describe('generateDrawingsForConfigs — resolveGeometry throws', () => {
  it('caught into diagnostics and config maps to null', () => {
    const configs = [
      { id: 'ok', name: 'Ok' },
      { id: 'throw', name: 'Throws' },
    ];

    const result = generateDrawingsForConfigs({
      configs,
      resolveGeometry: (id) => {
        if (id === 'throw') throw new Error('config validation failed');
        return new THREE.BoxGeometry(1, 2, 3);
      },
      drawingConfigTemplate: makeTemplate(),
    });

    expect(result.drawingsByConfigId['ok']).not.toBeNull();
    expect(result.drawingsByConfigId['throw']).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].configId).toBe('throw');
    expect(result.diagnostics[0].reason).toMatch(/config validation failed/);
    expect(result.diagnostics[0].reason).toMatch(/resolveGeometry/);
  });
});

describe('generateDrawingsForConfigs — drawing pipeline throws', () => {
  it('exception inside generateDrawing is caught into diagnostics', () => {
    // Force generateDrawing → projectGeometry → triCount math to throw
    // by handing back a geometry whose `index` property getter throws.
    // We poke a real BoxGeometry but replace its `attributes` getter so
    // `pos = geometry.attributes.position` blows up the moment
    // projectGeometry reads it. The bridge must catch this and surface
    // a diagnostic without losing sibling configs.
    const explodingGeom = new THREE.BoxGeometry(1, 1, 1);
    Object.defineProperty(explodingGeom, 'attributes', {
      get() {
        throw new Error('exploded attributes access');
      },
    });

    const configs = [
      { id: 'ok', name: 'Healthy' },
      { id: 'boom', name: 'Broken' },
    ];

    const result = generateDrawingsForConfigs({
      configs,
      resolveGeometry: (id) =>
        id === 'boom' ? explodingGeom : new THREE.BoxGeometry(3, 3, 3),
      drawingConfigTemplate: makeTemplate(),
    });

    expect(result.drawingsByConfigId['ok']).not.toBeNull();
    expect(result.drawingsByConfigId['boom']).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].configId).toBe('boom');
    expect(result.diagnostics[0].reason).toMatch(/drawing pipeline/);
    expect(result.diagnostics[0].reason).toMatch(/exploded attributes/);
  });
});

describe('generateDrawingsForConfigs — titleBlock override', () => {
  it('overrides titleBlock.partName per config + leaves template untouched', () => {
    const template = makeTemplate();
    const originalPartName = template.titleBlock.partName;

    const configs = [
      { id: 'a', name: 'Config Alpha' },
      { id: 'b', name: 'Config Beta' },
    ];

    const result = generateDrawingsForConfigs({
      configs,
      resolveGeometry: () => new THREE.BoxGeometry(5, 5, 5),
      drawingConfigTemplate: template,
    });

    // The SVG title block embeds partName as text content. Look for both
    // config names and confirm the placeholder template name is absent
    // (a real per-config override happened, not a template leak).
    const svgA = result.drawingsByConfigId['a'] as string;
    const svgB = result.drawingsByConfigId['b'] as string;
    expect(svgA).toContain('Config Alpha');
    expect(svgB).toContain('Config Beta');
    expect(svgA).not.toContain('TEMPLATE_PART');
    expect(svgB).not.toContain('TEMPLATE_PART');
    // The other config's name must not leak into this SVG.
    expect(svgA).not.toContain('Config Beta');
    expect(svgB).not.toContain('Config Alpha');

    // Template object must not have been mutated.
    expect(template.titleBlock.partName).toBe(originalPartName);
  });
});
