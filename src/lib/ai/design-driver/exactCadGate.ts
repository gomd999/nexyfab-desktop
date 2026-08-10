/**
 * Exact CAD gate for the Design Driver.
 *
 * The mesh geometry gate remains useful for deterministic drawing/topology
 * checks, but it is not a manufacturing B-rep. This gate independently builds
 * every declared body with the real OCCT kernel, proves it is one valid solid,
 * exports STEP, imports that STEP again, and compares kernel volume across the
 * round trip. Sampled circular extrudes are promoted through buildPrismAt to an
 * analytic cylinder; a polygonal approximation is never accepted as the exact
 * circular deliverable.
 */

import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { detectSampledCircle } from '@/lib/cad/sampledCircle';
import type { OcctDetailedShapeInspection, OcctBridge } from '@/lib/occt/bridge';
import { ANALYTIC_CIRCULAR_PRISM_WARNING } from '@/lib/occt/bridge';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import type { OcctShape } from '@/lib/occt/types';
import type { CurvedArtifact } from './curvedGate';
import type { HoleArtifact } from './holeGate';
import type { GateResult, PlanPart } from './types';

const ROUND_TRIP_VOLUME_TOL_REL = 1e-9;

export interface ExactCadBodyArtifact {
  bodyId: string;
  source: 'direct-extrude' | 'direct-revolve' | 'hole-step' | 'curved-step';
  valid: true;
  solidCount: 1;
  faceCount: number;
  edgeCount: number;
  degeneratedEdgeCount: number;
  boundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  volumeMm3: number;
  roundTripVolumeMm3: number;
  roundTripVolumeRelError: number;
  roundTripDegeneratedEdgeCount: number;
  roundTripBoundaryEdgeCount: number;
  roundTripNonManifoldEdgeCount: number;
  analyticCylinder: boolean;
  step: string;
}

export interface ExactCadArtifact {
  ok: boolean;
  partId: string;
  bodies: ExactCadBodyArtifact[];
  exactVolumeMm3: number;
  reason?: string;
  kernelUnavailable?: boolean;
}

function failure(partId: string, reason: string, kernelUnavailable = false): ExactCadArtifact {
  return { ok: false, partId, bodies: [], exactVolumeMm3: 0, reason, kernelUnavailable };
}

function extrudeRange(feature: ExtrudeFeature): { z0: number; height: number } {
  const offset = feature.profileOffsetZ ?? 0;
  if (feature.direction === 'two_sided') return { z0: offset - feature.depth, height: feature.depth * 2 };
  if (feature.direction === 'midplane') return { z0: offset - feature.depth / 2, height: feature.depth };
  return { z0: offset, height: feature.depth };
}

function analyticCylinder(detail: OcctDetailedShapeInspection): boolean {
  return detail.surfaceTypes.status === 'available'
    && (detail.surfaceTypes.counts.cylinder ?? 0) > 0;
}

function inspectionFailure(bodyId: string, detail: OcctDetailedShapeInspection): string | null {
  if (!detail.valid) return `body '${bodyId}': OCCT BRepCheck_Analyzer reports invalid topology`;
  if (detail.solidCount !== 1) return `body '${bodyId}': expected exactly one OCCT solid, got ${detail.solidCount}`;
  if (!(detail.absoluteVolume > 0) || !Number.isFinite(detail.absoluteVolume)) {
    return `body '${bodyId}': exact kernel volume is not positive (${detail.absoluteVolume})`;
  }
  if (detail.faceAdjacency.status !== 'available') {
    return `body '${bodyId}': exact face adjacency unavailable: ${detail.faceAdjacency.reason}`;
  }
  if (detail.faceAdjacency.boundaryEdgeCount !== 0 || detail.faceAdjacency.nonManifoldEdgeCount !== 0) {
    return `body '${bodyId}': exact topology has ${detail.faceAdjacency.boundaryEdgeCount} free boundary and ${detail.faceAdjacency.nonManifoldEdgeCount} non-manifold edge(s); ${detail.faceAdjacency.degeneratedEdgeCount} OCCT-degenerated edge(s) excluded from free-boundary count`;
  }
  return null;
}

