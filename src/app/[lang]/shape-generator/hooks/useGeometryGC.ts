import { useEffect } from 'react';
import * as THREE from 'three';
import { useSceneStore } from '../store/sceneStore';
// Global registry of all geometries created by the app.
// We add geometries here when they are created (e.g. from workers, importers).
const trackedGeometries = new Set<THREE.BufferGeometry | THREE.EdgesGeometry>();

// Additional active sets registered by local components
const localActiveSets = new Set<Set<THREE.BufferGeometry | THREE.EdgesGeometry>>();

/**
 * Registers a geometry to be managed by the Garbage Collector.
 * Also automatically computes the BVH bounds tree to accelerate raycasting.
 */
export function trackGeometry(geo: THREE.BufferGeometry | THREE.EdgesGeometry | undefined | null) {
  if (geo) {
    trackedGeometries.add(geo);
    // Automatically compute BVH for solid geometries (skip EdgesGeometry as it's not a mesh)
    if (!(geo instanceof THREE.EdgesGeometry)) {
      const gAny = geo as any;
      if (gAny.computeBoundsTree && !gAny.boundsTree) {
        // Small delay or synchronous? Synchronous is usually fine, but for very large 
        // models it might block. We'll do it synchronously since it's during loading/parsing.
        gAny.computeBoundsTree();
      }
    }
  }
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
