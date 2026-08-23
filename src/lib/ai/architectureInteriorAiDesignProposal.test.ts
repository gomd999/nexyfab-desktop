import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURE_INTERIOR_AI_DESIGN_PROPOSAL_SCHEMA,
  compileAiArchitectureInteriorDesignProposal,
  validateAiArchitectureInteriorDesignProposal,
  type AiArchitectureInteriorDesignProposal,
} from './architectureInteriorAiDesignProposal';

const validProposal: AiArchitectureInteriorDesignProposal = {
  schema: ARCHITECTURE_INTERIOR_AI_DESIGN_PROPOSAL_SCHEMA,
  projectId: 'demo-building', proposalId: 'concept-01', units: { sourceLength: 'm' },
  coordinateFrame: { id: 'project-frame', origin: [0, 0, 0], rotationDeg: [0, 0, 0] },
  intent: { requestedMaturity: 'concept' },
  construction: { wallThickness: 0.2, slabThickness: 0.2, ceilingThickness: 0.1 },
  building: {
    storeys: [{ id: 'ground', elevation: 0, height: 3 }],
    spaces: [{
      id: 'living-room', storeyId: 'ground', usageKey: 'living',
      boundary: [[0, 0], [5, 0], [5, 4], [0, 4]],
      openings: [{ id: 'entry-door', edgeIndex: 0, kind: 'door', offset: 1, width: 0.9, height: 2.1, sill: 0 }],
    }],
  },
  interior: {
    furniture: [{ id: 'sofa', spaceId: 'living-room', position: [2, 2, 0.6], size: [2, 0.8, 0.8], clearance: 0.6 }],
    lights: [{ id: 'ceiling-light', spaceId: 'living-room', position: [2.5, 2, 2.7], suspension: 0, lumens: 1200, cctK: 3000 }],
    finishes: [{ id: 'floor-finish', spaceId: 'living-room', surface: 'floor', materialKey: 'oak.floor' }],
  },
};

