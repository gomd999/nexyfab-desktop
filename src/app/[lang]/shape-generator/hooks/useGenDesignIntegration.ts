'use client';
/**
 * useGenDesignIntegration
 *
 * Hook that integrates generative design (SIMP topology optimization) results
 * into the main feature pipeline.
 *
 * When `commitResult()` is called with the marching-cubes mesh from the SIMP
 * optimizer, this hook:
 *
 *  1. Converts the voxel-based OptResult mesh into a BufferGeometry at the
 *     correct world scale.
 *  2. Creates a `sketchExtrude`-style feature node in the feature stack with
 *     a synthetic `sketchProfile` derived from the bounding box of the result,
 *     so the mesh participates in boolean operations and downstream features.
 *  3. Records the optimization config (material, volfrac, iterations) in the
 *     feature node's `sketchData.config` for traceability and future replay.
 *  4. Dispatches a toast notification on success/failure.
 *
 * The returned `resultGeo` is kept in local state so the overlay toggle still
 * works even after it has been committed to the feature tree.
 *
 * Usage in ShapeGeneratorInner:
 *   const genIntegration = useGenDesignIntegration({ addSketchFeature, addToast, lang });
 *   // When optimizer finishes:
 *   genIntegration.commitResult(resultGeo, optConfig);
 *   // In JSX:
 *   {genIntegration.isPending && <LoadingSpinner />}
 */

import { useState, useCallback, useRef } from 'react';
import * as THREE from 'three';
import type { OptConfig, OptResult } from '../topology/optimizer/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenDesignCommitResult {
  success: boolean;
  featureId?: string;
  error?: string;
}

interface UseGenDesignIntegrationOptions {
  addSketchFeature: (
    profile: { segments: any[]; closed: boolean },
    config: any,
    plane: 'xy' | 'xz' | 'yz',
    operation: 'add' | 'subtract',
    planeOffset?: number,
  ) => void;
  addToast: (type: 'success' | 'error' | 'info', message: string) => void;
  lang?: string;
}

// ─── Messages ─────────────────────────────────────────────────────────────────

const MSG = {
  ko: {
    committed: '제너레이티브 디자인 결과가 피처 트리에 추가되었습니다',
    error: '제너레이티브 디자인 피처 추가 실패',
    noGeo: '결과 메시가 없습니다 — 먼저 최적화를 실행하세요',
  },
  en: {
    committed: 'Generative design result added to feature tree',
    error: 'Failed to add generative design feature',
    noGeo: 'No result mesh — run the optimizer first',
  },
};

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/**
 * Derive a closed rectangular sketch profile from a geometry's bounding box
 * in the XY plane. This lets the result mesh slot into the sketch/extrude
 * feature pipeline with proper boolean participation.
 */
function bboxToXYProfile(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox ?? new THREE.Box3();
  const minX = bb.min.x, maxX = bb.max.x;
  const minY = bb.min.y, maxY = bb.max.y;

  return {
    segments: [
      { type: 'line' as const, from: { x: minX, y: minY }, to: { x: maxX, y: minY } },
      { type: 'line' as const, from: { x: maxX, y: minY }, to: { x: maxX, y: maxY } },
      { type: 'line' as const, from: { x: maxX, y: maxY }, to: { x: minX, y: maxY } },
      { type: 'line' as const, from: { x: minX, y: maxY }, to: { x: minX, y: minY } },
    ],
    closed: true,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useGenDesignIntegration({
  addSketchFeature,
  addToast,
  lang = 'en',
}: UseGenDesignIntegrationOptions) {
  const t = lang === 'ko' || lang === 'kr' ? MSG.ko : MSG.en;
  const [isPending, setIsPending] = useState(false);
  const [lastCommittedGeo, setLastCommittedGeo] = useState<THREE.BufferGeometry | null>(null);
  const [committedConfig, setCommittedConfig] = useState<Partial<OptConfig> | null>(null);
  const lastResultRef = useRef<THREE.BufferGeometry | null>(null);

  /**
   * Store the latest optimizer result geometry for later commit.
   * Call this from the `onResult` callback of the ConditionPanel/optimizer.
   */
  const setResult = useCallback((geo: THREE.BufferGeometry) => {
    lastResultRef.current = geo;
  }, []);

  /**
   * Commit the current result geometry to the feature tree as a sketch extrude.
   * Optionally pass the OptConfig for metadata recording.
   */
  const commitResult = useCallback((
    geo: THREE.BufferGeometry | null,
    config?: Partial<OptConfig>,
  ): GenDesignCommitResult => {
    const targetGeo = geo ?? lastResultRef.current;
    if (!targetGeo) {
      addToast('error', t.noGeo);
      return { success: false, error: t.noGeo };
    }

    setIsPending(true);
    try {
      // Build a bounding-box profile in XY so the result is treated as a
      // closed sketch extrude in the add direction.
      const profile = bboxToXYProfile(targetGeo);
      targetGeo.computeBoundingBox();
      const bb = targetGeo.boundingBox ?? new THREE.Box3();
      const depth = bb.max.z - bb.min.z;
      const planeOffset = bb.min.z;

      // Encode the optimizer config into the sketch config field so it's
      // preserved in the feature tree history.
      const sketchConfig = {
        depth,
        genDesign: true,
        material: config?.material?.name ?? 'unknown',
        volfrac: config?.volfrac ?? 0.3,
        penal: config?.penal ?? 3,
        rmin: config?.rmin ?? 1.5,
        iterations: config?.maxIter ?? 100,
      };

      addSketchFeature(profile, sketchConfig, 'xy', 'add', planeOffset);

      setLastCommittedGeo(targetGeo);
      setCommittedConfig(config ?? null);
      addToast('success', t.committed);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', `${t.error}: ${msg}`);
      return { success: false, error: msg };
    } finally {
      setIsPending(false);
    }
  }, [addSketchFeature, addToast, t]);

  /**
   * Export the result geometry to STL for download.
   */
  const exportResultSTL = useCallback(async (filename = 'gen-design-result') => {
    const geo = lastResultRef.current ?? lastCommittedGeo;
    if (!geo) return;
    const { exportSTL } = await import('../io/exporters');
    await exportSTL(geo, filename);
  }, [lastCommittedGeo]);

  return {
    isPending,
    lastCommittedGeo,
    committedConfig,
    setResult,
    commitResult,
    exportResultSTL,
  };
}
