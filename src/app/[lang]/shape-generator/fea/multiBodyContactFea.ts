import { TopologyGrid, buildHex8K0 } from '../analysis/topology3D';

export interface MultiBodyHexBody {
  id: string;
  grid: TopologyGrid;
  youngsModulusMpa: number;
  poissonRatio: number;
  cellMm: number;
}

export interface MultiBodyNodeCondition {
  bodyId: string;
  nodeId: number;
  axes: Array<0 | 1 | 2>;
}

export interface MultiBodyNodeLoad {
  bodyId: string;
  nodeId: number;
  forceN: [number, number, number];
}

export interface MultiBodyContactConstraint {
  id: string;
  bodyA: string;
  nodeA: number;
  bodyB: string;
  nodeB: number;
  normalAxis: 0 | 1 | 2;
  /** Maximum relative displacement uA-uB before contact engages. */
  initialGapMm: number;
  penaltyStiffnessNPerMm: number;
}

export interface MultiBodyPreload {
  id: string;
  bodyA: string;
  nodeA: number;
  bodyB: string;
  nodeB: number;
  axis: 0 | 1 | 2;
  forceN: number;
}

export interface MultiBodyContactFeaInput {
  bodies: MultiBodyHexBody[];
  fixed: MultiBodyNodeCondition[];
  loads: MultiBodyNodeLoad[];
  contacts: MultiBodyContactConstraint[];
  preloads?: MultiBodyPreload[];
  maxActiveIterations?: number;
  maxLinearIterations?: number;
  relativeTolerance?: number;
  contactToleranceMm?: number;
}

export interface MultiBodyContactFeaResult {
  converged: boolean;
  linearConverged: boolean;
  activeSetConverged: boolean;
  nonlinearIterations: number;
  linearIterations: number;
  equilibriumResidualRatio: number;
  displacement: Float64Array;
  maxDisplacementMm: number;
  maxVonMisesMpa: number;
  contacts: Array<{ id: string; active: boolean; relativeDisplacementMm: number; penetrationMm: number; normalForceN: number }>;
  preloads: Array<{ id: string; forceN: number }>;
  bodyDofOffsets: Record<string, number>;
}

interface PreparedBody extends MultiBodyHexBody { offset: number; k0: Float64Array }
interface PreparedContact extends MultiBodyContactConstraint { dofA: number; dofB: number }

const dot = (a: Float64Array, b: Float64Array): number => {
  let sum = 0;
  for (let index = 0; index < a.length; index++) sum += a[index]! * b[index]!;
  return sum;
};

function validateInput(input: MultiBodyContactFeaInput): void {
  if (!input.bodies.length) throw new Error('MULTIBODY_BODY_REQUIRED');
  const ids = new Set<string>();
  for (const body of input.bodies) {
    if (!body.id.trim() || ids.has(body.id) || body.grid.nElems <= 0 || !Number.isFinite(body.youngsModulusMpa)
      || body.youngsModulusMpa <= 0 || !Number.isFinite(body.poissonRatio) || body.poissonRatio <= -1
      || body.poissonRatio >= 0.5 || !Number.isFinite(body.cellMm) || body.cellMm <= 0) throw new Error(`INVALID_MULTIBODY_BODY:${body.id}`);
    ids.add(body.id);
  }
  const bodyById = new Map(input.bodies.map(body => [body.id, body]));
  const validNode = (bodyId: string, node: number) => {
    const body = bodyById.get(bodyId);
    return !!body && Number.isSafeInteger(node) && node >= 0 && node < body.grid.nNodes;
  };
  for (const fixed of input.fixed) if (!validNode(fixed.bodyId, fixed.nodeId) || !fixed.axes.length) throw new Error('INVALID_MULTIBODY_FIXED');
  for (const load of input.loads) if (!validNode(load.bodyId, load.nodeId) || !load.forceN.every(Number.isFinite)) throw new Error('INVALID_MULTIBODY_LOAD');
  const contactIds = new Set<string>();
  for (const contact of input.contacts) {
    if (!contact.id.trim() || contactIds.has(contact.id) || contact.bodyA === contact.bodyB
      || !validNode(contact.bodyA, contact.nodeA) || !validNode(contact.bodyB, contact.nodeB)
      || !Number.isFinite(contact.initialGapMm) || !Number.isFinite(contact.penaltyStiffnessNPerMm)
      || contact.penaltyStiffnessNPerMm <= 0) throw new Error(`INVALID_MULTIBODY_CONTACT:${contact.id}`);
    contactIds.add(contact.id);
  }
  for (const preload of input.preloads ?? []) if (!preload.id.trim() || preload.bodyA === preload.bodyB
    || !validNode(preload.bodyA, preload.nodeA) || !validNode(preload.bodyB, preload.nodeB)
    || !Number.isFinite(preload.forceN) || preload.forceN <= 0) throw new Error(`INVALID_MULTIBODY_PRELOAD:${preload.id}`);
}