async function inspectStepRoundTrip(
  bridge: OcctBridge,
  shape: OcctShape,
  bodyId: string,
  source: ExactCadBodyArtifact['source'],
  release: (shape: OcctShape) => void,
): Promise<ExactCadBodyArtifact> {
  if (!bridge.inspectShapeDetailed) throw new Error(`body '${bodyId}': detailed OCCT inspection unavailable`);
  const detail = await bridge.inspectShapeDetailed(shape);
  const bad = inspectionFailure(bodyId, detail);
  if (bad) throw new Error(bad);

  const step = await bridge.exportSTEP(shape);
  if (!/^ISO-10303-21;/m.test(step)) throw new Error(`body '${bodyId}': STEP export has no ISO-10303-21 header`);
  const imported = await bridge.importSTEP(step);
  if (!imported.ok || !imported.shape) {
    throw new Error(`body '${bodyId}': exported STEP cannot be re-imported: ${imported.error ?? 'no shape'}`);
  }
  release(imported.shape);
  const roundTrip = await bridge.inspectShapeDetailed(imported.shape);
  const roundTripBad = inspectionFailure(`${bodyId}:STEP`, roundTrip);
  if (roundTripBad) throw new Error(roundTripBad);
  if (detail.faceAdjacency.status !== 'available' || roundTrip.faceAdjacency.status !== 'available') {
    throw new Error(`body '${bodyId}': exact adjacency evidence unexpectedly unavailable after validation`);
  }
  const rel = Math.abs(roundTrip.absoluteVolume - detail.absoluteVolume)
    / Math.max(Math.abs(detail.absoluteVolume), 1e-12);
  if (rel > ROUND_TRIP_VOLUME_TOL_REL) {
    throw new Error(`body '${bodyId}': STEP round-trip volume relError ${rel} > ${ROUND_TRIP_VOLUME_TOL_REL}`);
  }
  return {
    bodyId,
    source,
    valid: true,
    solidCount: 1,
    faceCount: detail.faceCount,
    edgeCount: detail.edgeCount,
    degeneratedEdgeCount: detail.faceAdjacency.degeneratedEdgeCount,
    boundaryEdgeCount: detail.faceAdjacency.boundaryEdgeCount,
    nonManifoldEdgeCount: detail.faceAdjacency.nonManifoldEdgeCount,
    volumeMm3: detail.absoluteVolume,
    roundTripVolumeMm3: roundTrip.absoluteVolume,
    roundTripVolumeRelError: rel,
    roundTripDegeneratedEdgeCount: roundTrip.faceAdjacency.degeneratedEdgeCount,
    roundTripBoundaryEdgeCount: roundTrip.faceAdjacency.boundaryEdgeCount,
    roundTripNonManifoldEdgeCount: roundTrip.faceAdjacency.nonManifoldEdgeCount,
    analyticCylinder: analyticCylinder(detail),
    step,
  };
}

