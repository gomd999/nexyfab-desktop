/**
 * assemblyDrawing.ts — Phase C1 (조립 도면 v1).
 *
 * Composes per-part drawings + a BOM into a single sheet. Built on top of
 * `autoDrawing.generateDrawing` for the per-part projection so the per-
 * part logic stays single-sourced.
 *
 * v1 scope (per CAD_COMMERCIAL_COMPLETION_ROADMAP.md §Phase C1):
 *   - Take {geometry, transform, label, qty} per part
 *   - Produce one DrawingResult that embeds each part's primary view +
 *     a BOM (parts list) row block in the title-block area
 *   - Composite fingerprint covers ALL parts + transforms (stale banner
 *     for assembly works the same way as per-part)
 *
 * What this v1 does NOT do (Phase C/D follow-ups):
 *   - Section views, detail views, exploded views (Phase C2+)
 *   - GD&T datum frame transfer between parts (Phase C2)
 *   - Multi-sheet output (Phase D)
 *   - Auto-balloon placement (Phase D)
 */

import * as THREE from 'three';
import {
  computeDrawingGeometryFingerprint,
  generateDrawing,
  type DrawingConfig,
  type DrawingResult,
  type ProjectionView,
} from './autoDrawing';

export interface AssemblyDrawingPart {
  /** Stable id used in BOM rows + fingerprint. */
  readonly id: string;
  /** User-visible label. Falls back to id. */
  readonly label?: string;
  /** Quantity in the assembly (default 1). */
  readonly qty?: number;
  /** Material (rendered in BOM). Defaults to titleBlock.material. */
  readonly material?: string;
  /** Mesh geometry. */
  readonly geometry: THREE.BufferGeometry;
  /** Optional 4x4 world transform for fingerprint purposes. */
  readonly transform?: THREE.Matrix4;
}

export interface AssemblyDrawingConfig extends DrawingConfig {
  /** Override the per-part projection view (defaults to ['iso']). */
  readonly perPartView?: ProjectionView;
}

export interface BomRow {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  readonly qty: number;
  readonly material: string;
  readonly partFingerprint: string;
}

export interface AssemblyDrawingResult extends DrawingResult {
  /** BOM rows ordered by stable part index. */
  readonly bom: readonly BomRow[];
  /** Per-part DrawingResults (same length / order as `bom`). */
  readonly perPart: readonly DrawingResult[];
  /** Composite fingerprint covering geometry + transforms + qty + label.
   *  Stable: identical assemblies produce identical strings. */
  readonly fingerprint: string;
}

/**
 * Single concise fingerprint covering each part's geometry, transform,
 * and BOM-affecting fields. Designed so the stale-banner check used by
 * `AutoDrawingPanel` for single parts works identically for assemblies.
 */
export function computeAssemblyFingerprint(parts: readonly AssemblyDrawingPart[]): string {
  const segments: string[] = [];
  for (const p of parts) {
    const geomFp = computeDrawingGeometryFingerprint(p.geometry);
    const transformFp = p.transform
      ? p.transform.elements.map((n) => n.toFixed(4)).join(',')
      : 'I';
    const qty = p.qty ?? 1;
    const mat = p.material ?? '';
    const label = p.label ?? p.id;
    segments.push(`${p.id}|${label}|${qty}|${mat}|${geomFp}|${transformFp}`);
  }
  return segments.join(';');
}

/**
 * Generate an assembly drawing. v1 lays out per-part views + appends a
 * BOM. Title block reused from the per-part config; BOM is supplemental
 * data on the result object (renderers add the rows below the title
 * block area).
 *
 * Empty parts list → throws (an empty assembly has no drawing).
 */
export function generateAssemblyDrawing(
  parts: readonly AssemblyDrawingPart[],
  config: AssemblyDrawingConfig,
): AssemblyDrawingResult {
  if (parts.length === 0) {
    throw new Error('generateAssemblyDrawing: parts list is empty');
  }

  const perPartView: ProjectionView = config.perPartView ?? 'iso';

  // Per-part drawings — single view each (the assembly sheet trades
  // multi-view richness for "you see every part on one page"). For
  // detailed per-part drawings the user opens the part separately.
  const perPart: DrawingResult[] = parts.map((p) => {
    const partConfig: DrawingConfig = {
      ...config,
      views: [perPartView],
      titleBlock: {
        ...config.titleBlock,
        partName: p.label ?? p.id,
        material: p.material ?? config.titleBlock.material,
      },
    };
    return generateDrawing(p.geometry, partConfig);
  });

  // BOM rows — one per part, indexed from 1 (per drafting convention).
  const bom: BomRow[] = parts.map((p, i) => ({
    index: i + 1,
    id: p.id,
    label: p.label ?? p.id,
    qty: p.qty ?? 1,
    material: p.material ?? config.titleBlock.material,
    partFingerprint: computeDrawingGeometryFingerprint(p.geometry),
  }));

  // Combined sheet — primary view from the FIRST part populates the
  // top-level DrawingResult so downstream PDF/DXF exporters can render
  // the "assembly overview" view; per-part details are in `perPart`.
  const primary = perPart[0];

  return {
    ...primary,
    bom,
    perPart,
    fingerprint: computeAssemblyFingerprint(parts),
  };
}
