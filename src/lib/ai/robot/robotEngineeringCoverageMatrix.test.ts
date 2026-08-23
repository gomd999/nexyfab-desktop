import { describe, expect, it } from 'vitest';
import { buildRobotEngineeringCoverageMatrixFixture } from './robotEngineeringCoverageMatrix.testFixture';
import { evaluateRobotEngineeringCoverageMatrix } from './robotEngineeringCoverageMatrix';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('robot engineering coverage matrix', () => {
  it('recomputes the complete frozen payload by path Cartesian product', () => {
    const fixture = buildRobotEngineeringCoverageMatrixFixture();
    const report = evaluateRobotEngineeringCoverageMatrix(fixture.requirementsBytes, fixture.manifestBytes, fixture.artifacts);
    expect(report.coverageReady).toBe(true);
    expect(report.counts).toEqual({ expectedCombinations: 3, submittedCombinations: 3, passedCombinations: 3, declaredArtifacts: 18, suppliedArtifacts: 18 });
    expect(report.entries.map(entry => entry.payloadCaseId)).toEqual(['payload-zero', 'payload-rated', 'payload-eccentric']);
    expect(report).toMatchObject({ fullRequirementsCoverageComplete: true, externalValidationComplete: false, releaseReady: false, sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false } });
  });

  it('keeps a missing payload/path combination not_run instead of inferring coverage', () => {
    const fixture = buildRobotEngineeringCoverageMatrixFixture();
    const removed = fixture.manifest.combinations.pop()!;
    for (const name of Object.values(removed.files)) fixture.artifacts.delete(name);
    const report = evaluateRobotEngineeringCoverageMatrix(fixture.requirementsBytes, encode(fixture.manifest), fixture.artifacts);
    expect(report.coverageReady).toBe(false);
    expect(report.counts).toMatchObject({ expectedCombinations: 3, submittedCombinations: 2, passedCombinations: 2 });
    expect(report.errors.join(' ')).toContain('payload-eccentric::path-cycle-a is missing');
  });

  it('rejects duplicate combinations, reused artifact names and undeclared artifacts', () => {
    const fixture = buildRobotEngineeringCoverageMatrixFixture();
    fixture.manifest.combinations[1]!.payloadCaseId = 'payload-zero';
    fixture.manifest.combinations[1]!.files.dynamicInput = fixture.manifest.combinations[0]!.files.dynamicInput;
    fixture.artifacts.set('undeclared.json', encode({}));
    const report = evaluateRobotEngineeringCoverageMatrix(fixture.requirementsBytes, encode(fixture.manifest), fixture.artifacts);
    expect(report.errors.join(' ')).toContain('duplicate payload/path combination');
    expect(report.errors.join(' ')).toContain('every coverage artifact filename must be unique');
    expect(report.errors.join(' ')).toContain('undeclared coverage artifact undeclared.json');
  });

  it('rejects a packet whose payload identity does not match its matrix cell', () => {
    const fixture = buildRobotEngineeringCoverageMatrixFixture();
    const zero = fixture.manifest.combinations[0]!;
    const rated = fixture.manifest.combinations[1]!;
    const zeroDynamic = fixture.artifacts.get(zero.files.dynamicInput)!;
    fixture.artifacts.set(rated.files.dynamicInput, zeroDynamic);
    const report = evaluateRobotEngineeringCoverageMatrix(fixture.requirementsBytes, fixture.manifestBytes, fixture.artifacts);
    expect(report.coverageReady).toBe(false);
    expect(report.entries.find(entry => entry.payloadCaseId === 'payload-rated')!.errors.join(' ')).toContain('payload does not match');
  });

  it('binds exact requirement and manifest bytes', () => {
    const fixture = buildRobotEngineeringCoverageMatrixFixture();
    fixture.manifest.requirementsFileSha256 = '0'.repeat(64);
    const report = evaluateRobotEngineeringCoverageMatrix(fixture.requirementsBytes, encode(fixture.manifest), fixture.artifacts);
    expect(report.coverageReady).toBe(false);
    expect(report.errors).toContain('requirements bytes do not match manifest requirementsFileSha256');
  });

  it('fails closed on malformed JSON without release effects', () => {
    const report = evaluateRobotEngineeringCoverageMatrix(encode({}), new Uint8Array([0xff]), new Map());
    expect(report).toMatchObject({ status: 'failed', coverageReady: false, fullRequirementsCoverageComplete: false, releaseReady: false });
  });
});
