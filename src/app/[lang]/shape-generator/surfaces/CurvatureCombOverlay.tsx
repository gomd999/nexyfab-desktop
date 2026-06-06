'use client';

/**
 * CurvatureCombOverlay.tsx — R3F overlay that draws an analytic curvature
 * comb across a NURBS surface.
 *
 * Class-A reviewers read a surface's fairness from the comb: a spike at each
 * station, length ∝ curvature, drawn on the SIGNED side of κ so inflections
 * flip the comb across the curve. Unlike the mesh angle-defect comb in
 * classASurfaceAnalysis, this reads the EXACT surface normal curvature from
 * the analytic fundamental forms (buildCombScene → nurbsIsoCurvatureComb).
 *
 * Pure presentational: all geometry comes from the tested `buildCombScene`
 * pure function; this file only wraps the flat buffers into BufferGeometry and
 * two `lineSegments` (we avoid R3F's `<line>`, which collides with the DOM
 * SVGLineElement type — same reason DynamicEdgeOverlay notes). `null` when
 * there is no surface or `visible` is false.
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';
import type { NurbsSurface } from './nurbsSurface';
import { buildCombScene } from './nurbsSurfaceCurvature';

export interface CurvatureCombOverlayProps {
  /** Surface to inspect. `null` renders nothing. */
  surface: NurbsSurface | null;
  /** Iso direction the combs run along (default 'u' — fixed u, swept v). */
  isoDirection?: 'u' | 'v';
  /** Fixed parameters, one comb each (default [0.25, 0.5, 0.75]). */
  isoParams?: number[];
  /** Stations per comb (default 24). */
  sampleCount?: number;
  /** Fixed spike scale (mm per 1/mm); auto-fit when omitted. */
  scale?: number;
  /** Auto-fit: longest spike spans this fraction of the curve diagonal. */
  targetFraction?: number;
  /** Hide without unmounting. */
  visible?: boolean;
  /** Spike opacity (default 0.95). */
  spikeOpacity?: number;
  /** Envelope polyline colour (default '#f8fafc'). */
  envelopeColor?: string;
  /** Draw inflection-point crosses (κ_n sign changes). Default true. */
  showInflections?: boolean;
  /** Inflection cross colour (default '#fbbf24'). */
  inflectionColor?: string;
}

export function CurvatureCombOverlay({
  surface,
  isoDirection = 'u',
  isoParams,
  sampleCount = 24,
  scale,
  targetFraction,
  visible = true,
  spikeOpacity = 0.95,
  envelopeColor = '#f8fafc',
  showInflections = true,
  inflectionColor = '#fbbf24',
}: CurvatureCombOverlayProps): React.ReactElement | null {
  const built = useMemo(() => {
    if (!surface) return null;
    const scene = buildCombScene(surface, {
      isoDirection, isoParams, sampleCount, scale, targetFraction,
    });
    const spikeGeo = new THREE.BufferGeometry();
    spikeGeo.setAttribute('position', new THREE.Float32BufferAttribute(scene.spikePositions, 3));
    spikeGeo.setAttribute('color', new THREE.Float32BufferAttribute(scene.spikeColors, 3));
    const envGeo = new THREE.BufferGeometry();
    envGeo.setAttribute('position', new THREE.Float32BufferAttribute(scene.envelopeSegments, 3));
    let inflGeo: THREE.BufferGeometry | null = null;
    if (scene.inflectionMarkers.length > 0) {
      inflGeo = new THREE.BufferGeometry();
      inflGeo.setAttribute('position', new THREE.Float32BufferAttribute(scene.inflectionMarkers, 3));
    }
    return { spikeGeo, envGeo, inflGeo };
  }, [surface, isoDirection, isoParams, sampleCount, scale, targetFraction]);

  if (!surface || !visible || !built) return null;

  return (
    <group data-testid="curvature-comb-overlay" userData={{ curvatureComb: true }}>
      <lineSegments geometry={built.spikeGeo}>
        <lineBasicMaterial vertexColors transparent opacity={spikeOpacity} depthTest={false} />
      </lineSegments>
      <lineSegments geometry={built.envGeo}>
        <lineBasicMaterial color={envelopeColor} transparent opacity={0.9} depthTest={false} />
      </lineSegments>
      {showInflections && built.inflGeo && (
        <lineSegments geometry={built.inflGeo} userData={{ inflectionMarkers: true }}>
          <lineBasicMaterial color={inflectionColor} transparent opacity={0.95} depthTest={false} />
        </lineSegments>
      )}
    </group>
  );
}

export default CurvatureCombOverlay;
