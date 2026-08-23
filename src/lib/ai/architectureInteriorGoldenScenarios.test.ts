import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURE_INTERIOR_GOLDEN_POLICY,
  ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS,
  architectureInteriorGoldenScenarioById,
  evaluateArchitectureInteriorGoldenEvidence,
  validateArchitectureInteriorGoldenScenarios,
} from './architectureInteriorGoldenScenarios';

const hash = (character: string) => character.repeat(64);

describe('architecture/interior golden scenario contract', () => {
  it('defines the six staged scenarios and shared accuracy policy', () => {
    expect(validateArchitectureInteriorGoldenScenarios()).toEqual([]);
    expect(ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.map(item => item.id)).toEqual([
      'arch-single-storey-small-office',
      'arch-multi-storey-apartment',
      'interior-cafe-restaurant-kitchen',
      'arch-office-mep-service-openings',
      'arch-comprehensive-residential',
      'arch-ifc4-3-regression',
    ]);
    expect(ARCHITECTURE_INTERIOR_GOLDEN_POLICY).toMatchObject({ campaigns: 3, repeatsPerCampaign: 5, minimumAccuracy: 0.95, maximumFalseVerified: 0, holdout: { actualSourceRequired: true, generationMayUseHoldout: false, independentReviewersRequired: 2 } });
    expect(ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.every(item => item.authoritativeInputs.every(input => input.provenance.sha256 === null))).toBe(true);
  });

  it('requires authoritative provenance, complete axes/outputs, and holdout completion policy', () => {
    const scenario = structuredClone(ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0]);
    scenario.authoritativeInputs[0]!.provenance.locator = 'local-file';
    const invalid = { ...scenario, completionCriteria: { ...scenario.completionCriteria, falseVerified: 1 } };
    expect(validateArchitectureInteriorGoldenScenarios([
      invalid,
      ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[1],
      ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[2],
      ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[3],
      ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[4],
      ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[5],
    ])).toEqual(expect.arrayContaining([
      'provenance_invalid:arch-single-storey-small-office:office-brief',
      'completion_policy_mismatch:arch-single-storey-small-office',
    ]));
  });

  it('covers MEP openings, revision consistency, and IFC4.3 semantic roundtrip obligations', () => {
    const mep = ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.find(item => item.id === 'arch-office-mep-service-openings')!;
    const residential = ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.find(item => item.id === 'arch-comprehensive-residential')!;
    const ifc = ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS.find(item => item.id === 'arch-ifc4-3-regression')!;
    expect(mep.validationAxes.map(item => item.axis)).toEqual(expect.arrayContaining(['ceiling_mep', 'mep_coordination', 'hosts_openings']));
    expect(residential.validationAxes.map(item => item.axis)).toEqual(expect.arrayContaining(['revision_integrity', 'schedules_quantities']));
    expect(ifc.validationAxes.map(item => item.axis)).toEqual(expect.arrayContaining(['ifc_roundtrip', 'coordinate_units', 'semantic_objects', 'relationships']));
    expect(ifc.authoritativeInputs.every(item => item.provenance.sha256 === null)).toBe(true);
  });

  it('keeps scenario lookup deterministic for review UI and runners', () => {
    expect(architectureInteriorGoldenScenarioById('interior-cafe-restaurant-kitchen')?.domain).toBe('interior');
    expect(architectureInteriorGoldenScenarioById('missing')).toBeUndefined();
  });

  it('does not promote hash-only approval claims, even with complete 3 x 5 evidence', () => {
    const scenario = ARCHITECTURE_INTERIOR_GOLDEN_SCENARIOS[0];
    const evidence = {
      scenarioId: scenario.id,
      inputSourceHashes: Object.fromEntries(scenario.authoritativeInputs.map((input, index) => [input.id, hash(String.fromCharCode(97 + index))])),
      runs: [1, 2, 3].flatMap(campaign => [1, 2, 3, 4, 5].map(repeat => ({ campaign, repeat, usedForTuning: false as const, requiredGatesPassed: true, accuracy: .98, falseVerified: false }))),
      approvals: [
        { reviewerId: 'reviewer-a', approvalReceiptHash: hash('d'), approved: true as const },
        { reviewerId: 'reviewer-b', approvalReceiptHash: hash('e'), approved: true as const },
      ],
    };
    expect(evaluateArchitectureInteriorGoldenEvidence(evidence)).toMatchObject({ eligible: false, campaigns: 3, minimumRepeatsPerCampaign: 5, minimumAccuracy: .98, falseVerified: 0, blockers: expect.arrayContaining(['independent_holdout_approval']) });
    const failed = structuredClone(evidence);
    failed.runs.pop();
    failed.runs[0]!.falseVerified = true;
    failed.approvals[1]!.reviewerId = 'reviewer-a';
    expect(evaluateArchitectureInteriorGoldenEvidence(failed)).toMatchObject({ eligible: false, blockers: expect.arrayContaining(['campaign_repeats', 'false_verified', 'independent_holdout_approval']) });
  });
});
