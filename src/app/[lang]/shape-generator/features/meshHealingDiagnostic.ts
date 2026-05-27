/**
 * meshHealingDiagnostic.ts — Combined health report + recommendation.
 *
 * Runs every detector in this folder against a single geometry and
 * produces a ranked diagnostic + a recommended action plan. The
 * import panel shows this inline ("3 self-intersections, 2 holes, 7
 * slivers — recommend full repair") so the user makes an informed
 * decision before clicking "Heal".
 *
 * Severity bands:
 *   - **block**: OCCT will refuse this mesh (non-manifold edges,
 *     self-intersections). Must heal.
 *   - **warn**:  Will work but degrades downstream (slivers, large
 *     holes). Recommended to heal.
 *   - **info**:  Cosmetic (inverted normals on a few faces). Heal
 *     optionally.
 */

import * as THREE from 'three';
import { detectSelfIntersections } from './selfIntersection';
import { detectNonManifoldEdges } from './nonManifoldRepair';
import { detectHoles } from './holeFill';
import { detectSlivers } from './sliverRemoval';

export type Severity = 'block' | 'warn' | 'info' | 'clean';

export interface DiagnosticFinding {
  code: string;
  severity: Severity;
  count: number;
  message: string;
  recommendedAction: string;
}

export interface MeshDiagnosticReport {
  findings: DiagnosticFinding[];
  overallSeverity: Severity;
  isOcctSafe: boolean;
  /** Suggested actions in execution order. */
  recommendedSteps: string[];
}

export interface DiagnosticOptions {
  /** Skip self-intersection (O(n²) cost) for big meshes. */
  skipSelfIntersection?: boolean;
  /** Sliver angle threshold (deg). */
  sliverAngleDeg?: number;
  /** Hole loop size threshold beyond which holes are considered "large". */
  largeHoleSize?: number;
}

const severityRank: Record<Severity, number> = {
  clean: 0,
  info: 1,
  warn: 2,
  block: 3,
};

export function diagnoseMesh(
  geo: THREE.BufferGeometry,
  opts: DiagnosticOptions = {},
): MeshDiagnosticReport {
  const findings: DiagnosticFinding[] = [];

  // 1. Non-manifold edges — block.
  const nmReport = detectNonManifoldEdges(geo);
  if (nmReport.nonManifoldEdges.length > 0) {
    findings.push({
      code: 'NON_MANIFOLD_EDGE',
      severity: 'block',
      count: nmReport.nonManifoldEdges.length,
      message: `${nmReport.nonManifoldEdges.length} non-manifold edge(s) (T-junctions / internal walls)`,
      recommendedAction: 'Run repairNonManifoldEdges',
    });
  }
  if (nmReport.boundaryEdges.length > 0) {
    findings.push({
      code: 'OPEN_BOUNDARY',
      severity: 'warn',
      count: nmReport.boundaryEdges.length,
      message: `${nmReport.boundaryEdges.length} open boundary edge(s) — mesh is not closed`,
      recommendedAction: 'Run fillHoles',
    });
  }

  // 2. Self-intersections — block (gated by skipSelfIntersection flag).
  if (!opts.skipSelfIntersection) {
    const siReport = detectSelfIntersections(geo);
    if (siReport.pairs.length > 0) {
      findings.push({
        code: 'SELF_INTERSECTION',
        severity: 'block',
        count: siReport.pairs.length,
        message: `${siReport.pairs.length} self-intersecting triangle pair(s)`,
        recommendedAction: 'Run repairBySelfIntersectionDeletion',
      });
    }
  }

  // 3. Holes — warn (caller may want them).
  const holes = detectHoles(geo);
  const bigThreshold = opts.largeHoleSize ?? 20;
  const largeHoles = holes.loops.filter(l => l.length > bigThreshold);
  if (holes.loops.length > 0 && largeHoles.length === 0) {
    findings.push({
      code: 'HOLE_SMALL',
      severity: 'warn',
      count: holes.loops.length,
      message: `${holes.loops.length} small hole(s) (≤ ${bigThreshold} vertices each)`,
      recommendedAction: 'Run fillHoles',
    });
  } else if (largeHoles.length > 0) {
    findings.push({
      code: 'HOLE_LARGE',
      severity: 'info',
      count: largeHoles.length,
      message: `${largeHoles.length} large hole(s) — likely intentional open surface`,
      recommendedAction: 'Inspect manually before filling',
    });
  }

  // 4. Slivers — warn.
  const slivers = detectSlivers(geo, { minAngleDeg: opts.sliverAngleDeg });
  if (slivers.length > 0) {
    findings.push({
      code: 'SLIVER',
      severity: 'warn',
      count: slivers.length,
      message: `${slivers.length} sliver triangle(s) below angle threshold`,
      recommendedAction: 'Run removeSlivers',
    });
  }

  // Rank.
  const overall = findings.reduce<Severity>(
    (acc, f) => (severityRank[f.severity] > severityRank[acc] ? f.severity : acc),
    'clean',
  );

  // Order recommended steps by severity, then by typical "fix first"
  // order (welding before fill, fill before sliver).
  const stepOrder = ['NON_MANIFOLD_EDGE', 'SELF_INTERSECTION', 'OPEN_BOUNDARY', 'HOLE_SMALL', 'SLIVER', 'HOLE_LARGE'];
  const steps = findings
    .slice()
    .sort((a, b) => stepOrder.indexOf(a.code) - stepOrder.indexOf(b.code))
    .map(f => f.recommendedAction);

  return {
    findings,
    overallSeverity: overall,
    isOcctSafe: !findings.some(f => f.severity === 'block'),
    recommendedSteps: steps,
  };
}

/** One-line human summary for the import panel. */
export function summarizeDiagnostic(report: MeshDiagnosticReport): string {
  if (report.findings.length === 0) return 'Mesh is clean.';
  const parts = report.findings.map(f => `${f.severity.toUpperCase()}: ${f.message}`);
  return parts.join(' · ');
}