/** Build and round-trip the exact B-rep deliverable for one plan part. */
export async function buildExactCadArtifact(
  part: PlanPart,
  curved: CurvedArtifact | null = null,
  holes: HoleArtifact | null = null,
): Promise<ExactCadArtifact> {
  if (part.curved && part.holes?.length) {
    return failure(part.partId, 'combined curved+hole exact feature composition is not wired; refusing independent partial B-reps');
  }
  if ((part.curved || part.holes?.length) && part.bodies.length !== 1) {
    return failure(part.partId, 'derived exact features currently require exactly one base body');
  }

  const loaded = await loadOcctNode();
  if (!loaded.ok || !loaded.oc) {
    return failure(part.partId, `OCCT kernel unavailable: ${loaded.reason ?? 'unknown'}`, true);
  }
  const bridge = createNodeOcctBridge(loaded.oc);
  const live = new Map<string, OcctShape>();
  const remember = (shape: OcctShape): OcctShape => {
    live.set(shape.id, shape);
    return shape;
  };

  try {
    const bodies: ExactCadBodyArtifact[] = [];
    if (part.holes?.length) {
      if (!holes?.ok || !holes.step) throw new Error('verified hole STEP is missing');
      const imported = await bridge.importSTEP(holes.step);
      if (!imported.ok || !imported.shape) throw new Error(`hole STEP import failed: ${imported.error ?? 'no shape'}`);
      const shape = remember(imported.shape);
      bodies.push(await inspectStepRoundTrip(bridge, shape, part.bodies[0]!.bodyId, 'hole-step', remember));
    } else if (part.curved) {
      if (!curved?.ok || !curved.step) throw new Error('verified curved STEP is missing');
      const imported = await bridge.importSTEP(curved.step);
      if (!imported.ok || !imported.shape) throw new Error(`curved STEP import failed: ${imported.error ?? 'no shape'}`);
      const shape = remember(imported.shape);
      bodies.push(await inspectStepRoundTrip(bridge, shape, part.bodies[0]!.bodyId, 'curved-step', remember));
    } else {
      for (const body of part.bodies) {
        let made;
        let source: ExactCadBodyArtifact['source'];
        if (body.feature.kind === 'extrude') {
          if (!bridge.buildPrismAt) throw new Error(`body '${body.bodyId}': exact prism builder unavailable`);
          const feature = body.feature as ExtrudeFeature;
          const range = extrudeRange(feature);
          made = await bridge.buildPrismAt(feature.loop, range.z0, range.height);
          source = 'direct-extrude';
          // A detected circular transport loop must be analytic. Non-circular
          // profiles legitimately have no promotion warning.
          if (detectSampledCircle(feature.loop) && !made.warnings.includes(ANALYTIC_CIRCULAR_PRISM_WARNING)) {
            throw new Error(`body '${body.bodyId}': sampled circle was not promoted to an analytic OCCT cylinder`);
          }
        } else if (body.feature.kind === 'revolve') {
          made = await bridge.buildFromRevolve(body.feature);
          source = 'direct-revolve';
        } else {
          throw new Error(`body '${body.bodyId}': exact OCCT build is not wired for feature '${body.feature.kind}'`);
        }
        if (!made.ok || !made.shape) throw new Error(`body '${body.bodyId}': exact build failed: ${made.error ?? 'no shape'}`);
        const shape = remember(made.shape);
        bodies.push(await inspectStepRoundTrip(bridge, shape, body.bodyId, source, remember));
      }
    }
    return {
      ok: true,
      partId: part.partId,
      bodies,
      exactVolumeMm3: bodies.reduce((sum, body) => sum + body.volumeMm3, 0),
    };
  } catch (error) {
    return failure(part.partId, error instanceof Error ? error.message : String(error));
  } finally {
    for (const shape of live.values()) {
      try { bridge.release(shape); } catch { /* best effort */ }
    }
  }
}

export function exactCadGate(part: PlanPart, artifact: ExactCadArtifact | null): GateResult {
  const notes = [
    'Real OCCT B-rep per declared body: BRepCheck validity + exactly one solid + closed adjacency + positive BRepGProp volume.',
    'Every B-rep is exported as ISO-10303-21 STEP, re-imported, re-inspected, and volume-compared at relTol 1e-9.',
    'Sampled circular extrudes are transport only and must be promoted to analytic OCCT cylinders.',
  ];
  if (!artifact) {
    return { id: `exact-cad:${part.partId}`, kind: 'exact-cad', pass: false, metrics: {}, reason: 'exact CAD artifact missing', notes };
  }
  const metrics: Record<string, number> = {
    bodyCount: artifact.bodies.length,
    exactVolumeMm3: artifact.exactVolumeMm3,
    validSolidCount: artifact.bodies.filter(body => body.valid && body.solidCount === 1).length,
    stepBodyCount: artifact.bodies.filter(body => body.step.length > 0).length,
    analyticCylinderBodyCount: artifact.bodies.filter(body => body.analyticCylinder).length,
    degeneratedEdgeCount: artifact.bodies.reduce((sum, body) => sum + body.degeneratedEdgeCount, 0),
    freeBoundaryEdgeCount: artifact.bodies.reduce((sum, body) => sum + body.boundaryEdgeCount, 0),
    nonManifoldEdgeCount: artifact.bodies.reduce((sum, body) => sum + body.nonManifoldEdgeCount, 0),
    stepFreeBoundaryEdgeCount: artifact.bodies.reduce((sum, body) => sum + body.roundTripBoundaryEdgeCount, 0),
    stepNonManifoldEdgeCount: artifact.bodies.reduce((sum, body) => sum + body.roundTripNonManifoldEdgeCount, 0),
    maxStepRoundTripVolumeRelError: artifact.bodies.reduce((max, body) => Math.max(max, body.roundTripVolumeRelError), 0),
  };
  return {
    id: `exact-cad:${part.partId}`,
    kind: 'exact-cad',
    pass: artifact.ok,
    metrics,
    ...(!artifact.ok ? { reason: artifact.reason ?? 'exact CAD build failed' } : {}),
    notes,
  };
}
