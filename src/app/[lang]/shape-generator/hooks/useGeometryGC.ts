import { useEffect } from 'react';
import * as THREE from 'three';
import { useSceneStore } from '../store/sceneStore';
// Global registry of all geometries created by the app.
// We add geometries here when they are created (e.g. from workers, importers).
const trackedGeometries = new Set<THREE.BufferGeometry | THREE.EdgesGeometry>();

// Additional active sets registered by local components
const localActiveSets = new Set<Set<THREE.BufferGeometry | THREE.EdgesGeometry>>();

/** three-mesh-bvh augments BufferGeometry at runtime (see `trackGeometry`). */
type BufferGeometryWithBVH = THREE.BufferGeometry & {
  computeBoundsTree?: () => void;
  disposeBoundsTree?: () => void;
  boundsTree?: unknown;
};

/**
 * Registers a geometry to be managed by the Garbage Collector.
 * Also automatically computes the BVH bounds tree to accelerate raycasting.
 */
export function trackGeometry(geo: THREE.BufferGeometry | THREE.EdgesGeometry | undefined | null) {
  if (geo) {
    trackedGeometries.add(geo);
    // Automatically compute BVH for solid geometries (skip EdgesGeometry as it's not a mesh)
    if (!(geo instanceof THREE.EdgesGeometry)) {
      const g = geo as BufferGeometryWithBVH;
      // F-0(260808f) — position 속성이 없거나 정점 0인 지오메트리는 BVH 대상이
      // 아니다. 실측: three-mesh-bvh 는 position 이 아예 없으면 던진다(TypeError
      // reading 'count') — 'none' 베이스리스의 edgeGeometry(맨 BufferGeometry,
      // EdgesGeometry 인스턴스가 아니라 이 분기에 들어옴)가 정확히 그 경우로,
      // 그 예외가 generate() 캐치에서 조용히 null 로 강등돼 표시 계층의
      // lastGood 폴백이 직전 형상(기본 박스)을 화면에 남겼다(브라우저 전용 —
      // 노드 테스트 환경은 BVH 프로토타입 확장이 없어 이 경로를 건너뛴다).
      if (typeof g.computeBoundsTree === 'function' && g.boundsTree == null
        && (g.attributes.position?.count ?? 0) > 0) {
        // Small delay or synchronous? Synchronous is usually fine, but for very large 
        // models it might block. We'll do it synchronously since it's during loading/parsing.
        g.computeBoundsTree();
      }
    }
  }
}

/**
 * Immediately dispose + un-register a single geometry.
 *
 * For consumers that borrow the import pipeline for measurement only (e.g. the
 * quick-quote page reads volume/bbox then discards) and never mount
 * `useGeometryGC`. Without this the geometry — plus the BVH `trackGeometry`
 * eagerly computes — lives forever in `trackedGeometries` and accumulates per
 * upload. Safe to call on geometries not in the registry (dispose is idempotent).
 */
export function untrackGeometry(geo: THREE.BufferGeometry | THREE.EdgesGeometry | undefined | null) {
  if (!geo) return;
  (geo as BufferGeometryWithBVH).disposeBoundsTree?.();
  geo.dispose();
  trackedGeometries.delete(geo);
}

/**
 * Sweeps the registry and disposes any geometry that is no longer in the active set.
 */
export function sweepGeometries(mainActiveGeometries: Set<THREE.BufferGeometry | THREE.EdgesGeometry>) {
  // Combine main active geometries with all local active geometries
  const allActive = new Set(mainActiveGeometries);
  localActiveSets.forEach(localSet => {
    localSet.forEach(geo => allActive.add(geo));
  });

  for (const geo of trackedGeometries) {
    if (!allActive.has(geo)) {
      // three-mesh-bvh requires disposing the boundsTree BEFORE the geometry.
      // trackGeometry() calls computeBoundsTree() but nothing freed it, so
      // geo.dispose() dispatched 'dispose' against a stale BVH — throwing
      // "Cannot read properties of undefined (reading '0')" during teardown
      // (e.g. entering Drawing mode triggers this sweep) and leaking the BVH.
      // (2026-06-13 fix)
      (geo as BufferGeometryWithBVH).disposeBoundsTree?.();
      geo.dispose();
      trackedGeometries.delete(geo);
    }
  }
}

/**
 * React hook that automatically sweeps memory when active state changes.
 * This prevents WebGL memory leaks during intensive modeling (e.g., tweaking sliders, adding features).
 */
export function useGeometryGC() {
  const sketchResult = useSceneStore(s => s.sketchResult);
  const previewResult = useSceneStore(s => s.previewResult);

  useEffect(() => {
    // Collect all geometries currently used by the application
    const active = new Set<THREE.BufferGeometry | THREE.EdgesGeometry>();

    if (sketchResult) {
      if (sketchResult.geometry) active.add(sketchResult.geometry);
      if (sketchResult.edgeGeometry) active.add(sketchResult.edgeGeometry);
    }
    
    if (previewResult) {
      if (previewResult.geometry) active.add(previewResult.geometry);
      if (previewResult.edgeGeometry) active.add(previewResult.edgeGeometry);
    }

    // Multi-body / placement meshes are tracked via refs in ShapeGeneratorInner (`bodyGeosRef`),
    // not on Yjs BodyEntry / PlacedPart rows — extend here when those refs are wired through.

    sweepGeometries(active);
  }, [sketchResult, previewResult]);
}

/**
 * Hook for local components to protect their temporary geometries from being garbage collected
 * until they are moved into the main scene store or discarded.
 */
export function useLocalActiveGeometries(geometries: (THREE.BufferGeometry | THREE.EdgesGeometry | undefined | null)[]) {
  useEffect(() => {
    const localSet = new Set<THREE.BufferGeometry | THREE.EdgesGeometry>();
    geometries.forEach(g => {
      if (g) localSet.add(g);
    });
    
    localActiveSets.add(localSet);
    
    return () => {
      localActiveSets.delete(localSet);
    };
  }, [geometries]);
}
