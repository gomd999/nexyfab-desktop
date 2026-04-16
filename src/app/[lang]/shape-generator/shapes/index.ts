import * as THREE from 'three';

// ─── Shape system types ───────────────────────────────────────────────────────

export interface ShapeParam {
  key: string;
  labelKey: string;       // key in shapeDict
  default: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  optional?: boolean;
}

/** A text-formula parameter (not a number slider) */
export interface ShapeFormulaField {
  key: string;         // identifies the formula (e.g. 'zFormula')
  labelKey: string;    // key in shapeDict for the label
  default: string;     // default formula string
  placeholder?: string;
  hint?: string;       // one-line help shown below the input
}

export interface ShapeResult {
  geometry: THREE.BufferGeometry;
  edgeGeometry: THREE.BufferGeometry;
  volume_cm3: number;
  surface_area_cm2: number;
  bbox: { w: number; h: number; d: number };
}

export interface ShapeConfig {
  id: string;
  tier: 1 | 2;
  icon: string;
  params: ShapeParam[];
  /** Optional formula (text) fields rendered as text inputs, passed to generate() */
  formulaFields?: ShapeFormulaField[];
  generate: (p: Record<string, number>, formulas?: Record<string, string>) => ShapeResult;
}

// ─── Helper: make EdgesGeometry ───────────────────────────────────────────────

export function makeEdges(geo: THREE.BufferGeometry, angle = 20): THREE.BufferGeometry {
  return new THREE.EdgesGeometry(geo, angle);
}

// ─── Helper: compute mesh volume from BufferGeometry (divergence theorem) ─────

export function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!pos) return 0;
  let vol = 0;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  for (let i = 0; i < triCount; i++) {
    const i0 = idx ? idx.getX(i * 3) : i * 3;
    const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
    vol += (ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by));
  }
  return Math.abs(vol / 6);
}

// ─── Helper: compute mesh surface area ────────────────────────────────────────

export function meshSurfaceArea(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!pos) return 0;
  let area = 0;
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  for (let i = 0; i < triCount; i++) {
    const i0 = idx ? idx.getX(i * 3) : i * 3;
    const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
    v0.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    v1.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    v2.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
    v1.sub(v0); v2.sub(v0);
    area += v1.cross(v2).length() * 0.5;
  }
  return area;
}

// ─── Shape registry (populated by imports) ────────────────────────────────────

import { boxShape } from './box';
import { boltShape } from './bolt';
import { springShape } from './spring';
import { tSlotShape } from './tSlot';
import { hexNutShape } from './hexNut';
import { washerShape } from './washer';
import { iBeamShape } from './iBeam';
import { bearingShape } from './bearing';
import { cylinderShape } from './cylinder';
import { pipeShape } from './pipe';
import { lBracketShape } from './lBracket';
import { flangeShape } from './flange';
import { plateBendShape } from './plateBend';
import { gearShape } from './gear';
import { fanBladeShape } from './fanBlade';
import { sprocketShape } from './sprocket';
import { pulleyShape } from './pulley';
import { sweepShape } from './sweep';
import { loftShape } from './loft';
import { sphereShape } from './sphere';
import { coneShape } from './cone';
import { torusShape } from './torus';
import { wedgeShape } from './wedge';
import { diskShape } from './disk';
import { ellipsoidShape } from './ellipsoid';
import { ellipticDiskShape } from './ellipticDisk';
import { functionSurfaceShape } from './functionSurface';
import { latheProfileShape } from './latheProfile';

export const SHAPES: ShapeConfig[] = [
  boxShape,
  cylinderShape,
  diskShape,
  ellipsoidShape,
  ellipticDiskShape,
  sphereShape,
  coneShape,
  torusShape,
  wedgeShape,
  pipeShape,
  lBracketShape,
  flangeShape,
  plateBendShape,
  gearShape,
  fanBladeShape,
  sprocketShape,
  pulleyShape,
  sweepShape,
  loftShape,
  boltShape,
  springShape,
  tSlotShape,
  hexNutShape,
  washerShape,
  iBeamShape,
  bearingShape,
  functionSurfaceShape,
  latheProfileShape,
];

export const SHAPE_MAP = Object.fromEntries(SHAPES.map(s => [s.id, s]));

// ─── Standalone utility: generate shape result from shapeId + params ──────────

export function buildShapeResult(
  shapeId: string,
  partParams: Record<string, number>,
  formulas?: Record<string, string>,
): ShapeResult | null {
  const shapeDef = SHAPE_MAP[shapeId];
  if (!shapeDef) return null;
  const p: Record<string, number> = {};
  shapeDef.params.forEach(sp => { p[sp.key] = sp.default; });
  Object.entries(partParams).forEach(([k, v]) => { if (typeof v === 'number' && k in p) p[k] = v; });
  shapeDef.params.forEach(sp => {
    if (p[sp.key] !== undefined) p[sp.key] = Math.max(sp.min, Math.min(sp.max, p[sp.key]));
  });
  try {
    return shapeDef.generate(p, formulas);
  } catch {
    return null;
  }
}
