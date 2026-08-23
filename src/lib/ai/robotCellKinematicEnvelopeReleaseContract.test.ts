import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assessRobotCellRelease, parseRobotCellOutput, ROBOT_CELL_KINEMATIC_EXCHANGE_SCHEMA, type RobotCellReleaseInputV1, validateRobotCellKinematicRelease, verifyRobotCellReadback } from './robotCellKinematicEnvelopeReleaseContract';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function fixture(): RobotCellReleaseInputV1 {
  const content = JSON.stringify({ schema: ROBOT_CELL_KINEMATIC_EXCHANGE_SCHEMA, revision: 6, sourceWorkspaceId: 'workspace-robot-1', sourceModelId: 'robot-model-1', sourceModelSha256: hash('robot-model'), sourceLibrarySha256: hash('robot-library'), sourceRawArtifactSha256: hash('robot-raw'), sourceContentHash: hash('robot-content'), robotIds: ['robot-1'], linkIds: ['link-base', 'link-arm-1', 'link-arm-2'], jointIds: ['joint-1', 'joint-2'], toolIds: ['tool-1'], fixtureIds: ['fixture-1'], operationIds: ['operation-1'] });
  return {
    schema: 'nexyfab.robot-cell-kinematic-release.v1', units: 'mm-deg-kg', revision: 6,
    source: { workspaceId: 'workspace-robot-1', modelId: 'robot-model-1', modelPath: 'models/robot.step', modelSha256: hash('robot-model'), librarySha256: hash('robot-library'), rawArtifactSha256: hash('robot-raw'), contentHash: hash('robot-content'), revisionSha256: hash('robot-revision-6'), revision: 6 },
    robots: [{ id: 'robot-1', baseLinkId: 'link-base', linkIds: ['link-base', 'link-arm-1', 'link-arm-2'], jointIds: ['joint-1', 'joint-2'], toolIds: ['tool-1'], operationIds: ['operation-1'] }],
    links: [
      { id: 'link-base', lengthMm: 100, collisionRadiusMm: 20, childJointIds: ['joint-1'] },
      { id: 'link-arm-1', lengthMm: 100, collisionRadiusMm: 20, parentJointId: 'joint-1', childJointIds: ['joint-2'] },
      { id: 'link-arm-2', lengthMm: 80, collisionRadiusMm: 20, parentJointId: 'joint-2', childJointIds: [] },
    ],
    joints: [
      { id: 'joint-1', parentLinkId: 'link-base', childLinkId: 'link-arm-1', type: 'revolute', originMm: { xMm: 0, yMm: 0, zMm: 0 }, axis: { xMm: 0, yMm: 0, zMm: 1 }, minValue: -90, maxValue: 90 },
      { id: 'joint-2', parentLinkId: 'link-arm-1', childLinkId: 'link-arm-2', type: 'revolute', originMm: { xMm: 0, yMm: 0, zMm: 0 }, axis: { xMm: 0, yMm: 0, zMm: 1 }, minValue: -120, maxValue: 120 },
    ],
    tools: [{ id: 'tool-1', linkId: 'link-arm-2', tipOffsetMm: { xMm: 0, yMm: 0, zMm: 50 }, payloadKg: 2 }],
    fixtures: [{ id: 'fixture-1', originMm: { xMm: 500, yMm: 500, zMm: 0 }, widthMm: 100, depthMm: 100, heightMm: 100, clearanceMm: 10 }],
    operations: [{ id: 'operation-1', robotId: 'robot-1', jointIds: ['joint-1', 'joint-2'], sampleValues: [[0, 0]], toolId: 'tool-1', fixtureIds: ['fixture-1'], envelope: { minMm: { xMm: -20, yMm: -20, zMm: -20 }, maxMm: { xMm: 300, yMm: 20, zMm: 50 } } }],
    output: { format: 'nexyfab-exchange-json', targetFormat: 'urdf-neutral', revision: 6, content, bytes: Buffer.byteLength(content), sha256: hash(content) },
  };
}

