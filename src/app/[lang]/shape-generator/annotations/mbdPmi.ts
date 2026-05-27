/**
 * mbdPmi.ts — Model-Based Definition (MBD) / Product Manufacturing
 * Information (PMI) on 3D faces.
 *
 * MBD means *the 3D model is the master*. Instead of producing a 2D
 * drawing, the GD&T + dimensions + notes attach directly to the
 * geometry, queryable by downstream tools (CMM, inspection, ERP).
 *
 * This module wires the user-visible PMI markup to persistent
 * topology hashes from `triangleToTopoMap.ts` (Phase 2B). When the
 * pipeline re-runs and triangle indices shuffle, the PMI follows the
 * topology hashes — never the indices.
 *
 * PMI types:
 *   - **Dimension** — linear, angular, radial (distance between two
 *     features).
 *   - **Geometric tolerance** — flatness, position, profile, etc.
 *     (links to a feature + datum reference frame).
 *   - **Surface finish** — Ra/Rz callout on a face.
 *   - **Note** — free text / drawing leader (attached to a face or
 *     edge point).
 *   - **Datum target** — the small flag used to define datum locations.
 */

import type { DatumReferenceFrame } from '../tolerance/datumReferenceFrame';
import type { GdtCallout } from '../quality/inspectionPlan';

export type PmiKind = 'dimension' | 'geometric-tol' | 'surface-finish' | 'note' | 'datum-target';

export interface PmiBase {
  id: string;
  kind: PmiKind;
  /** Topology hash(es) of the face(s) the PMI attaches to. */
  topoHashes: string[];
  /** Optional anchor position for the leader (mm, model coords). */
  anchorPosition?: [number, number, number];
  /** Display label / text. */
  label: string;
  /** Color override for the markup. */
  color?: string;
}

export interface PmiDimension extends PmiBase {
  kind: 'dimension';
  dimensionType: 'linear' | 'angular' | 'radial' | 'diameter';
  /** Nominal value. */
  valueMm: number;
  /** ±tol or +/-. */
  toleranceUpperMm?: number;
  toleranceLowerMm?: number;
  /** Optional tolerance grade for batched fits (e.g. h7). */
  toleranceGrade?: string;
}

export interface PmiGeometricTol extends PmiBase {
  kind: 'geometric-tol';
  callout: GdtCallout;
  toleranceMm: number;
  /** Datum references (labels A, B, C). */
  datumRefs?: string[];
  /** Optional material condition modifier. */
  materialCondition?: 'MMC' | 'LMC' | 'RFS';
  /** Reference to the resolved DRF (when datums are bound to features). */
  drfRef?: string;
}

export interface PmiSurfaceFinish extends PmiBase {
  kind: 'surface-finish';
  /** Required Ra (μm). */
  raMaxUm: number;
  /** Optional secondary parameter. */
  rzMaxUm?: number;
  /** Lay direction symbol per ISO 1302. */
  lay?: '=' | 'X' | 'M' | 'C' | 'R' | 'P';
}

export interface PmiNote extends PmiBase {
  kind: 'note';
  text: string;
}

export interface PmiDatumTarget extends PmiBase {
  kind: 'datum-target';
  datumLabel: string;
  /** "Movable" target uses a circle; "static" uses an X. */
  targetType: 'point' | 'line' | 'area';
}

export type PmiAnnotation =
  | PmiDimension
  | PmiGeometricTol
  | PmiSurfaceFinish
  | PmiNote
  | PmiDatumTarget;

// ── Storage ──────────────────────────────────────────────────────

/** Per-part collection of PMI. */
export class PmiCollection {
  private items = new Map<string, PmiAnnotation>();

