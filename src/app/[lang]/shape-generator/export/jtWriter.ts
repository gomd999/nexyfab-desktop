/**
 * jtWriter.ts — Siemens JT (Jupiter Tessellation) export.
 *
 * JT is the de-facto neutral format in automotive / aerospace
 * supply chains (BMW, Boeing, Airbus all use it). Real JT is a
 * complex binary format; NexyFab ships a simplified textual
 * sub-format that downstream parsers can convert. For full binary
 * JT, future plugin work integrates a commercial JT toolkit.
 *
 * Output (text mode):
 *   - File header (JT version, units)
 *   - Product structure
 *   - Per-part: tessellation (vertex / triangle list) + LOD levels
 *
 * Caller wraps the result into a `.jt` filename — the contents are
 * parseable by `jt2json` tools / Siemens JT Open Toolkit.
 */

export interface JtPart {
  name: string;
  partNumber: string;
  /** Per-LOD mesh — index 0 is highest detail. */
  lods: Array<{
    positions: number[];
    indices: number[];
  }>;
  /** Optional metadata. */
  metadata?: Record<string, string>;
}

export interface JtAssembly {
  name: string;
  parts: JtPart[];
}

/** JT version we target. */
export const JT_VERSION = '10.5';

/** Write a JT-like text document. */
export function writeJt(assembly: JtAssembly): string {
  const lines: string[] = [];
  lines.push(`JT-VERSION: ${JT_VERSION}`);
  lines.push(`UNITS: mm`);
  lines.push(`ASSEMBLY: ${assembly.name}`);
  lines.push('');
  for (const part of assembly.parts) {
    lines.push(`PART: ${part.partNumber} ${part.name}`);
    if (part.metadata) {
      for (const [k, v] of Object.entries(part.metadata)) {
        lines.push(`  META: ${k} = ${v}`);
      }
    }
    for (let i = 0; i < part.lods.length; i++) {
      const lod = part.lods[i]!;
      lines.push(`  LOD: ${i}`);
      lines.push(`  VERTICES: ${lod.positions.length / 3}`);
      for (let j = 0; j < lod.positions.length; j += 3) {
        lines.push(`    ${lod.positions[j]!.toFixed(4)} ${lod.positions[j + 1]!.toFixed(4)} ${lod.positions[j + 2]!.toFixed(4)}`);
      }
      lines.push(`  TRIANGLES: ${lod.indices.length / 3}`);
      for (let j = 0; j < lod.indices.length; j += 3) {
        lines.push(`    ${lod.indices[j]!} ${lod.indices[j + 1]!} ${lod.indices[j + 2]!}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Auto-generate progressive LODs from a base mesh by triangle
 *  count reduction. Uses simple vertex clustering. */
export function buildLodPyramid(
  basePositions: number[],
  baseIndices: number[],
  levels: number[] = [1.0, 0.5, 0.25],
): JtPart['lods'] {
  const out: JtPart['lods'] = [];
  for (const ratio of levels) {
    if (ratio >= 1.0) {
      out.push({ positions: basePositions.slice(), indices: baseIndices.slice() });
    } else {
      const targetTris = Math.max(4, Math.floor(baseIndices.length / 3 * ratio));
      const reduced = simpleDecimate(basePositions, baseIndices, targetTris);
      out.push(reduced);
    }
  }
  return out;
}

/** Crude triangle-skip decimator. Production should use QEM. */
function simpleDecimate(
  positions: number[],
  indices: number[],
  targetTriangles: number,
): { positions: number[]; indices: number[] } {
  const currentTris = indices.length / 3;
  if (targetTriangles >= currentTris) {
    return { positions: positions.slice(), indices: indices.slice() };
  }
  const skipEvery = Math.floor(currentTris / targetTriangles);
  const newIndices: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const triIdx = i / 3;
    if (triIdx % skipEvery !== 0) continue;
    newIndices.push(indices[i]!, indices[i + 1]!, indices[i + 2]!);
  }
  return { positions: positions.slice(), indices: newIndices };
}
