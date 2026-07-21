/**
 * advancedSweepFeatures.ts — user-facing FeatureDefinition wrappers around the
 * already-implemented advanced sweeps:
 *
 *   - `variableSectionSweepFeature` → `sweepVariableSection()` (a profile that
 *     morphs — radius / side-count / twist — continuously along the spine).
 *   - `multiSectionSweepFeature`    → `lofted()` (interpolate between discrete
 *     sections along a spine, optionally PULLED by a guide rail).
 *
 * Both cores take rich structured inputs (spine samples, profile functions,
 * section lists, guide polylines). These wrappers synthesise those structures
 * deterministically from the flat numeric `params` the modeler UI supplies, and
 * return a THREE.BufferGeometry the same way `sweep.ts` / `loft.ts` do (vertex
 * arrays → BufferGeometry, normals computed). Invalid inputs throw (never a
 * silent degenerate solid), matching the modeler's "no silently wrong geometry"
 * policy.
 */

import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import {
  sweepVariableSection,
  type ProfileFunction,
  type Point2D,
  type SpinePathSample,
} from './variableSectionSweep';
import {
  lofted,
  type SectionProfile,
  type SweepSpine,
  type GuideCurve,
} from './multiSectionSweep';

// ── Shared helpers ──────────────────────────────────────────────

function num(v: number | undefined, fallback: number): number {
  return Number.isFinite(v) ? (v as number) : fallback;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function toGeometry(positions: Float32Array, indices: Uint32Array): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

// ── Variable-section sweep ──────────────────────────────────────

interface VarSweepParams {
  pathType: number;
  length: number;
  arcRadius: number;
  arcAngleDeg: number;
  startRadius: number;
  endRadius: number;
  startSides: number;
  endSides: number;
  twistDeg: number;
  stations: number;
}

function sanitizeVar(params: Record<string, number>): VarSweepParams {
  return {
    pathType: Math.round(clamp(num(params.pathType, 0), 0, 1)),
    length: clamp(num(params.length, 120), 10, 500),
    arcRadius: clamp(num(params.arcRadius, 80), 10, 300),
    arcAngleDeg: clamp(num(params.arcAngle, 90), 10, 270),
    startRadius: clamp(num(params.startRadius, 30), 1, 200),
    endRadius: clamp(num(params.endRadius, 12), 1, 200),
    startSides: Math.round(clamp(num(params.startSides, 4), 3, 24)),
    endSides: Math.round(clamp(num(params.endSides, 12), 3, 24)),
    twistDeg: clamp(num(params.twist, 0), 0, 360),
    stations: Math.round(clamp(num(params.stations, 48), 4, 256)),
  };
}

/** Analytic spine (position + unit tangent) for the straight / arc paths. */
function buildVarSpine(p: VarSweepParams): SpinePathSample[] {
  if (p.pathType === 1) {
    const arc = (p.arcAngleDeg / 180) * Math.PI;
    const steps = 96;
    const out: SpinePathSample[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = t * arc;
      out.push({
        t,
        position: { x: p.arcRadius * Math.sin(a), y: 0, z: p.arcRadius * (1 - Math.cos(a)) },
        tangent: { x: Math.cos(a), y: 0, z: Math.sin(a) },
      });
    }
    return out;
  }
  return [
    { t: 0, position: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 } },
    { t: 1, position: { x: 0, y: 0, z: p.length }, tangent: { x: 0, y: 0, z: 1 } },
  ];
}

export const variableSectionSweepFeature: FeatureDefinition = {
  type: 'variableSectionSweep',
  icon: '🫗',
  params: [
    {
      key: 'pathType', labelKey: 'paramSweepPath', default: 0, min: 0, max: 1, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'sweepPathStraight' },
        { value: 1, labelKey: 'sweepPathArc' },
      ],
    },
    { key: 'length', labelKey: 'paramSweepLength', default: 120, min: 10, max: 500, step: 5, unit: 'mm' },
    { key: 'arcRadius', labelKey: 'paramSweepArcRadius', default: 80, min: 10, max: 300, step: 5, unit: 'mm' },
    { key: 'arcAngle', labelKey: 'paramSweepArcAngle', default: 90, min: 10, max: 270, step: 5, unit: '°' },
    { key: 'startRadius', labelKey: 'paramVarSweepStartRadius', default: 30, min: 1, max: 200, step: 1, unit: 'mm' },
    { key: 'endRadius', labelKey: 'paramVarSweepEndRadius', default: 12, min: 1, max: 200, step: 1, unit: 'mm' },
    { key: 'startSides', labelKey: 'paramVarSweepStartSides', default: 4, min: 3, max: 24, step: 1, unit: '' },
    { key: 'endSides', labelKey: 'paramVarSweepEndSides', default: 12, min: 3, max: 24, step: 1, unit: '' },
    { key: 'twist', labelKey: 'paramLoftTwist', default: 0, min: 0, max: 360, step: 5, unit: '°' },
    { key: 'stations', labelKey: 'paramVarSweepStations', default: 48, min: 4, max: 256, step: 1, unit: '' },
  ],
  apply(_geometry, params) {
    const p = sanitizeVar(params);
    if (!(p.startRadius > 0) || !(p.endRadius > 0)) {
      throw new Error(
        `variableSectionSweep: section radii must be positive (start=${p.startRadius} mm, end=${p.endRadius} mm)`,
      );
    }
    const spine = buildVarSpine(p);
    const twistRad = (p.twistDeg / 180) * Math.PI;
    const profileFn: ProfileFunction = (s) => {
      const sides = Math.max(3, Math.round(p.startSides + (p.endSides - p.startSides) * s));
      const r = p.startRadius + (p.endRadius - p.startRadius) * s;
      const rot = twistRad * s;
      const pts: Point2D[] = [];
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 + rot;
        pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
      }
      return pts;
    };
    const mesh = sweepVariableSection(spine, profileFn, {
      stationCount: p.stations,
      profileResolution: 96,
      capEnds: true,
      frame: 'rmf',
    });
    return toGeometry(mesh.positions, mesh.indices);
  },
};

