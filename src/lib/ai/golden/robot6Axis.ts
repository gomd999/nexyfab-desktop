import type { AssemblyState } from '@/lib/assembly/assemblyState';
import type { Mate } from '@/lib/assembly/mate';

export const ROBOT_REFERENCE_MANIFEST = {
  version: 1,
  sources: [
    { id: 'epson-c4', role: 'industrial_robot_geometry', inventoryPath: '참고파일들4/epson-c4-a601s-6-axis-robot-arm-1.snapshot.2.zip', allowedUse: 'evaluation' },
    { id: 'mearm', role: 'small_robot_part_decomposition', inventoryPath: '참고파일들4/mearm-robotic-arm-1.snapshot.10.zip', allowedUse: 'evaluation' },
    { id: 'cycloidal-50-1', role: 'reducer_decomposition', inventoryPath: '참고파일들4/cycloidal-gearbox-50-1-for-curtain-lift-canon-pixma-mg5540-motor-1.snapshot.58.zip', allowedUse: 'evaluation' },
    { id: 'c5055-motor', role: 'motor_decomposition', inventoryPath: '참고파일들4/surpass-hobby-c5055-brushless-motor-1.snapshot.14.zip', allowedUse: 'evaluation' },
  ],
  leakagePolicy: 'product-level split; reference assets are evaluation-only and must not enter prompt fixtures',
} as const;

export const ROBOT_6AXIS_REQUIREMENTS = {
  id: 'robot-6axis-v1', units: 'mm', declaredMobility: 6,
  performance: { payloadKg: 4, reachMm: 600, repeatabilityMm: 0.05, mounting: 'floor' },
  requiredRoles: [
    'base', 'j1_housing', 'shoulder_link', 'elbow_link', 'wrist_1', 'wrist_2', 'tool_flange',
    'motor_j1', 'motor_j2', 'motor_j3', 'motor_j4', 'motor_j5', 'motor_j6',
    'reducer_j1', 'reducer_j2', 'reducer_j3', 'reducer_j4', 'reducer_j5', 'reducer_j6',
    'bearing_set_j1', 'bearing_set_j2', 'bearing_set_j3', 'bearing_set_j4', 'bearing_set_j5', 'bearing_set_j6',
    'brake', 'encoder', 'internal_harness', 'tool_connector',
  ],
  releaseChecks: ['independent_parts', 'six_ranked_dof', 'workspace', 'singularities', 'static_interference', 'motion_interference', 'cable_bend', 'step_roundtrip'],
} as const;

const ref = (partId: string) => ({ partId, refId: 'z_axis', refKind: 'axis' as const });
const part = (id: string, z: number, fixed = false) => ({
  id, name: id, partTemplateId: id, position: { x: 0, y: 0, z },
  orientation: { x: 0, y: 0, z: 0, w: 1 }, fixed,
});
const ids = ['base', 'j1', 'j2', 'j3', 'j4', 'j5', 'j6'] as const;
const mates: Mate[] = ids.slice(1).map((id, index) => ({
  id: `joint-${index + 1}`, kind: 'hinge', a: ref(ids[index]!), b: ref(id),
  limit: { minAngleDeg: -180, maxAngleDeg: 180 },
}));

/** Minimal deterministic skeleton used to test six declared revolute joints; detailed parts remain separate in the product fixture. */
export const ROBOT_6AXIS_KINEMATIC_SKELETON: AssemblyState = {
  parts: ids.map((id, index) => part(id, index * 100, index === 0)),
  mates,
};