function applyBodyStiffness(body: PreparedBody, x: Float64Array, out: Float64Array): void {
  const edof = new Int32Array(24);
  const scale = body.youngsModulusMpa * body.cellMm;
  for (let ez = 0; ez < body.grid.nz; ez++) for (let ey = 0; ey < body.grid.ny; ey++) for (let ex = 0; ex < body.grid.nx; ex++) {
    const nodes = body.grid.elemNodes(ex, ey, ez);
    for (let index = 0; index < 8; index++) {
      const base = body.offset + nodes[index]! * 3;
      edof[index * 3] = base; edof[index * 3 + 1] = base + 1; edof[index * 3 + 2] = base + 2;
    }
    for (let row = 0; row < 24; row++) {
      let value = 0;
      for (let column = 0; column < 24; column++) value += body.k0[row * 24 + column]! * x[edof[column]!]!;
      out[edof[row]!] += scale * value;
    }
  }
}

function buildDiagonal(bodies: PreparedBody[], contacts: PreparedContact[], active: Set<string>, fixed: Uint8Array, nDof: number): Float64Array {
  const diagonal = new Float64Array(nDof);
  for (const body of bodies) {
    const scale = body.youngsModulusMpa * body.cellMm;
    for (let ez = 0; ez < body.grid.nz; ez++) for (let ey = 0; ey < body.grid.ny; ey++) for (let ex = 0; ex < body.grid.nx; ex++) {
      const nodes = body.grid.elemNodes(ex, ey, ez);
      for (let localNode = 0; localNode < 8; localNode++) for (let axis = 0; axis < 3; axis++) {
        const localDof = localNode * 3 + axis;
        diagonal[body.offset + nodes[localNode]! * 3 + axis] += scale * body.k0[localDof * 24 + localDof]!;
      }
    }
  }
  for (const contact of contacts) if (active.has(contact.id)) {
    diagonal[contact.dofA] += contact.penaltyStiffnessNPerMm;
    diagonal[contact.dofB] += contact.penaltyStiffnessNPerMm;
  }
  for (let dof = 0; dof < nDof; dof++) if (fixed[dof] || diagonal[dof] <= 0) diagonal[dof] = 1;
  return diagonal;
}