// ── Multi-section (lofted) sweep with guide rail ────────────────

interface MultiSweepParams {
  length: number;
  sides: number;
  startSize: number;
  midSize: number;
  endSize: number;
  guideMode: number;
  guideOffset: number;
  stations: number;
}

function sanitizeMulti(params: Record<string, number>): MultiSweepParams {
  return {
    length: clamp(num(params.length, 120), 10, 500),
    sides: Math.round(clamp(num(params.sides, 4), 3, 24)),
    startSize: clamp(num(params.startSize, 40), 1, 200),
    midSize: clamp(num(params.midSize, 20), 1, 200),
    endSize: clamp(num(params.endSize, 35), 1, 200),
    guideMode: Math.round(clamp(num(params.guideMode, 1), 0, 1)),
    guideOffset: clamp(num(params.guideOffset, 60), 0, 300),
    stations: Math.round(clamp(num(params.stations, 48), 4, 256)),
  };
}

/** Regular N-gon section of half-size `size` at spine parameter `spineParam`. */
function polygonSection(id: string, spineParam: number, sides: number, size: number): SectionProfile {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    pts.push({ x: size * Math.cos(a), y: size * Math.sin(a) });
  }
  return { id, spineParam, points2D: pts };
}

export const multiSectionSweepFeature: FeatureDefinition = {
  type: 'multiSectionSweep',
  icon: '🪈',
  params: [
    { key: 'length', labelKey: 'paramSweepLength', default: 120, min: 10, max: 500, step: 5, unit: 'mm' },
    { key: 'sides', labelKey: 'paramMultiSweepSides', default: 4, min: 3, max: 24, step: 1, unit: '' },
    { key: 'startSize', labelKey: 'paramMultiSweepStartSize', default: 40, min: 1, max: 200, step: 1, unit: 'mm' },
    { key: 'midSize', labelKey: 'paramMultiSweepMidSize', default: 20, min: 1, max: 200, step: 1, unit: 'mm' },
    { key: 'endSize', labelKey: 'paramMultiSweepEndSize', default: 35, min: 1, max: 200, step: 1, unit: 'mm' },
    {
      key: 'guideMode', labelKey: 'paramSweepGuideMode', default: 1, min: 0, max: 1, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'sweepGuideOff' },
        { value: 1, labelKey: 'sweepGuideLinearRail' },
      ],
    },
    { key: 'guideOffset', labelKey: 'paramMultiSweepGuideOffset', default: 60, min: 0, max: 300, step: 5, unit: 'mm' },
    { key: 'stations', labelKey: 'paramMultiSweepStations', default: 48, min: 4, max: 256, step: 1, unit: '' },
  ],
  apply(_geometry, params) {
    const p = sanitizeMulti(params);
    if (!(p.startSize > 0) || !(p.midSize > 0) || !(p.endSize > 0)) {
      throw new Error(
        `multiSectionSweep: section sizes must be positive (start=${p.startSize}, mid=${p.midSize}, end=${p.endSize} mm)`,
      );
    }
    const sections: SectionProfile[] = [
      polygonSection('s0', 0, p.sides, p.startSize),
      polygonSection('s1', 0.5, p.sides, p.midSize),
      polygonSection('s2', 1, p.sides, p.endSize),
    ];
    // Straight +Z spine of the requested length.
    const spine: SweepSpine = {
      samples: [
        { t: 0, position: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 } },
        { t: 1, position: { x: 0, y: 0, z: p.length }, tangent: { x: 0, y: 0, z: 1 } },
      ],
    };
    // Guide rail: shares the spine's Z so its offset is purely in-plane (+X),
    // growing 0 → guideOffset. lofted() pulls each section toward it.
    const guides: GuideCurve[] = [];
    if (p.guideMode === 1 && p.guideOffset > 0) {
      const steps = 12;
      const samples: Array<{ t: number; position: { x: number; y: number; z: number } }> = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        samples.push({ t, position: { x: p.guideOffset * t, y: 0, z: p.length * t } });
      }
      guides.push({ id: 'rail', samples });
    }
    const res = lofted(sections, spine, guides, {
      stationCount: p.stations,
      frame: 'rmf',
      interpolation: 'linear',
      capEnds: true,
    });
    if (res.positions.length === 0) {
      throw new Error(`multiSectionSweep produced no geometry: ${res.warnings.join('; ') || 'unknown reason'}`);
    }
    return toGeometry(res.positions, res.indices);
  },
};
