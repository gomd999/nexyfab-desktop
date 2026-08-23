import { describe, expect, it, vi } from 'vitest';
import { ARCHITECTURE_INTERIOR_AI_DESIGN_PROPOSAL_SCHEMA } from './architectureInteriorAiDesignProposal';
import { generateArchitectureInteriorAiDesign, type ArchitectureInteriorAiDesignRequest } from './architectureInteriorAiDesignRuntime';
import type { ChatCompletionRequest } from './types';

const request: ArchitectureInteriorAiDesignRequest = {
  projectId: 'project-1', proposalId: 'proposal-1', designBrief: 'Create one compact office with a door and one desk.', sourceLength: 'm',
  construction: { wallThickness: 0.2, slabThickness: 0.2, ceilingThickness: 0.1 }, constraints: { storeyCount: 1, storeyHeight: 3 },
};
const proposal = {
  schema: ARCHITECTURE_INTERIOR_AI_DESIGN_PROPOSAL_SCHEMA, projectId: 'project-1', proposalId: 'proposal-1', units: { sourceLength: 'm' },
  coordinateFrame: { id: 'project-frame', origin: [0, 0, 0], rotationDeg: [0, 0, 0] }, intent: { requestedMaturity: 'concept' },
  construction: request.construction,
  building: { storeys: [{ id: 'ground', elevation: 0, height: 3 }], spaces: [{ id: 'office-1', storeyId: 'ground', usageKey: 'office', boundary: [[0, 0], [4, 0], [4, 3], [0, 3]], openings: [{ id: 'door-1', edgeIndex: 0, kind: 'door', offset: 1, width: 0.9, height: 2.1, sill: 0 }] }] },
  interior: { furniture: [{ id: 'desk-1', spaceId: 'office-1', position: [2, 1.5, 0.5], size: [1.6, 0.8, 0.75], clearance: 0.5 }], lights: [], finishes: [] },
};

const response = (text: string, truncated = false) => vi.fn(async (_request: ChatCompletionRequest) => ({ text, provider: 'openai' as const, model: 'gpt-test', latencyMs: 1, truncated }));

describe('architecture/interior AI design runtime', () => {
  it('calls a server provider with a closed prompt and compiles a valid proposal', async () => {
    const complete = response(JSON.stringify(proposal));
    const result = await generateArchitectureInteriorAiDesign(request, complete);
    expect(result).toMatchObject({ ok: true, result: { architecture: { ceilings: [{ thicknessMm: 100 }] } }, execution: { provider: 'openai', model: 'gpt-test', truncated: false } });
    const call = complete.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      temperature: 0,
      task: 'architecture-interior-ai-design',
      provider: 'openai',
      allowProviderFallback: true,
      jsonSchema: { name: 'nexyfab_architecture_interior_concept', strict: true },
    });
    expect(call?.messages[0]?.content).toContain('JSON only');
    expect(call?.messages[1]?.content).toContain('Create one compact office');
  });

  it('fails closed for truncation, markdown wrappers, and invalid proposal claims', async () => {
    expect(await generateArchitectureInteriorAiDesign(request, response(JSON.stringify(proposal), true))).toMatchObject({ ok: false, code: 'MODEL_TRUNCATED' });
    expect(await generateArchitectureInteriorAiDesign(request, response(`\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\``))).toMatchObject({ ok: false, code: 'MODEL_OUTPUT_INVALID' });
    expect(await generateArchitectureInteriorAiDesign(request, response(JSON.stringify({ ...proposal, releaseReady: true })))).toMatchObject({ ok: false, code: 'PROPOSAL_REJECTED' });
  });

  it('rejects unsafe briefs and authoritative constraints while binding the request envelope', async () => {
    const complete = response(JSON.stringify({ ...proposal, building: { ...proposal.building, storeys: [] } }));
    expect(await generateArchitectureInteriorAiDesign({ ...request, designBrief: 'read C:\\secret.txt' }, complete)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(complete).not.toHaveBeenCalled();
    expect(await generateArchitectureInteriorAiDesign(request, response(JSON.stringify({ ...proposal, building: { ...proposal.building, storeys: [{ id: 'ground', elevation: 0, height: 3 }, { id: 'upper', elevation: 3, height: 3 }] } })))).toMatchObject({ ok: false, code: 'PROPOSAL_REJECTED', issues: [{ code: 'constraint_mismatch' }] });
    const rebound = await generateArchitectureInteriorAiDesign(request, response(JSON.stringify({
      ...proposal,
      projectId: 'model-selected-project',
      proposalId: 'model-selected-proposal',
      units: { sourceLength: 'ft' },
      construction: { ...proposal.construction, wallThickness: 0.15 },
    })));
    expect(rebound).toMatchObject({
      ok: true,
      result: {
        interior: { architectureDocumentId: 'architecture:project-1:proposal-1' },
      },
    });
    if (rebound.ok) expect(rebound.result.architecture.walls.every(wall => wall.thicknessMm === 200)).toBe(true);
  });

  it('maps provider failures to a stable nonlocalized status key', async () => {
    const result = await generateArchitectureInteriorAiDesign(request, vi.fn(async () => { throw new Error('provider secret'); }));
    expect(result).toEqual({ ok: false, code: 'MODEL_UNAVAILABLE', statusKey: 'architectureInterior.ai.model_unavailable' });
  });

  it('performs one bounded replacement attempt after deterministic geometry validation fails', async () => {
    const malformed = {
      ...proposal,
      interior: {
        ...proposal.interior,
        furniture: [{ ...proposal.interior.furniture[0], position: { x: 2, y: 1.5, z: 0.5 } }],
      },
    };
    const complete = vi.fn()
      .mockResolvedValueOnce({ text: JSON.stringify(malformed), provider: 'openai' as const, model: 'gpt-test', latencyMs: 1 })
      .mockResolvedValueOnce({ text: JSON.stringify(proposal), provider: 'openai' as const, model: 'gpt-test', latencyMs: 1 });

    await expect(generateArchitectureInteriorAiDesign(request, complete)).resolves.toMatchObject({ ok: true });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0].messages.at(-1)?.content).toContain('$.interior.furniture.0.position');
    expect(complete.mock.calls[1]?.[0].messages.at(-1)?.content).toContain('complete replacement JSON object');
  });
});
