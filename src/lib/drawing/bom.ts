/**
 * bom — Phase 4.3 of NexyFab Pro own-CAD (ADR-013).
 *
 * Bill of Materials extraction from an AssemblyState (or nested state via
 * flattenAssembly preprocessing). Groups parts by their template id and
 * counts instances. Includes optional metadata lookup (material, mass,
 * vendor part number) for the rendered table.
 *
 * Output is consumed by the drawing serializer (Phase 4.4 — DXF text table
 * + PDF rendered table) and by the rfq/quoting pipeline (existing AI code).
 *
 * Scope (Phase 4.3 minimal):
 *   - extractBom(state, metadataLookup?) → BomTable
 *   - BomTable.rows sorted by template id (stable across runs)
 *   - Optional partTemplateMetadata override gives the human-friendly
 *     row data (caller's responsibility to fetch / cache)
 *   - Suppressed parts excluded
 *
 * Out of scope (Phase 4.4+):
 *   - Cost rollup from quotes
 *   - Custom column layout / per-customer BOM template
 *   - Sub-assembly grouping (rolls up to the leaf level by default)
 */

import type { AssemblyState } from '../assembly/assemblyState';

export interface BomMetadata {
  description?: string;
  material?: string;
  /** Single-instance mass in kg. */
  mass?: number;
  vendorPartNumber?: string;
}

export interface BomRow {
  /** Stable row index, 1-based. */
  index: number;
  partTemplateId: string;
  quantity: number;
  description?: string;
  material?: string;
  /** Total mass (single-instance mass × quantity). undefined if unknown. */
  totalMass?: number;
  vendorPartNumber?: string;
}

export interface BomTable {
  rows: ReadonlyArray<BomRow>;
  /** Total number of part instances (sum of quantities). */
  totalInstances: number;
  /** Sum of `totalMass` across rows that have it. undefined if any row is missing. */
  totalMass?: number;
}

export type BomMetadataLookup = (partTemplateId: string) => BomMetadata | undefined;

/**
 * Build a BOM from the parts of an AssemblyState. Suppressed-equivalent
 * state isn't a part-level concept (it's a mate concept), so this just
 * counts every PartInstance.
 */
export function extractBom(
  state: AssemblyState,
  lookup?: BomMetadataLookup,
): BomTable {
  const counts = new Map<string, number>();
  for (const part of state.parts) {
    counts.set(part.partTemplateId, (counts.get(part.partTemplateId) ?? 0) + 1);
  }
  const sortedIds = [...counts.keys()].sort();
  let totalInstances = 0;
  let totalMassAcc = 0;
  let allRowsHaveMass = true;
  const rows: BomRow[] = sortedIds.map((id, i) => {
    const qty = counts.get(id)!;
    totalInstances += qty;
    const meta = lookup?.(id);
    const mass = meta?.mass;
    const totalMass = mass !== undefined ? mass * qty : undefined;
    if (totalMass !== undefined) totalMassAcc += totalMass;
    else allRowsHaveMass = false;
    return {
      index: i + 1,
      partTemplateId: id,
      quantity: qty,
      description: meta?.description,
      material: meta?.material,
      totalMass,
      vendorPartNumber: meta?.vendorPartNumber,
    };
  });
  return {
    rows,
    totalInstances,
    totalMass: allRowsHaveMass && rows.length > 0 ? totalMassAcc : undefined,
  };
}
