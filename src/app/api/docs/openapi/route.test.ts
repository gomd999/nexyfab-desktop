import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('CAD OpenAPI authentication contract', () => {
  it('does not advertise CAD compute as unauthenticated', async () => {
    const response = await GET();
    const document = await response.json() as {
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    };

    for (const [path, operations] of Object.entries(document.paths)) {
      if (!path.startsWith('/api/cad/v1/')) continue;
      for (const operation of Object.values(operations)) {
        expect(operation.security, `${path} must require bearer auth`).toEqual([
          { bearerAuth: [] },
        ]);
      }
    }
  });

  it('documents server-owned generation and strict Web/MCP physical-network parity', async () => {
    const document = await (await GET()).json() as { paths: Record<string, unknown> };
    const stateContract = JSON.stringify(document.paths['/api/cad/v1/generation/state']);
    const refineContract = JSON.stringify(document.paths['/api/cad/v1/generation/refine']);
    const diagnosticContract = JSON.stringify(document.paths['/api/cad/v1/generation/verify']);
    const physicalContract = JSON.stringify(document.paths['/api/cad/v1/physical-network/verify']);

    expect(stateContract).not.toContain('"record"');
    expect(refineContract).toContain('server-owned');
    expect(refineContract).not.toContain('maxAttempts');
    expect(diagnosticContract).toContain('releaseReady=false');
    expect(physicalContract).toContain('requirePhysicalRouteGeometry');
    expect(physicalContract).toContain('analysis_only_internal_flow');
    expect(physicalContract).toContain('additionalProperties');
  });
});