  add(pmi: PmiAnnotation): void {
    this.items.set(pmi.id, pmi);
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  get(id: string): PmiAnnotation | undefined {
    return this.items.get(id);
  }

  list(): PmiAnnotation[] {
    return Array.from(this.items.values());
  }

  /** All PMI attached to a specific topology hash. */
  forTopoHash(hash: string): PmiAnnotation[] {
    return this.list().filter(p => p.topoHashes.includes(hash));
  }

  /** All PMI of a given kind. */
  byKind(kind: PmiKind): PmiAnnotation[] {
    return this.list().filter(p => p.kind === kind);
  }

  /** Serialise — JSON-safe. */
  toJSON(): PmiAnnotation[] {
    return this.list();
  }

  static fromJSON(items: PmiAnnotation[]): PmiCollection {
    const c = new PmiCollection();
    for (const i of items) c.add(i);
    return c;
  }

  /** Recovery: when topology hashes change (after a parameter edit),
   *  reassign PMI to new hashes using the provided rename map. */
  remapHashes(renameMap: Map<string, string>): number {
    let renamed = 0;
    for (const pmi of this.items.values()) {
      let changed = false;
      for (let i = 0; i < pmi.topoHashes.length; i++) {
        const newHash = renameMap.get(pmi.topoHashes[i]!);
        if (newHash) {
          pmi.topoHashes[i] = newHash;
          changed = true;
        }
      }
      if (changed) renamed++;
    }
    return renamed;
  }
}

// ── Auto-extraction (PMI → inspection plan) ──────────────────────

import type { GdtSpec, DrawingFeature, FeatureType } from '../quality/inspectionPlan';

/** Map PMI's topology hash to a drawing feature (caller-supplied).
 *  This is the bridge that lets CMM software consume the MBD. */
export interface FeatureBinding {
  topoHash: string;
  feature: DrawingFeature;
}

export interface PmiToInspectionResult {
  features: DrawingFeature[];
  specs: GdtSpec[];
  /** Topology hashes that had PMI but no feature binding. */
  unresolvedHashes: string[];
}

export function pmiToInspectionInputs(
  pmi: PmiCollection,
  bindings: FeatureBinding[],
): PmiToInspectionResult {
  const hashToFeature = new Map(bindings.map(b => [b.topoHash, b.feature]));
  const features: DrawingFeature[] = bindings.map(b => b.feature);
  const specs: GdtSpec[] = [];
  const unresolved: string[] = [];

  for (const annot of pmi.byKind('geometric-tol')) {
    const gt = annot as PmiGeometricTol;
    let featureFound: DrawingFeature | undefined;
    for (const h of gt.topoHashes) {
      const f = hashToFeature.get(h);
      if (f) { featureFound = f; break; }
    }
    if (!featureFound) {
      unresolved.push(gt.topoHashes[0] ?? '');
      continue;
    }
    specs.push({
      id: gt.id,
      featureId: featureFound.id,
      callout: gt.callout,
      toleranceMm: gt.toleranceMm,
      datumRefs: gt.datumRefs,
    });
  }

  return { features, specs, unresolvedHashes: unresolved };
}

// ── Helpers ──────────────────────────────────────────────────────

/** Create a position PMI shorthand. */
export function makePositionPmi(
  id: string,
  topoHash: string,
  toleranceMm: number,
  datumRefs: string[] = [],
  materialCondition: 'MMC' | 'LMC' | 'RFS' = 'RFS',
): PmiGeometricTol {
  return {
    id,
    kind: 'geometric-tol',
    topoHashes: [topoHash],
    label: `⌖ ⌀${toleranceMm} ${materialCondition === 'RFS' ? '' : materialCondition} ${datumRefs.join(' ')}`.trim(),
    callout: 'position',
    toleranceMm,
    datumRefs,
    materialCondition,
  };
}

/** Surface finish callout shorthand. */
export function makeSurfaceFinishPmi(
  id: string,
  topoHash: string,
  raMaxUm: number,
): PmiSurfaceFinish {
  return {
    id,
    kind: 'surface-finish',
    topoHashes: [topoHash],
    label: `Ra ${raMaxUm}μm`,
    raMaxUm,
  };
}

/** Resolve a DRF reference — bind PMI's drfRef to an actual DRF
 *  instance (one per part). */
export function resolveDrfRef(pmi: PmiGeometricTol, drfs: Map<string, DatumReferenceFrame>): DatumReferenceFrame | null {
  if (!pmi.drfRef) return null;
  return drfs.get(pmi.drfRef) ?? null;
}

/** Validation summary. */
export interface PmiValidationReport {
  totalAnnotations: number;
  unresolvedTopoHashes: number;
  missingDatumRefs: string[];
  /** Annotations referencing topology hashes the renderer has never seen. */
  orphaned: string[];
}

/** Caller passes the current set of valid topology hashes; we report
 *  any PMI that points to a missing face. */
export function validatePmi(
  pmi: PmiCollection,
  validTopoHashes: Set<string>,
  availableDatums: Set<string>,
): PmiValidationReport {
  const orphaned: string[] = [];
  const missingDatums = new Set<string>();
  for (const annot of pmi.list()) {
    if (!annot.topoHashes.some(h => validTopoHashes.has(h))) {
      orphaned.push(annot.id);
    }
    if (annot.kind === 'geometric-tol') {
      const gt = annot as PmiGeometricTol;
      for (const d of gt.datumRefs ?? []) {
        if (!availableDatums.has(d)) missingDatums.add(d);
      }
    }
  }
  // Keep the FeatureType import live (used in JSDoc-style ref above).
  const _featureTypeRef = null as unknown as FeatureType | null;
  void _featureTypeRef;
  return {
    totalAnnotations: pmi.list().length,
    unresolvedTopoHashes: orphaned.length,
    missingDatumRefs: Array.from(missingDatums),
    orphaned,
  };
}
