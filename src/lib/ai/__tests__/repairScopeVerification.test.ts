import { describe, expect, it } from 'vitest';
import { generateRobot6Axis } from '../robot/robotGenerator';
import { ROBOT_6AXIS_DEMONSTRATOR_SPEC } from '../robot/robotDemonstrator';
import { isRuntimeIssuedRepairScopeVerification, verifyRepairScope } from '../repairScopeVerification';

const program = () => generateRobot6Axis(ROBOT_6AXIS_DEMONSTRATOR_SPEC).program;

describe('repair scope verification', () => {
  it('accepts only the permitted part FeatureTree change and reports exact hashes', () => {
    const before = program();
    const after = structuredClone(before);
    const id = after.parts[0]!.instanceId;
    after.parts[0]!.featureTree.nodes[0]!.name = 'repair-one-node';
    const result = verifyRepairScope({ before, after, permittedPartIds: [id] });
    expect(result).toMatchObject({ passed: true, changedPartIds: [id], errors: [] });
    expect(result.beforeProgramSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.afterProgramSha256).not.toBe(result.beforeProgramSha256);
    expect(isRuntimeIssuedRepairScopeVerification(result)).toBe(true);
  });

  it('detects collateral edits to a verified unrelated part', () => {
    const before = program();
    const after = structuredClone(before);
    const permitted = after.parts[0]!.instanceId;
    after.parts[1]!.featureTree.nodes[0]!.name = 'collateral-edit';
    const result = verifyRepairScope({ before, after, permittedPartIds: [permitted] });
    expect(result.passed).toBe(false);
    expect(result.errors).toContain(`Unpermitted part changed: ${after.parts[1]!.instanceId}.`);
  });

  it('blocks part removal, hierarchy collapse, metadata substitution and unapproved mate edits', () => {
    const before = program();
    const after = structuredClone(before);
    const id = after.parts[0]!.instanceId;
    after.parts.pop();
    after.assembly = {
      ...after.assembly,
      parts: after.assembly.parts.slice(0, -1),
      mates: after.assembly.mates.map((mate, index) => index === 0 ? { ...mate, suppressed: !mate.suppressed } : mate),
    };
    after.structure = [];
    after.parts[0]!.metadata.material = 'cheaper substitute';
    const result = verifyRepairScope({ before, after, permittedPartIds: [id] });
    expect(result.passed).toBe(false);
    expect(result.errors.join(' ')).toMatch(/inventory changed|metadata|Global product intent|Unpermitted mate/);
  });

  it('does not trust a serialized lookalike as server verification', () => {
    const before = program();
    const after = structuredClone(before);
    const result = verifyRepairScope({ before, after, permittedPartIds: [after.parts[0]!.instanceId] });
    expect(isRuntimeIssuedRepairScopeVerification(JSON.parse(JSON.stringify(result)))).toBe(false);
  });
});
