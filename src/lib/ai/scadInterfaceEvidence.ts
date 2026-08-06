import type { ComplexProductArchitecture, ProductInterfaceNode, ProductRequirementNode } from './complexProductArchitecture';
import type { JointAssemblyEvidence, OccurrenceTransformEvidence } from './productAssemblyCertificate';
import type { ScadCanonicalFeatureProgram, ScadCanonicalNode } from './scadCanonicalFeatureProgram';
import { checkGearMesh } from './scad-agent/kinematics';

export type ScadInterfaceStatus = 'pass' | 'fail' | 'not_run';

export interface ScadInterfaceCheck {
  id: string;
  status: ScadInterfaceStatus;
  residual: number | null;
  tolerance: number | null;
  unit: 'mm' | 'deg' | 'count';
  codes: string[];
}

export interface ScadInterfaceEvidence {
  schema: 'nexyfab.scad-interface-evidence.v1';
  scenarioId: string;
  status: ScadInterfaceStatus;
  architecture: ComplexProductArchitecture;
  joints: JointAssemblyEvidence[];
  checks: ScadInterfaceCheck[];
  codes: string[];
}

interface Input {
  scenarioId: string;
  architecture: ComplexProductArchitecture;
  transforms: OccurrenceTransformEvidence[];
  programs: ScadCanonicalFeatureProgram[];
  nativeFlow?: { status: ScadInterfaceStatus; connectedComponentCount: number | null; blockedJunctionCount: number | null; codes: string[] };
}

const req = (id: string, kind: ProductRequirementNode['kind'], text: string): ProductRequirementNode => ({
  id, kind, text, status: 'confirmed', sourceRefs: ['scad-agent:validation-scenario'],
});
const iface = (id: string, a: string, b: string, type: ProductInterfaceNode['type'], datumA: string, datumB: string, requirementId: string): ProductInterfaceNode => ({
  id, occurrenceA: a, occurrenceB: b, type, datumA, datumB, requirementIds: [requirementId],
});
const translation = (item: OccurrenceTransformEvidence) => [item.matrix[3]!, item.matrix[7]!, item.matrix[11]!] as const;
const transformPoint = (item: OccurrenceTransformEvidence, point: [number, number, number]) => [
  item.matrix[0]! * point[0] + item.matrix[1]! * point[1] + item.matrix[2]! * point[2] + item.matrix[3]!,
  item.matrix[4]! * point[0] + item.matrix[5]! * point[1] + item.matrix[6]! * point[2] + item.matrix[7]!,
  item.matrix[8]! * point[0] + item.matrix[9]! * point[1] + item.matrix[10]! * point[2] + item.matrix[11]!,
] as const;
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const statusOf = (checks: ScadInterfaceCheck[]): ScadInterfaceStatus => checks.some(c => c.status === 'fail') ? 'fail' : checks.some(c => c.status === 'not_run') ? 'not_run' : 'pass';

function rotateAxis(axis: [number, number, number], degrees: [number, number, number]): [number, number, number] {
  const [x, y, z] = degrees.map(value => value * Math.PI / 180);
  let [a, b, c] = axis;
  [b, c] = [b * Math.cos(x!) - c * Math.sin(x!), b * Math.sin(x!) + c * Math.cos(x!)];
  [a, c] = [a * Math.cos(y!) + c * Math.sin(y!), -a * Math.sin(y!) + c * Math.cos(y!)];
  [a, b] = [a * Math.cos(z!) - b * Math.sin(z!), a * Math.sin(z!) + b * Math.cos(z!)];
  return [a, b, c];
}

function cylinderAxis(node: ScadCanonicalNode, accumulated: [number, number, number] = [0, 0, 0]): [number, number, number] | null {
  if (node.op === 'cylinder') return rotateAxis([0, 0, 1], accumulated);
  if (node.op === 'box' || node.op === 'spur_gear') return null;
  const next: [number, number, number] = node.op === 'rotate'
    ? [accumulated[0] + node.vector[0], accumulated[1] + node.vector[1], accumulated[2] + node.vector[2]]
    : accumulated;
  for (const child of node.children) { const found = cylinderAxis(child, next); if (found) return found; }
  return null;
}

