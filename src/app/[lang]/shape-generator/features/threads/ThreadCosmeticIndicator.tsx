'use client';

/**
 * ThreadCosmeticIndicator — Wave 2 Phase 2 Track D6 (W6) viewport hint.
 *
 * Spec §8 (cost model) + §2.1 (cosmetic mode visual marker). Per the spec a
 * cosmetic thread is rendered as a **magenta dashed circle** at the thread's
 * axis × major-radius, drawn at the entry plane of the parent hole/cylinder.
 *
 * The component is a `@react-three/fiber` child that mounts inside the
 * existing viewport `<Canvas>` (next to `<ReferenceGeometryLayer>` per the
 * spec). It accepts a `threads` array (the currently-resolved thread
 * features), computes the dashed circle geometry once per array, and
 * returns a `<group>` containing one `<lineLoop>` per thread.
 *
 * Visual spec (resolved from spec §8 + §2.1):
 *   - colour:    `#ff00ff` (magenta — non-negotiable per §8)
 *   - dashSize:  1.5 mm
 *   - gapSize:   0.75 mm
 *   - radius:    `row.nominalDia / 2`     (= major diameter / 2)
 *   - segments:  36 around the axis (12° per segment)
 *   - position:  `feature.startOffset` along the parent's axis (default +Z)
 *
 * When `threads` is empty (or contains only `mode === 'geometric'` features —
 * those are W7 and rendered as real geometry, not a cosmetic hint) the
 * component renders **nothing** (`return null`). This matches the
 * `ReferenceGeometryLayer` "no-op when empty" idiom so non-threads parts pay
 * zero render cost.
 */

import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { findThreadRow } from './threadCatalog';
import type { ThreadFeature } from './threadFeature';

// ─── Constants — single source of truth for the magenta-dashed style ───────

/** Magenta. Spec §8 — non-configurable. */
export const THREAD_COSMETIC_COLOR = '#ff00ff' as const;
/** Dash length in mm. */
export const THREAD_COSMETIC_DASH_SIZE = 1.5;
/** Gap between dashes in mm. */
export const THREAD_COSMETIC_GAP_SIZE = 0.75;
/** Number of segments around the axis. */
export const THREAD_COSMETIC_SEGMENTS = 36;

// ─── Props ─────────────────────────────────────────────────────────────────

export interface ThreadCosmeticIndicatorProps {
  /** Threads currently in the feature tree. */
  threads: readonly ThreadFeature[];
  /**
   * Per-feature anchor lookup. The host (ShapePreview) maps a parentFeatureId
   * to the parent's axis + origin in model coords. If a thread is not in the
   * map we fall back to (axis = +Z, origin = 0) — adequate for unit tests and
   * for the in-wizard preview where the thread's parent is the modal's own
   * hole spec, drawn at the origin.
   */
  anchorFor?: (
    feature: ThreadFeature,
  ) => { axis: readonly [number, number, number]; origin: readonly [number, number, number] } | null;
  /** When true, the layer renders nothing without unmounting state. */
  hidden?: boolean;
}

// ─── Geometry helpers ──────────────────────────────────────────────────────

const DEFAULT_AXIS: readonly [number, number, number] = [0, 0, 1];
const DEFAULT_ORIGIN: readonly [number, number, number] = [0, 0, 0];

/**
 * Build a 36-segment closed polyline of vertices for a circle in the plane
 * perpendicular to `axis` at `center`. Vertices are emitted in CCW order
 * about the axis (right-handed).
 *
 * The line is intentionally **closed** (last vertex repeats the first) so
 * the `Line` segment list draws all 36 edges including the wrap-around.
 */