describe('architecture/interior AI design proposal contract', () => {
  it('normalizes a small building and interior plan into concept documents', () => {
    const result = compileAiArchitectureInteriorDesignProposal(validProposal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.architecture.storeys[0]?.heightMm).toBe(3000);
    expect(result.result.architecture.walls).toHaveLength(4);
    expect(result.result.architecture.walls[0]?.thicknessMm).toBe(200);
    expect(result.result.architecture.walls[0]?.heightMm).toBe(3000);
    expect(result.result.architecture.ceilings[0]?.thicknessMm).toBe(100);
    expect(result.result.architecture.openings[0]?.positionMm).toEqual([1000, 0, 0]);
    expect(result.result.interior.furniture[0]?.sizeMm).toEqual([2000, 800, 800]);
    expect(result.result.interior.architectureDocumentId).toBe('architecture:demo-building:concept-01');
    expect(result.result.coordinateFrame).toEqual({ id: 'project-frame', originMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
    expect(result.result.warnings).toContain('concept_only_no_exact_or_release_evidence');
    expect(result.result.provenance.architecture[0]?.sourceId).toMatch(/^proposal:[a-f0-9]{64}$/);
  });

  it('rejects unknown fields, exact/release claims, bad references and unsafe strings', () => {
    const tampered = structuredClone(validProposal) as unknown as Record<string, unknown>;
    tampered.exact = true;
    (tampered.building as Record<string, unknown>).spaces = [{
      ...((validProposal.building.spaces[0]) as unknown as Record<string, unknown>),
      storeyId: 'missing-storey',
      label: 'https://untrusted.example',
    }];
    const issues = validateAiArchitectureInteriorDesignProposal(tampered);
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['unsupported_claim', 'unknown_field', 'invalid_reference', 'unsafe_string']));
    expect(compileAiArchitectureInteriorDesignProposal(tampered).ok).toBe(false);
  });

  it('rejects malformed geometry and oversize proposals', () => {
    const malformed = structuredClone(validProposal);
    malformed.building.spaces[0]!.boundary = [[0, 0], [0, 0]];
    expect(validateAiArchitectureInteriorDesignProposal(malformed).map(issue => issue.code)).toContain('boundary_invalid');
    const oversize = structuredClone(validProposal);
    oversize.building.storeys = Array.from({ length: 65 }, (_, index) => ({ id: `storey-${index}`, elevation: index * 3, height: 3 }));
    expect(validateAiArchitectureInteriorDesignProposal(oversize).map(issue => issue.code)).toContain('count_limit_exceeded');
    const crossing = structuredClone(validProposal);
    crossing.building.spaces[0]!.boundary = [[0, 0], [4, 4], [0, 3], [4, 0]];
    expect(validateAiArchitectureInteriorDesignProposal(crossing).map(issue => issue.code)).toContain('boundary_invalid');
  });

  it('rejects forged maturity and compliance claims instead of fabricating a pass', () => {
    const forged = structuredClone(validProposal) as unknown as Record<string, unknown>;
    (forged.intent as Record<string, unknown>).requestedMaturity = 'release';
    (forged.intent as Record<string, unknown>).codeCompliance = 'passed';
    const issues = validateAiArchitectureInteriorDesignProposal(forged);
    expect(issues.map(issue => issue.code)).toContain('unsupported_claim');
    expect(compileAiArchitectureInteriorDesignProposal(forged).ok).toBe(false);
  });

  it('does not mistake ordinary identifiers ending in sk-* for API keys', () => {
    const proposal = structuredClone(validProposal);
    proposal.interior.furniture![0]!.id = 'desk-1';
    expect(validateAiArchitectureInteriorDesignProposal(proposal)).toEqual([]);
    expect(compileAiArchitectureInteriorDesignProposal(proposal).ok).toBe(true);
  });

  it('checks rotated furniture clearance corners against the referenced space', () => {
    const validRotated = structuredClone(validProposal);
    validRotated.interior.furniture![0] = { id: 'sofa', spaceId: 'living-room', position: [2, 2, 0.6], size: [2, 0.8, 0.8], clearance: 0.6, rotationDeg: 45 };
    expect(validateAiArchitectureInteriorDesignProposal(validRotated)).toEqual([]);
    const outside = structuredClone(validRotated);
    outside.interior.furniture![0]!.position = [0.5, 0.5, 0.6];
    expect(validateAiArchitectureInteriorDesignProposal(outside).map(issue => issue.code)).toContain('furniture_envelope_outside_space');
  });

  it('checks furniture and lights against non-zero multi-storey elevations', () => {
    const proposal = structuredClone(validProposal);
    proposal.building.storeys.push({ id: 'upper', elevation: 5, height: 3 });
    proposal.building.spaces.push({ id: 'upper-room', storeyId: 'upper', usageKey: 'office', boundary: [[0, 0], [5, 0], [5, 4], [0, 4]] });
    proposal.interior.furniture = [{ id: 'upper-desk', spaceId: 'upper-room', position: [2, 2, 5.5], size: [1, 1, 1], clearance: 0.5 }];
    proposal.interior.lights = [{ id: 'upper-light', spaceId: 'upper-room', position: [2, 2, 7.5], suspension: 0.5, lumens: 1000, cctK: 3000 }];
    expect(validateAiArchitectureInteriorDesignProposal(proposal)).toEqual([]);
    const furnitureOutside = structuredClone(proposal); furnitureOutside.interior.furniture![0]!.position[2] = 4.5;
    expect(validateAiArchitectureInteriorDesignProposal(furnitureOutside).map(issue => issue.code)).toContain('furniture_envelope_outside_storey');
    const lightOutside = structuredClone(proposal); lightOutside.interior.lights![0]!.position[2] = 8;
    expect(validateAiArchitectureInteriorDesignProposal(lightOutside).map(issue => issue.code)).toContain('light_outside_storey');
    const lightOutsideSpace = structuredClone(proposal); lightOutsideSpace.interior.lights![0]!.position = [6, 2, 7.5];
    expect(validateAiArchitectureInteriorDesignProposal(lightOutsideSpace).map(issue => issue.code)).toContain('light_outside_space');
  });
});