describe('robot-cell kinematic envelope release contract', () => {
  it('validates serial chain, sampled envelope and actual output readback', () => { const input = fixture(); expect(validateRobotCellKinematicRelease(input)).toEqual({ valid: true, issues: [] }); const readback = parseRobotCellOutput(input); expect(verifyRobotCellReadback(input, readback)).toEqual({ valid: true, issues: [] }); const assessment = assessRobotCellRelease(input, readback); expect(assessment.releaseReady).toBe(false); expect(assessment.blockers).toContain('native_step_urdf_parser_not_verified'); });
  it('fails closed for limits, ownership, envelope and collision', () => { const broken = clone(fixture()); broken.joints[0]!.axis = { xMm: 1, yMm: 0, zMm: 0 }; broken.links[1]!.parentJointId = 'joint-2'; broken.operations[0]!.sampleValues = [[999, 0]]; broken.operations[0]!.envelope.maxMm.xMm = 999; broken.fixtures[0]!.originMm = { xMm: 0, yMm: 0, zMm: 0 }; const issues = validateRobotCellKinematicRelease(broken).issues; expect(issues).toEqual(expect.arrayContaining(['joint_chain_ownership_or_limits_invalid:joint-1', 'operation_invalid_or_dangling:operation-1'])); });
  it('rejects hash-valid forged output and parser tamper', () => { const input = fixture(); const readback = parseRobotCellOutput(input); const tampered = clone(readback); tampered.outputSha256 = hash('tampered'); expect(verifyRobotCellReadback(input, tampered).valid).toBe(false); const forged = clone(input); const payload = JSON.parse(forged.output.content) as { operationIds: string[] }; payload.operationIds = ['forged']; forged.output.content = JSON.stringify(payload); forged.output.bytes = Buffer.byteLength(forged.output.content); forged.output.sha256 = hash(forged.output.content); expect(validateRobotCellKinematicRelease(forged).issues).toContain('output_readback_invalid'); });
  it('does not infer tool or operation ownership from a valid global registry', () => { const broken = clone(fixture()); broken.operations[0]!.toolId = 'missing-tool'; expect(validateRobotCellKinematicRelease(broken).issues).toContain('operation_invalid_or_dangling:operation-1'); const detached = clone(fixture()); detached.robots[0]!.toolIds = []; expect(validateRobotCellKinematicRelease(detached).issues).toContain('operation_invalid_or_dangling:operation-1'); const assessment = assessRobotCellRelease(fixture(), parseRobotCellOutput(fixture())); expect(assessment.internalParserVerified).toBe(true); expect(assessment.independentAttestationVerified).toBe(false); expect(assessment.parserVerified).toBe(false); expect(assessment.blockers).toContain('independent_parser_attestation_required'); });
  it('includes negative-direction/tool geometry and fixture clearance in collision assessment', () => { const input = clone(fixture()); input.fixtures[0]!.originMm = { xMm: 250, yMm: 0, zMm: 0 }; input.fixtures[0]!.clearanceMm = 100; expect(validateRobotCellKinematicRelease(input).issues).toContain('fixture_collision:operation-1:fixture-1'); const forged = clone(fixture()); forged.operations[0]!.envelope.maxMm.yMm = 120; expect(validateRobotCellKinematicRelease(forged).issues).toContain('operation_envelope_mismatch:operation-1'); });
  it('rejects a robot registry that omits a traversed link', () => { const input = clone(fixture()); input.robots[0]!.linkIds = ['link-base', 'link-arm-1']; expect(validateRobotCellKinematicRelease(input).issues).toContain('robot_chain_registry_invalid:robot-1'); });
  it('does not throw on malformed collections', () => { const malformed = clone(fixture()) as unknown as Record<string, unknown>; malformed.robots = null; malformed.links = null; malformed.joints = null; expect(() => validateRobotCellKinematicRelease(malformed as unknown as RobotCellReleaseInputV1)).not.toThrow(); expect(validateRobotCellKinematicRelease(malformed as unknown as RobotCellReleaseInputV1).valid).toBe(false); });
});
