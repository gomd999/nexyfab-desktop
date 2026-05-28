'use client';

/**
 * ReferenceGeometryLayer.tsx — subscribes the ref-geom store and mounts
 * the `viz.buildReferenceMeshes` output into the Three.js scene.
 *
 * Wave 2 Phase 2 Track D3. Spec §8.
 *
 * Seam: this is a `@react-three/fiber` child component; it sits inside
 * the existing `<Canvas>` next to `<ConstructPlane>` in `ShapePreview.tsx`.
 *
 * The component subscribes to `useReferenceGeometryStore.nodes` via
 * Zustand's selector hook so it re-renders only when the node list
 * reference changes. Heavy GPU lifting (geometry + material allocation)
 * happens in `useMemo` keyed off the node array, which keeps the per-
 * frame cost flat.
 *
 * CRDT note: the store is still plain Zustand (D3 deferred Y.Doc-backed
 * promotion per spec §15). Multi-peer updates land via the existing
 * `replaceAll` action once D3b runs.
 */

import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useReferenceGeometryStore } from './store';
import { buildReferenceMeshes, type VizSizing } from './viz';

export interface ReferenceGeometryLayerProps {
  /** Optional override of default sizes (mm). Useful for tests / large
   *  parts where the default 60mm plane quad is too small. */
  readonly sizing?: VizSizing;
  /** When `true`, the layer renders nothing — used by the host viewport
   *  to gate ref-geom viz behind a UI toggle without unmounting state. */
  readonly hidden?: boolean;
}

export default function ReferenceGeometryLayer(
  props: ReferenceGeometryLayerProps,
): React.ReactElement | null {
  const nodes = useReferenceGeometryStore((s) => s.nodes);

  // Geometry/materials are re-built when the node list changes. We
  // dispose the previous frame's resources via the cleanup effect
  // (THREE buffers don't garbage-collect themselves).
  const objects = useMemo(
    () => (props.hidden ? [] : buildReferenceMeshes(nodes, props.sizing)),
    [nodes, props.sizing, props.hidden],
  );

  useEffect(() => {
    return () => {
      for (const obj of objects) {
        disposeRecursive(obj);
      }
    };
  }, [objects]);

  if (props.hidden || objects.length === 0) return null;

  return (
    <group name="reference-geometry">
      {objects.map((obj) => (
        <primitive key={obj.name} object={obj} />
      ))}
    </group>
  );
}

/** Recursively dispose of geometries + materials in a subtree. THREE
 *  doesn't ref-count these, so the layer owns the lifecycle. */
function disposeRecursive(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const m = child as THREE.Mesh | THREE.Line;
    const geom = (m as { geometry?: THREE.BufferGeometry }).geometry;
    if (geom !== undefined) geom.dispose();
    const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) {
      for (const x of mat) x.dispose();
    } else if (mat !== undefined) {
      mat.dispose();
    }
  });
}
