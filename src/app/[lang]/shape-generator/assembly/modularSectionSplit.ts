/**
 * modularSectionSplit.ts — Split a large assembly into modular
 * sections for transport, shipping, or modular delivery.
 *
 * Common drivers:
 *   - Truck height / width limits.
 *   - Lift crane capacity (mass).
 *   - Plant aisles & door widths.
 *   - Re-assembly time at site.
 *
 * Module greedy partitions:
 *   - Each section ≤ max envelope + mass.
 *   - Prefer cuts at flange / removable joints (minimise field weld).
 *   - Reports section count + total field-joint count.
 */

export interface AssemblyNode {
  id: string;
  /** Mass (kg). */
  massKg: number;
  /** Bounding box dimensions in assembly frame. */
  envelope: { x: number; y: number; z: number };
  /** Connection edges to other nodes (with cost: lower = easier to break here). */
  connections: { to: string; jointKind: 'flange' | 'weld' | 'bolt' | 'integral'; cost: number }[];
}

export interface SplitConstraints {
  maxSectionMassKg: number;
  maxSectionLengthMm: number;
  maxSectionWidthMm: number;
  maxSectionHeightMm: number;
  /** Penalty for breaking an integral joint (forced field-weld). */
  integralPenalty: number;
}

export const DEFAULT_CONSTRAINTS: SplitConstraints = {
  maxSectionMassKg: 25000,
  maxSectionLengthMm: 12000,
  maxSectionWidthMm: 2400,
  maxSectionHeightMm: 2400,
  integralPenalty: 1000,
};

export interface Section {
  id: number;
  nodeIds: string[];
  totalMassKg: number;
  envelope: { x: number; y: number; z: number };
}

export interface SplitResult {
  sections: Section[];
  fieldJoints: { from: string; to: string; jointKind: string; cost: number }[];
  totalFieldJointCost: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function splitAssembly(nodes: AssemblyNode[], constraints: Partial<SplitConstraints> = {}): SplitResult {
  const c = { ...DEFAULT_CONSTRAINTS, ...constraints };
  const warnings: string[] = [];
  if (nodes.length === 0) return { sections: [], fieldJoints: [], totalFieldJointCost: 0, warnings };

  const remaining = new Map(nodes.map(n => [n.id, n]));
  const sections: Section[] = [];
  let nextId = 0;
  while (remaining.size > 0) {
    const [seedId, seed] = remaining.entries().next().value!;
    remaining.delete(seedId);
    const section: Section = {
      id: nextId++,
      nodeIds: [seedId],
      totalMassKg: seed.massKg,
      envelope: { ...seed.envelope },
    };
    // Greedy add connected nodes that fit.
    let added = true;
    while (added) {
      added = false;
      const candidates: AssemblyNode[] = [];
      for (const id of section.nodeIds) {
        const node = nodes.find(n => n.id === id);
        if (!node) continue;
        for (const conn of node.connections) {
          if (!remaining.has(conn.to)) continue;
          const next = remaining.get(conn.to)!;
          if (canFit(section, next, c)) candidates.push(next);
        }
      }
      // Pick lowest-cost candidate.
      candidates.sort((a, b) => sectionAddCost(a) - sectionAddCost(b));
      const cand = candidates[0];
      if (cand) {
        section.nodeIds.push(cand.id);
        section.totalMassKg += cand.massKg;
        section.envelope = mergeEnvelope(section.envelope, cand.envelope);
        remaining.delete(cand.id);
        added = true;
      }
    }
    sections.push(section);
  }

  // Find field joints: connections crossing sections.
  const nodeToSection = new Map<string, number>();
  for (const s of sections) {
    for (const id of s.nodeIds) nodeToSection.set(id, s.id);
  }
  const fieldJoints: SplitResult['fieldJoints'] = [];
  let totalCost = 0;
  for (const node of nodes) {
    for (const conn of node.connections) {
      const fromSec = nodeToSection.get(node.id);
      const toSec = nodeToSection.get(conn.to);
      if (fromSec === undefined || toSec === undefined) continue;
      if (fromSec >= toSec) continue;
      const jointCost = conn.jointKind === 'integral' ? conn.cost + c.integralPenalty : conn.cost;
      fieldJoints.push({ from: node.id, to: conn.to, jointKind: conn.jointKind, cost: jointCost });
      totalCost += jointCost;
    }
  }

  if (sections.some(s => s.totalMassKg > c.maxSectionMassKg)) {
    warnings.push('A section exceeded mass limit — algorithm could not partition further.');
  }
  return { sections, fieldJoints, totalFieldJointCost: totalCost, warnings };
}

function canFit(section: Section, node: AssemblyNode, c: SplitConstraints): boolean {
  if (section.totalMassKg + node.massKg > c.maxSectionMassKg) return false;
  const merged = mergeEnvelope(section.envelope, node.envelope);
  if (merged.x > c.maxSectionLengthMm) return false;
  if (merged.y > c.maxSectionWidthMm) return false;
  if (merged.z > c.maxSectionHeightMm) return false;
  return true;
}

function sectionAddCost(node: AssemblyNode): number {
  return node.massKg + node.envelope.x;
}

function mergeEnvelope(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
}

// ── Per-section diagnostic ────────────────────────────────────

export interface SectionDiagnostic {
  sectionId: number;
  utilisationMass: number;
  utilisationLength: number;
}

export function diagnoseSections(result: SplitResult, c: SplitConstraints = DEFAULT_CONSTRAINTS): SectionDiagnostic[] {
  return result.sections.map(s => ({
    sectionId: s.id,
    utilisationMass: (s.totalMassKg / c.maxSectionMassKg) * 100,
    utilisationLength: (s.envelope.x / c.maxSectionLengthMm) * 100,
  }));
}

// ── Summary ────────────────────────────────────────────────────

export interface SplitSummary {
  sectionCount: number;
  fieldJointCount: number;
  totalFieldJointCost: number;
  warningCount: number;
}

export function summarize(result: SplitResult): SplitSummary {
  return {
    sectionCount: result.sections.length,
    fieldJointCount: result.fieldJoints.length,
    totalFieldJointCost: result.totalFieldJointCost,
    warningCount: result.warnings.length,
  };
}