function centerVonMises(body: PreparedBody, displacement: Float64Array): number {
  const E = body.youngsModulusMpa, nu = body.poissonRatio;
  const lambda = E * nu / ((1 + nu) * (1 - 2 * nu));
  const mu = E / (2 * (1 + nu));
  const signs: ReadonlyArray<readonly [number, number, number]> = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  let maximum = 0;
  for (let ez = 0; ez < body.grid.nz; ez++) for (let ey = 0; ey < body.grid.ny; ey++) for (let ex = 0; ex < body.grid.nx; ex++) {
    const nodes = body.grid.elemNodes(ex, ey, ez);
    let exx = 0, eyy = 0, ezz = 0, gxy = 0, gyz = 0, gxz = 0;
    for (let index = 0; index < 8; index++) {
      const [sx, sy, sz] = signs[index]!;
      const dnx = sx / (4 * body.cellMm), dny = sy / (4 * body.cellMm), dnz = sz / (4 * body.cellMm);
      const base = body.offset + nodes[index]! * 3;
      const ux = displacement[base]!, uy = displacement[base + 1]!, uz = displacement[base + 2]!;
      exx += dnx * ux; eyy += dny * uy; ezz += dnz * uz;
      gxy += dny * ux + dnx * uy; gyz += dnz * uy + dny * uz; gxz += dnz * ux + dnx * uz;
    }
    const trace = exx + eyy + ezz;
    const sxx = lambda * trace + 2 * mu * exx, syy = lambda * trace + 2 * mu * eyy, szz = lambda * trace + 2 * mu * ezz;
    const txy = mu * gxy, tyz = mu * gyz, txz = mu * gxz;
    const vm = Math.sqrt(0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2) + 3 * (txy ** 2 + tyz ** 2 + txz ** 2));
    maximum = Math.max(maximum, vm);
  }
  return maximum;
}

