/**
 * boundaryConditions.ts — Library of FEA boundary conditions.
 *
 * NexyFab's FEA preview emits stress/displacement fields from a
 * preset of common BC types. Users describe the load case
 * ("fixed bottom, 100 N down on top") in plain UI; this module
 * translates that into node DOF constraints + nodal load vectors.
 *
 * Output is generic: a list of {nodeId, dofMask, value} entries
 * the solver can fold into its global stiffness matrix.
 */

export type BcType =
  | 'fixed'
  | 'roller'
  | 'pin'
  | 'prescribed-displacement'
  | 'distributed-load'
  | 'pressure'
  | 'gravity'
  | 'thermal-expansion';

/** DOF mask bits: 1=Ux, 2=Uy, 4=Uz, 8=Rx, 16=Ry, 32=Rz. */
export const DofMask = {
  Ux: 1, Uy: 2, Uz: 4,
  Rx: 8, Ry: 16, Rz: 32,
  Translational: 1 | 2 | 4,
  All: 0x3f,
} as const;

export interface BcNodeApplication {
  nodeId: number;
  dofMask: number;
  /** For displacement BC: prescribed value (mm). For load: force component (N). */
  value: [number, number, number];
  bcType: BcType;
}

export interface FeaNode {
  id: number;
  position: [number, number, number];
}

export interface FeaSurface {
  /** Node ids forming the surface. */
  nodeIds: number[];
  /** Area associated with each node (mm²) — typically via consistent
   *  load lumping. Sum should equal surface area. */
  nodalArea: number[];
}

/** Fixed support — clamps all 6 DOFs. */
export function applyFixed(nodes: FeaNode[]): BcNodeApplication[] {
  return nodes.map(n => ({
    nodeId: n.id,
    dofMask: DofMask.All,
    value: [0, 0, 0],
    bcType: 'fixed' as const,
  }));
}

/** Roller — constrains motion normal to the surface (axis arg). */
export function applyRoller(
  nodes: FeaNode[],
  normalAxis: 'x' | 'y' | 'z',
): BcNodeApplication[] {
  const mask = normalAxis === 'x' ? DofMask.Ux
             : normalAxis === 'y' ? DofMask.Uy
             : DofMask.Uz;
  return nodes.map(n => ({
    nodeId: n.id,
    dofMask: mask,
    value: [0, 0, 0],
    bcType: 'roller' as const,
  }));
}

/** Pin — constrains all three translations but leaves rotations free. */
export function applyPin(nodes: FeaNode[]): BcNodeApplication[] {
  return nodes.map(n => ({
    nodeId: n.id,
    dofMask: DofMask.Translational,
    value: [0, 0, 0],
    bcType: 'pin' as const,
  }));
}

/** Prescribed displacement — non-zero value enforces a specific motion. */
export function applyPrescribedDisplacement(
  nodes: FeaNode[],
  displacement: [number, number, number],
): BcNodeApplication[] {
  return nodes.map(n => ({
    nodeId: n.id,
    dofMask: DofMask.Translational,
    value: displacement,
    bcType: 'prescribed-displacement' as const,
  }));
}

/** Distributed surface load (force per unit area). Returns nodal
 *  forces obtained by lumping with the nodal area weights. */
export function applyDistributedLoad(
  surface: FeaSurface,
  forcePerArea: [number, number, number],
): BcNodeApplication[] {
  if (surface.nodeIds.length !== surface.nodalArea.length) {
    throw new Error('nodeIds and nodalArea must be same length');
  }
  return surface.nodeIds.map((nid, i) => ({
    nodeId: nid,
    dofMask: 0,
    value: [
      forcePerArea[0] * surface.nodalArea[i]!,
      forcePerArea[1] * surface.nodalArea[i]!,
      forcePerArea[2] * surface.nodalArea[i]!,
    ] as [number, number, number],
    bcType: 'distributed-load' as const,
  }));
}

/** Pressure (scalar, MPa) along the surface normal. */
export function applyPressure(
  surface: FeaSurface,
  normal: [number, number, number],
  pressureMPa: number,
): BcNodeApplication[] {
  // 1 MPa = 1 N/mm². Force = P × area × normal.
  return applyDistributedLoad(surface, [
    pressureMPa * normal[0],
    pressureMPa * normal[1],
    pressureMPa * normal[2],
  ]);
}

/** Gravity (mass per node × g vector). Inputs: each node's lumped
 *  mass and the gravity vector (default [0, 0, -9810] mm/s²). */
export function applyGravity(
  nodes: FeaNode[],
  nodalMassKg: number[],
  gravityMmS2: [number, number, number] = [0, 0, -9810],
): BcNodeApplication[] {
  if (nodes.length !== nodalMassKg.length) {
    throw new Error('nodes and nodalMassKg must be same length');
  }
  // F = m × a. mass in kg, a in mm/s², force in mN (so /1000 → N).
  return nodes.map((n, i) => ({
    nodeId: n.id,
    dofMask: 0,
    value: [
      nodalMassKg[i]! * gravityMmS2[0] / 1000,
      nodalMassKg[i]! * gravityMmS2[1] / 1000,
      nodalMassKg[i]! * gravityMmS2[2] / 1000,
    ] as [number, number, number],
    bcType: 'gravity' as const,
  }));
}

/** Thermal expansion — equivalent body load for ΔT × α × E. */
export function applyThermalExpansion(
  nodes: FeaNode[],
  deltaTempC: number,
  alphaPerC: number,
  youngsModulusMPa: number,
): BcNodeApplication[] {
  const eqStress = deltaTempC * alphaPerC * youngsModulusMPa;
  // Apply as an isotropic body load: not a true thermal solve, but
  // captures the "rule-of-thumb" displacement field for the preview.
  return nodes.map(n => ({
    nodeId: n.id,
    dofMask: 0,
    value: [eqStress, eqStress, eqStress],
    bcType: 'thermal-expansion' as const,
  }));
}

/** Merge multiple BC application lists into one. Throws on
 *  conflicting prescribed-displacement at the same node. */
export function mergeBcs(...lists: BcNodeApplication[][]): BcNodeApplication[] {
  const merged: BcNodeApplication[] = [];
  const seenDisp = new Map<number, BcNodeApplication>();
  for (const list of lists) {
    for (const bc of list) {
      if (bc.bcType === 'prescribed-displacement' || bc.bcType === 'fixed' || bc.bcType === 'pin' || bc.bcType === 'roller') {
        const prev = seenDisp.get(bc.nodeId);
        if (prev && prev.dofMask & bc.dofMask) {
          throw new Error(`Conflicting displacement BCs on node ${bc.nodeId}`);
        }
        seenDisp.set(bc.nodeId, bc);
      }
      merged.push(bc);
    }
  }
  return merged;
}
