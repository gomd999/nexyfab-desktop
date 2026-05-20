/**
 * feaExport.ts — Export the NexyFab FEA problem definition into
 * formats consumed by external FEA solvers.
 *
 * Positioning per `nexyfab-gtm` memory: NexyFab ships only preview-
 * grade analysis. The serious solve happens in Ansys / Comsol / Code_Aster.
 * This module emits:
 *
 *   - **NASTRAN-style BDF** (`.nas` / `.bdf`): the "lowest common
 *     denominator" — every commercial FEA package imports it. We
 *     emit the simplest possible card subset (CTETRA4 elements +
 *     PSOLID + MAT1 + SPC + FORCE).
 *   - **OnShape-style JSON**: structured payload matching OnShape's
 *     simulation feature spec. Useful when the user wants to round-
 *     trip back to a hosted CAD for refinement.
 *
 * Inputs are deliberately minimal — vertex array, tetrahedral
 * connectivity, material id, list of constraint + load assignments.
 * We don't attempt to invent solver-specific quirks; the user is
 * expected to validate the exported deck on the receiving end.
 */

import { getMaterialPreset } from '../materials';

export interface FeaConstraint {
  /** Vertex (node) indices that are constrained. */
  nodeIndices: number[];
  /** DOFs to restrain. 'all' = fully fixed, '123' = translations only. */
  dofs: 'all' | '123' | '456';
}

export interface FeaLoad {
  /** Vertex (node) indices that receive the load. */
  nodeIndices: number[];
  /** Force vector (N). */
  force: [number, number, number];
}

export interface FeaProblem {
  vertices: Float32Array;
  /** 4 vertex indices per tetrahedral element. */
  tetrahedra: Uint32Array;
  materialId: string;
  constraints: FeaConstraint[];
  loads: FeaLoad[];
}

/** Format a number for NASTRAN's 8-character field width. */
function nas8(n: number): string {
  // Engineering notation for tiny / huge magnitudes; fixed for sane range.
  const abs = Math.abs(n);
  let s: string;
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) {
    s = n.toExponential(2).replace('e', 'E');
  } else {
    s = n.toFixed(4);
  }
  if (s.length > 8) s = s.slice(0, 8);
  return s.padStart(8);
}

/** Format an integer for NASTRAN's 8-char field. */
function nasI(n: number): string {
  return String(Math.round(n)).padStart(8);
}

/** Build a NASTRAN BDF deck (text). One-shot, no streaming. */
export function exportNastranBdf(problem: FeaProblem): string {
  const lines: string[] = [];
  lines.push('$ NexyFab FEA preview export');
  lines.push('$ Validate this deck on the receiving solver before use.');
  lines.push('BEGIN BULK');

  // Material card: density / Young / Poisson from the catalogue.
  const mat = getMaterialPreset(problem.materialId);
  const young = (mat?.youngsModulus ?? 200) * 1000;       // GPa → MPa
  const poisson = mat?.poissonRatio ?? 0.3;
  const density = (mat?.density ?? 7.85) * 1e-9;          // g/cm³ → kg/mm³
  lines.push(`MAT1    ${nasI(1)}${nas8(young)}        ${nas8(poisson)}${nas8(density)}`);

  // Property card linking material to element set.
  lines.push(`PSOLID  ${nasI(1)}${nasI(1)}`);

  // Node cards (GRID).
  const v = problem.vertices;
  for (let i = 0; i < v.length / 3; i++) {
    const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
    lines.push(`GRID    ${nasI(i + 1)}        ${nas8(x)}${nas8(y)}${nas8(z)}`);
  }

  // Element cards (CTETRA).
  const t = problem.tetrahedra;
  for (let e = 0; e < t.length / 4; e++) {
    const n1 = t[e * 4] + 1;
    const n2 = t[e * 4 + 1] + 1;
    const n3 = t[e * 4 + 2] + 1;
    const n4 = t[e * 4 + 3] + 1;
    lines.push(`CTETRA  ${nasI(e + 1)}${nasI(1)}${nasI(n1)}${nasI(n2)}${nasI(n3)}${nasI(n4)}`);
  }

  // SPC (single-point-constraint) cards.
  let spcId = 1;
  for (const c of problem.constraints) {
    const dofs = c.dofs === 'all' ? '123456' : c.dofs;
    for (const ni of c.nodeIndices) {
      lines.push(`SPC1    ${nasI(spcId)}${dofs.padStart(8)}${nasI(ni + 1)}`);
    }
    spcId++;
  }

  // FORCE cards.
  let loadId = 100;
  for (const ld of problem.loads) {
    const mag = Math.hypot(ld.force[0], ld.force[1], ld.force[2]);
    if (mag === 0) continue;
    const dirX = ld.force[0] / mag;
    const dirY = ld.force[1] / mag;
    const dirZ = ld.force[2] / mag;
    for (const ni of ld.nodeIndices) {
      lines.push(
        `FORCE   ${nasI(loadId)}${nasI(ni + 1)}        ${nas8(mag)}${nas8(dirX)}${nas8(dirY)}${nas8(dirZ)}`,
      );
    }
    loadId++;
  }

  lines.push('ENDDATA');
  return lines.join('\n');
}

/** Build a structured JSON payload for OnShape-style external solve. */
export function exportOnshapeJson(problem: FeaProblem): string {
  const mat = getMaterialPreset(problem.materialId);
  const payload = {
    schema: 'nexyfab.fea/onshape-bridge.v1',
    material: {
      id: problem.materialId,
      youngsModulusGpa: mat?.youngsModulus ?? null,
      poissonRatio: mat?.poissonRatio ?? null,
      densityGCm3: mat?.density ?? null,
      yieldStrengthMpa: mat?.yieldStrength ?? null,
    },
    mesh: {
      vertexCount: problem.vertices.length / 3,
      tetrahedronCount: problem.tetrahedra.length / 4,
      vertices: Array.from(problem.vertices),
      tetrahedra: Array.from(problem.tetrahedra),
    },
    boundaryConditions: {
      constraints: problem.constraints.map(c => ({
        nodes: c.nodeIndices,
        dofs: c.dofs === 'all' ? [1, 2, 3, 4, 5, 6] : c.dofs.split('').map(Number),
      })),
      loads: problem.loads.map(ld => ({
        nodes: ld.nodeIndices,
        forceN: ld.force,
      })),
    },
    notes: 'Preview-grade FEA from NexyFab; validate before production decisions.',
  };
  return JSON.stringify(payload, null, 2);
}