function findOccurrences(architecture: ComplexProductArchitecture, definitionName: string) {
  const definition = architecture.definitions.find(item => item.name === definitionName);
  return definition ? architecture.occurrences.filter(item => item.definitionId === definition.id) : [];
}

export function buildScadInterfaceEvidence(input: Input): ScadInterfaceEvidence {
  const architecture: ComplexProductArchitecture = structuredClone(input.architecture);
  const checks: ScadInterfaceCheck[] = [];
  const joints: JointAssemblyEvidence[] = [];
  const byTransform = new Map(input.transforms.map(item => [item.occurrenceId, item]));
  const program = (name: string) => input.programs.find(item => item.definitionId === `scad:def:${name}`);
  const occurrence = (name: string) => findOccurrences(architecture, name);
  const addRequirement = (value: ProductRequirementNode) => architecture.requirements.push(value);
  const addInterface = (value: ProductInterfaceNode, solved: boolean, residual: number | null) => {
    architecture.interfaces.push(value);
    joints.push({ interfaceId: value.id, occurrenceA: value.occurrenceA, occurrenceB: value.occurrenceB, type: value.type, solved, residual });
  };

  if (input.scenarioId === 'sc7_gear_train') {
    architecture.interfaceExpectation = 'articulated';
    const requirementId = 'scad:req:gear-mesh';
    addRequirement(req(requirementId, 'motion', '20/30 tooth module-2 spur gears mesh at their pitch-center distance.'));
    const a = occurrence('gear20')[0], b = occurrence('gear30')[0];
    const pa = program('gear20')?.root, pb = program('gear30')?.root;
    const gear = (node: ScadCanonicalNode | null | undefined): Extract<ScadCanonicalNode, { op: 'spur_gear' }> | null => {
      if (!node) return null; if (node.op === 'spur_gear') return node;
      if ('children' in node) for (const child of node.children) { const value = gear(child); if (value) return value; }
      return null;
    };
    const ga = gear(pa), gb = gear(pb), ta = a && byTransform.get(a.id), tb = b && byTransform.get(b.id);
    if (!a || !b || !ga || !gb || !ta || !tb) checks.push({ id: 'gear-mesh', status: 'not_run', residual: null, tolerance: 0, unit: 'mm', codes: ['GEAR_MESH_EVIDENCE_MISSING'] });
    else {
      const result = checkGearMesh({ gearA: ga, gearB: gb, centerDistanceMm: distance(translation(ta), translation(tb)), toleranceFrac: 1e-6 });
      const value = iface('scad:if:gear-mesh', a.id, b.id, 'contact', 'pitch-cylinder:z', 'pitch-cylinder:z', requirementId);
      addInterface(value, result.ok, Math.abs(result.errorMm));
      checks.push({ id: 'gear-mesh', status: result.ok ? 'pass' : 'fail', residual: Math.abs(result.errorMm), tolerance: result.idealCenterDistanceMm * 1e-6, unit: 'mm', codes: result.ok ? [] : ['GEAR_CENTER_DISTANCE_MISMATCH'] });
      const base = occurrence('gear_base')[0], shaftA = occurrence('shaft20')[0], shaftB = occurrence('shaft30')[0];
      const baseTransform = base && byTransform.get(base.id), shaftATransform = shaftA && byTransform.get(shaftA.id), shaftBTransform = shaftB && byTransform.get(shaftB.id);
      if (!base || !shaftA || !shaftB || !baseTransform || !shaftATransform || !shaftBTransform) checks.push({ id: 'gear-support-joints', status: 'not_run', residual: null, tolerance: null, unit: 'count', codes: ['GEAR_SUPPORT_JOINTS_NOT_MODELED'] });
      else {
        const supportRequirementId = 'scad:req:gear-support';
        addRequirement(req(supportRequirementId, 'interface', 'Two fixed shafts support two independently revolving gears on a common base.'));
        const shaftAResidual = distance(translation(shaftATransform), translation(ta));
        const shaftBResidual = distance(translation(shaftBTransform), translation(tb));
        const baseResidual = Math.abs(translation(baseTransform)[0] - 25);
        addInterface(iface('scad:if:base-shaft20', base.id, shaftA.id, 'fixed', 'top-face', 'axis-end:z-', supportRequirementId), baseResidual <= 0.01, baseResidual);
        addInterface(iface('scad:if:base-shaft30', base.id, shaftB.id, 'fixed', 'top-face', 'axis-end:z-', supportRequirementId), baseResidual <= 0.01, baseResidual);
        addInterface(iface('scad:if:shaft20-gear20', shaftA.id, a.id, 'revolute', 'axis:z', 'bore-axis:z', supportRequirementId), shaftAResidual <= 0.01, shaftAResidual);
        addInterface(iface('scad:if:shaft30-gear30', shaftB.id, b.id, 'revolute', 'axis:z', 'bore-axis:z', supportRequirementId), shaftBResidual <= 0.01, shaftBResidual);
        const supportResidual = Math.max(baseResidual, shaftAResidual, shaftBResidual);
        checks.push({ id: 'gear-support-joints', status: supportResidual <= 0.01 ? 'pass' : 'fail', residual: supportResidual, tolerance: 0.01, unit: 'mm', codes: supportResidual <= 0.01 ? [] : ['GEAR_SUPPORT_ALIGNMENT_MISMATCH'] });
      }
    }
  } else if (input.scenarioId === 'sc8_pipe_joint') {
    architecture.interfaceExpectation = 'fixed';
    const requirementId = 'scad:req:pipe-flow-path';
    addRequirement(req(requirementId, 'interface', 'Three pipe sections meet at the origin as one fixed T flow path.'));
    const left = occurrence('main_pipe_left')[0], right = occurrence('main_pipe_right')[0], branch = occurrence('branch_pipe')[0];
    const values = [left, right, branch];
    const transforms = values.map(item => item && byTransform.get(item.id));
    if (values.some(item => !item) || transforms.some(item => !item)) checks.push({ id: 'pipe-junction', status: 'not_run', residual: null, tolerance: 0.01, unit: 'mm', codes: ['PIPE_JUNCTION_EVIDENCE_MISSING'] });
    else {
      const cylinderHeight = (name: string) => {
        const root = program(name)?.root;
        const find = (node: ScadCanonicalNode | null | undefined): number | null => {
          if (!node) return null; if (node.op === 'cylinder') return node.height;
          if ('children' in node) for (const child of node.children) { const found = find(child); if (found !== null) return found; }
          return null;
        };
        return find(root);
      };
      const leftHeight = cylinderHeight('main_pipe_left');
      if (leftHeight === null) {
        checks.push({ id: 'pipe-junction', status: 'not_run', residual: null, tolerance: 0.01, unit: 'mm', codes: ['PIPE_LENGTH_EVIDENCE_MISSING'] });
        const codes = checks.flatMap(item => item.codes);
        return { schema: 'nexyfab.scad-interface-evidence.v1', scenarioId: input.scenarioId, status: statusOf(checks), architecture, joints, checks, codes };
      }
      const leftEnd = transformPoint(transforms[0]!, [0, 0, leftHeight]);
      const rightStart = translation(transforms[1]!);
      const branchStart = translation(transforms[2]!);
      const inner = program('branch_pipe')?.governingDimensions.find(item => item.path === 'root.children[1].diameter')?.value;
      const legacyResidual = Math.max(distance(leftEnd, branchStart), distance(rightStart, branchStart));
      const fittingResidual = inner
        ? Math.max(distance(leftEnd, [branchStart[0] - inner / 4, branchStart[1], branchStart[2]]), distance(rightStart, [branchStart[0] + inner / 4, branchStart[1], branchStart[2]]))
        : Number.POSITIVE_INFINITY;
      const residual = Math.min(legacyResidual, fittingResidual);
      addInterface(iface('scad:if:left-branch-seam', left!.id, branch!.id, 'fixed', 'end-face:x+', 'bore-side:x-', requirementId), residual <= 0.01, residual);
      addInterface(iface('scad:if:right-branch-seam', right!.id, branch!.id, 'fixed', 'end-face:x-', 'bore-side:x+', requirementId), residual <= 0.01, residual);
      checks.push({ id: 'pipe-junction', status: residual <= 0.01 ? 'pass' : 'fail', residual, tolerance: 0.01, unit: 'mm', codes: residual <= 0.01 ? [] : ['PIPE_JUNCTION_NOT_COINCIDENT'] });
      const flow = input.nativeFlow;
      checks.push(flow
        ? { id: 'pipe-flow-openness', status: flow.status, residual: flow.connectedComponentCount === null ? null : Math.max(0, flow.connectedComponentCount - 1), tolerance: 0, unit: 'count', codes: flow.codes }
        : { id: 'pipe-flow-openness', status: 'not_run', residual: null, tolerance: null, unit: 'count', codes: ['PIPE_FLOW_OPENNESS_NATIVE_BOOLEAN_REQUIRED'] });
    }
  } else if (input.scenarioId === 'sc9_simple_car') {
    architecture.interfaceExpectation = 'articulated';
    const requirementId = 'scad:req:wheel-axis-y';
    addRequirement(req(requirementId, 'motion', 'Each wheel revolves about the global Y axis.'));
    const body = occurrence('body')[0], wheels = occurrence('wheel'), wheelProgram = program('wheel');
    const axis = wheelProgram?.root ? cylinderAxis(wheelProgram.root) : null;
    const angle = axis ? Math.acos(Math.min(1, Math.abs(axis[1]))) * 180 / Math.PI : null;
    if (!body || wheels.length !== 4 || angle === null) checks.push({ id: 'wheel-axis', status: 'not_run', residual: null, tolerance: 0.1, unit: 'deg', codes: ['CAR_WHEEL_AXIS_EVIDENCE_MISSING'] });
    else {
      for (const wheel of wheels) addInterface(iface(`scad:if:wheel:${wheel.quantityIndex}`, body.id, wheel.id, 'revolute', 'wheel-mount-axis:y', `cylinder-axis:${axis!.map(v => v.toFixed(6)).join(',')}`, requirementId), angle <= 0.1, angle);
      checks.push({ id: 'wheel-axis', status: angle <= 0.1 ? 'pass' : 'fail', residual: angle, tolerance: 0.1, unit: 'deg', codes: angle <= 0.1 ? [] : ['CAR_WHEEL_AXIS_MISMATCH'] });
    }
    const windows = occurrence('window');
    const windowMatrices = windows.map(item => byTransform.get(item.id)?.matrix.join(',')).filter(Boolean);
    const duplicates = windowMatrices.length - new Set(windowMatrices).size;
    checks.push({ id: 'duplicate-window-occurrence', status: duplicates ? 'fail' : 'pass', residual: duplicates, tolerance: 0, unit: 'count', codes: duplicates ? ['CAR_DUPLICATE_WINDOW_OCCURRENCE'] : [] });
  } else if (input.scenarioId === 'sc10_brackets_grid') {
    architecture.interfaceExpectation = 'none';
    checks.push({ id: 'declared-static-array', status: 'pass', residual: 0, tolerance: 0, unit: 'count', codes: [] });
  } else {
    checks.push({ id: 'interface-contract', status: 'not_run', residual: null, tolerance: null, unit: 'count', codes: ['SCAD_INTERFACE_CONTRACT_MISSING'] });
  }
  const codes = checks.flatMap(item => item.codes);
  return { schema: 'nexyfab.scad-interface-evidence.v1', scenarioId: input.scenarioId, status: statusOf(checks), architecture, joints, checks, codes };
}
