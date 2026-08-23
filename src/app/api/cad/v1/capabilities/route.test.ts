import { describe, expect, it } from 'vitest';
import { tools } from '../../../../../../scripts/drawing-to-3d/mcp-server.mjs';
import { GET } from './route';

describe('CAD v1 capability contract', () => {
  it('maps every advertised operation to a published MCP tool and disables quote/RFQ side effects', async () => {
    const payload = await (await GET()).json();
    const mcpNames = new Set(tools.map((tool: { name: string }) => tool.name));
    expect(payload.quoteOrRfqSideEffects).toBe(false);
    for (const operation of payload.operations) {
      expect(mcpNames.has(operation.mcp), `${operation.id} -> ${operation.mcp}`).toBe(true);
      expect(operation.path).toMatch(/^\/api\/cad\/v1\//);
      if (operation.cliAvailable === false) expect(operation.cli).toBeNull();
      else expect(operation.cli).toBeTruthy();
    }
  });

  it('publishes the same fail-closed generation and physical-network boundaries used by MCP', async () => {
    const payload = await (await GET()).json();
    const byId = new Map(payload.operations.map((operation: { id: string }) => [operation.id, operation]));
    expect(byId.get('generation-verify')).toMatchObject({ advisoryOnly: true, releaseClaimAllowed: false });
    expect(byId.get('generation-refine')).toMatchObject({ path: '/api/cad/v1/generation/refine', mcp: 'refine_ai_generation', failClosed: true });
    expect(byId.get('physical-network-verify')).toMatchObject({ path: '/api/cad/v1/physical-network/verify', mcp: 'verify_physical_network', failClosed: true });
  });

  it('publishes output truth without treating registry metadata as a release receipt', async () => {
    const payload = await (await GET()).json();
    expect(payload.outputCapabilityPolicy).toEqual({
      registryMetadataAuthorizesRelease: false,
      perArtifactEvidenceRequired: true,
      unavailableOrNotRun: 'HOLD',
      structuredInternalIsNativeCad: false,
      meshExchangeIsExactCad: false,
    });
    const outputs = new Map(payload.outputCapabilities.map((item: { id: string }) => [item.id, item]));
    expect(outputs.get('mechanical.part.step')).toMatchObject({ artifactTruth: 'exact_exchange', exportAvailable: true, releaseReady: false });
    expect(outputs.get('mechanical.part.stl')).toMatchObject({ artifactTruth: 'mesh_exchange', releaseReady: false });
    expect(outputs.get('architecture.dxf.roundtrip')).toMatchObject({ status: 'HOLD', runState: 'NOT_RUN', exportAvailable: false });
    expect(outputs.get('specialty.sheet-metal.verify')).toMatchObject({ artifactTruth: 'analysis_only', exportAvailable: false });
    expect(payload.outputCapabilities.every((item: { releaseReady: boolean }) => item.releaseReady === false)).toBe(true);
    const operations = new Map(payload.operations.map((item: { id: string }) => [item.id, item]));
    expect(operations.get('part-step')).toMatchObject({ outputCapabilityId: 'mechanical.part.step' });
    expect(operations.get('feature-tree-mesh')).toMatchObject({ outputCapabilityId: 'mechanical.part.stl' });
    expect(operations.get('sheet-metal-verify')).toMatchObject({ outputCapabilityId: 'specialty.sheet-metal.verify' });
    expect(operations.get('weldment-verify')).toMatchObject({ outputCapabilityId: 'specialty.weldment.verify' });
  });
});
