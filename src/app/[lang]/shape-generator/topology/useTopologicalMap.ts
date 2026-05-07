'use client';
/**
 * useTopologicalMap
 *
 * React hook that maintains a TopologicalMap across shape rebuilds.
 * Every time the geometry changes, `update()` must be called to
 * re-assign stable face IDs while preserving existing ones via
 * signature matching.
 *
 * Usage:
 *   const { map, update, resolveId, getIdForIndex } = useTopologicalMap();
 *   // After geometry is built:
 *   update(newGeometry, originFeatureId);
 *   // To resolve a stable id → current index:
 *   const idx = resolveId('f-abc123');
 */

import { useState, useCallback, useRef } from 'react';
import type * as THREE from 'three';
import {
  buildTopologicalMap,
  resolveStableId,
  getStableIdForIndex,
  findFacesByTag,
  findFacesByFeature,
  createEmptyTopologicalMap,
  summariseMap,
} from './TopologicalNaming';
import type { TopologicalMap, StableFace } from './TopologicalNaming';

export type { TopologicalMap, StableFace };

export type UseTopologicalMapReturn = {
  map: TopologicalMap;
  update: (geo: import('three').BufferGeometry, originFeatureId?: string) => void;
  resolveId: (stableId: string) => number | null;
  getIdForIndex: (index: number) => string | null;
  facesByTag: (tag: string) => StableFace[];
  facesByFeature: (featureId: string) => StableFace[];
  summary: string;
  generation: number;
};


export function useTopologicalMap(): UseTopologicalMapReturn {
  const [map, setMap] = useState<TopologicalMap>(createEmptyTopologicalMap);
  const mapRef = useRef<TopologicalMap>(map);

  const update = useCallback((geo: THREE.BufferGeometry, originFeatureId?: string) => {
    const prev = mapRef.current;
    const next = buildTopologicalMap(geo, prev, originFeatureId);
    mapRef.current = next;
    setMap(next);
  }, []);

  const resolveId = useCallback((stableId: string) => {
    return resolveStableId(mapRef.current, stableId);
  }, []);

  const getIdForIndex = useCallback((index: number) => {
    return getStableIdForIndex(mapRef.current, index);
  }, []);

  const facesByTag = useCallback((tag: string) => {
    return findFacesByTag(mapRef.current, tag);
  }, []);

  const facesByFeature = useCallback((featureId: string) => {
    return findFacesByFeature(mapRef.current, featureId);
  }, []);

  return {
    map,
    update,
    resolveId,
    getIdForIndex,
    facesByTag,
    facesByFeature,
    summary: summariseMap(map),
    generation: map.generation,
  };
}