export function buildDashedCircleGeometry(
  center: readonly [number, number, number],
  axis: readonly [number, number, number],
  radius: number,
  segments: number = THREAD_COSMETIC_SEGMENTS,
): THREE.BufferGeometry {
  if (!Number.isFinite(radius) || radius <= 0) {
    return new THREE.BufferGeometry();
  }
  // Build two unit vectors orthogonal to `axis`.
  const a = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
  // Pick the most-orthogonal world axis as the seed.
  const seed =
    Math.abs(a.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(a, seed).normalize();
  const v = new THREE.Vector3().crossVectors(a, u).normalize();

  const c = new THREE.Vector3(center[0], center[1], center[2]);
  const verts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const p = c
      .clone()
      .addScaledVector(u, Math.cos(t) * radius)
      .addScaledVector(v, Math.sin(t) * radius);
    verts.push(p.x, p.y, p.z);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return geom;
}

/**
 * Build a magenta dashed-line material with the spec'd dash/gap.
 * `Line.computeLineDistances()` must be called on the host `Line` for the
 * dash pattern to be visible — we expose that as a sibling helper.
 */
export function makeDashedMaterial(): THREE.LineDashedMaterial {
  return new THREE.LineDashedMaterial({
    color: THREAD_COSMETIC_COLOR,
    dashSize: THREAD_COSMETIC_DASH_SIZE,
    gapSize: THREAD_COSMETIC_GAP_SIZE,
    transparent: false,
    depthTest: true,
  });
}

// ─── Resolved per-thread visual record ─────────────────────────────────────

interface CosmeticVisual {
  readonly id: string;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.LineDashedMaterial;
  readonly center: readonly [number, number, number];
}

function buildVisuals(
  threads: readonly ThreadFeature[],
  anchorFor: ThreadCosmeticIndicatorProps['anchorFor'],
): CosmeticVisual[] {
  const out: CosmeticVisual[] = [];
  for (const t of threads) {
    if (t.mode !== 'cosmetic') continue; // geometric is W7
    const row = findThreadRow(t.threadRef.series, t.threadRef.designation);
    if (!row) continue;
    const anchor = anchorFor?.(t) ?? null;
    const axis = anchor?.axis ?? DEFAULT_AXIS;
    const origin = anchor?.origin ?? DEFAULT_ORIGIN;
    // Anchor the cosmetic circle at startOffset along the axis from origin.
    const center: [number, number, number] = [
      origin[0] + axis[0] * t.startOffset,
      origin[1] + axis[1] * t.startOffset,
      origin[2] + axis[2] * t.startOffset,
    ];
    const radius = row.nominalDia / 2;
    const geometry = buildDashedCircleGeometry(center, axis, radius);
    const material = makeDashedMaterial();
    out.push({ id: t.id, geometry, material, center });
  }
  return out;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function ThreadCosmeticIndicator({
  threads,
  anchorFor,
  hidden,
}: ThreadCosmeticIndicatorProps): React.ReactElement | null {
  const visuals = useMemo<CosmeticVisual[]>(
    () => (hidden ? [] : buildVisuals(threads, anchorFor)),
    [threads, anchorFor, hidden],
  );

  // Dispose previous frame's GPU buffers when the visuals array changes.
  useEffect(() => {
    return () => {
      for (const v of visuals) {
        v.geometry.dispose();
        v.material.dispose();
      }
    };
  }, [visuals]);

  if (hidden || visuals.length === 0) return null;

  return (
    <group data-testid="thread-cosmetic-indicator-group">
      {visuals.map((v) => (
        <primitive
          key={v.id}
          object={makeLineForVisual(v)}
          data-testid={`thread-cosmetic-indicator-${v.id}`}
        />
      ))}
    </group>
  );
}

// ─── Imperative helpers (for tests + the primitive wrapper above) ─────────

/**
 * Build a complete `THREE.Line` instance for a visual record, including the
 * `computeLineDistances()` call required by `LineDashedMaterial`. Exported
 * so unit tests can assert geometry / material / dashing without mounting
 * the R3F tree.
 */
export function makeLineForVisual(v: {
  geometry: THREE.BufferGeometry;
  material: THREE.LineDashedMaterial;
}): THREE.Line {
  const line = new THREE.Line(v.geometry, v.material);
  line.computeLineDistances();
  return line;
}

/**
 * Public helper for use by host code (and tests) that needs the dashed-circle
 * polyline without the rest of the R3F machinery.
 */
export function buildThreadCosmeticPolyline(thread: ThreadFeature, anchor?: {
  axis: readonly [number, number, number];
  origin: readonly [number, number, number];
}): THREE.BufferGeometry | null {
  if (thread.mode !== 'cosmetic') return null;
  const row = findThreadRow(thread.threadRef.series, thread.threadRef.designation);
  if (!row) return null;
  const axis = anchor?.axis ?? DEFAULT_AXIS;
  const origin = anchor?.origin ?? DEFAULT_ORIGIN;
  const center: [number, number, number] = [
    origin[0] + axis[0] * thread.startOffset,
    origin[1] + axis[1] * thread.startOffset,
    origin[2] + axis[2] * thread.startOffset,
  ];
  return buildDashedCircleGeometry(center, axis, row.nominalDia / 2);
}