export function solveMultiBodyContactFea(input: MultiBodyContactFeaInput): MultiBodyContactFeaResult {
  validateInput(input);
  let offset = 0;
  const bodies: PreparedBody[] = input.bodies.map(body => {
    const prepared = { ...body, offset, k0: buildHex8K0(body.poissonRatio) };
    offset += body.grid.nNodes * 3;
    return prepared;
  });
  const bodyById = new Map(bodies.map(body => [body.id, body]));
  const nDof = offset, fixed = new Uint8Array(nDof), force = new Float64Array(nDof);
  const dof = (bodyId: string, nodeId: number, axis: number) => bodyById.get(bodyId)!.offset + nodeId * 3 + axis;
  for (const condition of input.fixed) for (const axis of condition.axes) fixed[dof(condition.bodyId, condition.nodeId, axis)] = 1;
  for (const load of input.loads) for (let axis = 0; axis < 3; axis++) force[dof(load.bodyId, load.nodeId, axis)] += load.forceN[axis]!;
  for (const preload of input.preloads ?? []) {
    force[dof(preload.bodyA, preload.nodeA, preload.axis)] += preload.forceN;
    force[dof(preload.bodyB, preload.nodeB, preload.axis)] -= preload.forceN;
  }
  const contacts: PreparedContact[] = input.contacts.map(contact => ({
    ...contact, dofA: dof(contact.bodyA, contact.nodeA, contact.normalAxis), dofB: dof(contact.bodyB, contact.nodeB, contact.normalAxis),
  }));
  const active = new Set(contacts.filter(contact => contact.initialGapMm <= 0).map(contact => contact.id));
  const maxActive = input.maxActiveIterations ?? 30, maxLinear = input.maxLinearIterations ?? Math.max(600, nDof * 3);
  const relativeTolerance = input.relativeTolerance ?? 1e-9, contactTolerance = input.contactToleranceMm ?? 1e-7;
  let displacement = new Float64Array(nDof), linearIterations = 0, linearConverged = false, activeSetConverged = false, nonlinearIterations = 0;

  const apply = (x: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (const body of bodies) applyBodyStiffness(body, x, out);
    for (const contact of contacts) if (active.has(contact.id)) {
      const relative = x[contact.dofA]! - x[contact.dofB]!;
      const value = contact.penaltyStiffnessNPerMm * relative;
      out[contact.dofA] += value; out[contact.dofB] -= value;
    }
    for (let index = 0; index < nDof; index++) if (fixed[index]) out[index] = x[index]!;
  };

  for (let outer = 0; outer < maxActive; outer++) {
    nonlinearIterations = outer + 1;
    const rhs = force.slice();
    for (const contact of contacts) if (active.has(contact.id)) {
      rhs[contact.dofA] += contact.penaltyStiffnessNPerMm * contact.initialGapMm;
      rhs[contact.dofB] -= contact.penaltyStiffnessNPerMm * contact.initialGapMm;
    }
    for (let index = 0; index < nDof; index++) if (fixed[index]) rhs[index] = 0;
    const diagonal = buildDiagonal(bodies, contacts, active, fixed, nDof);
    const x = new Float64Array(nDof), r = rhs.slice(), z = new Float64Array(nDof), direction = new Float64Array(nDof), product = new Float64Array(nDof);
    for (let index = 0; index < nDof; index++) z[index] = r[index]! / diagonal[index]!;
    direction.set(z);
    let rz = dot(r, z);
    const rhsNorm2 = Math.max(dot(rhs, rhs), 1e-30);
    linearConverged = false;
    for (let iteration = 0; iteration < maxLinear; iteration++) {
      linearIterations = iteration + 1;
      apply(direction, product);
      const denominator = dot(direction, product);
      if (!Number.isFinite(denominator) || denominator <= 0) break;
      const alpha = rz / denominator;
      for (let index = 0; index < nDof; index++) { x[index] += alpha * direction[index]!; r[index] -= alpha * product[index]!; }
      if (dot(r, r) / rhsNorm2 <= relativeTolerance ** 2) { linearConverged = true; break; }
      for (let index = 0; index < nDof; index++) z[index] = r[index]! / diagonal[index]!;
      const nextRz = dot(r, z), beta = nextRz / Math.max(rz, 1e-30);
      for (let index = 0; index < nDof; index++) direction[index] = z[index]! + beta * direction[index]!;
      rz = nextRz;
    }
    displacement = x;
    let changed = false;
    for (const contact of contacts) {
      const relative = displacement[contact.dofA]! - displacement[contact.dofB]!;
      const penetration = relative - contact.initialGapMm;
      if (!active.has(contact.id) && penetration > contactTolerance) { active.add(contact.id); changed = true; }
      else if (active.has(contact.id) && penetration < -contactTolerance) { active.delete(contact.id); changed = true; }
    }
    if (!changed) { activeSetConverged = true; break; }
  }
  const residual = new Float64Array(nDof); apply(displacement, residual);
  const effectiveForce = force.slice();
  for (const contact of contacts) if (active.has(contact.id)) {
    effectiveForce[contact.dofA] += contact.penaltyStiffnessNPerMm * contact.initialGapMm;
    effectiveForce[contact.dofB] -= contact.penaltyStiffnessNPerMm * contact.initialGapMm;
  }
  let residual2 = 0, force2 = 0;
  for (let index = 0; index < nDof; index++) if (!fixed[index]) {
    residual2 += (residual[index]! - effectiveForce[index]!) ** 2;
    force2 += effectiveForce[index]! ** 2;
  }
  let maxDisplacementMm = 0;
  for (let index = 0; index < nDof; index += 3) maxDisplacementMm = Math.max(maxDisplacementMm, Math.hypot(displacement[index]!, displacement[index + 1]!, displacement[index + 2]!));
  const contactResults = contacts.map(contact => {
    const relativeDisplacementMm = displacement[contact.dofA]! - displacement[contact.dofB]!;
    const penetrationMm = Math.max(0, relativeDisplacementMm - contact.initialGapMm);
    return { id: contact.id, active: active.has(contact.id), relativeDisplacementMm, penetrationMm, normalForceN: active.has(contact.id) ? contact.penaltyStiffnessNPerMm * penetrationMm : 0 };
  });
  const equilibriumResidualRatio = Math.sqrt(residual2 / Math.max(force2, 1e-30));
  return {
    converged: linearConverged && activeSetConverged && Number.isFinite(equilibriumResidualRatio),
    linearConverged, activeSetConverged, nonlinearIterations, linearIterations, equilibriumResidualRatio,
    displacement, maxDisplacementMm, maxVonMisesMpa: Math.max(...bodies.map(body => centerVonMises(body, displacement))),
    contacts: contactResults,
    preloads: (input.preloads ?? []).map(preload => ({ id: preload.id, forceN: preload.forceN })),
    bodyDofOffsets: Object.fromEntries(bodies.map(body => [body.id, body.offset])),
  };
}
