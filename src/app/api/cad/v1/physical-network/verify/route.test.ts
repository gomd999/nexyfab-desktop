import { describe, expect, it } from 'vitest';
import { POST } from './route';

const network = () => ({
  id: 'pt100-process',
  ports: [{ id: 'pt100-port', ownerObjectId: 'pt100-1', system: 'hot_water', connector: 'DN25', positionMm: [0, 0, 0], required: true, direction: 'inlet', nominalDiameterMm: 25, axis: [1, 0, 0] }],
  nodes: [{ id: 'n0', system: 'hot_water', connector: 'DN25', positionMm: [0, 0, 0] }, { id: 'n1', system: 'hot_water', connector: 'DN25', positionMm: [100, 0, 0] }],
  connections: [{ id: 'c0', portId: 'pt100-port', nodeId: 'n0' }],
  runs: [{ id: 'r0', system: 'hot_water', fromNodeId: 'n0', toNodeId: 'n1', lengthMm: 100, diameterMm: 25, pathMm: [[0, 0, 0], [100, 0, 0]], representation: 'physical_solid' }],
  rules: { maximumConnectionDistanceMm: 1, minimumDrainSlopePercent: 0, requireMatchingConnector: true, requirePhysicalRouteGeometry: true, requireDiameterMatch: true, requireRunFromConnectedPort: true },
});
const request = (body: unknown) => new Request('http://localhost/api/cad/v1/physical-network/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `physical-${Math.random()}` }, body: JSON.stringify(body) });

describe('physical network web verification', () => {
  it('derives a strict release verdict from typed route geometry', async () => {
    const response = await POST(request({ network: network() }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, networkId: 'pt100-process', verificationReady: true, releaseReady: false, verification: { status: 'passed', releaseReady: true }, quoteOrRfqSideEffects: false });
  });

  it('does not let a web caller inject releaseReady or omit the real path', async () => {
    const fake = network();
    delete (fake.runs[0] as { pathMm?: unknown }).pathMm;
    const asserted = await POST(request({ network: fake, releaseReady: true }));
    expect(asserted.status).toBe(422);
    expect(await asserted.json()).toMatchObject({ ok: false, code: 'INVALID_PHYSICAL_NETWORK', releaseReady: false });
    const measured = await POST(request({ network: fake }));
    expect(measured.status).toBe(422);
    expect(await measured.json()).toMatchObject({ ok: false, code: 'INVALID_PHYSICAL_NETWORK', releaseReady: false });
  });

  it('does not let a caller disable diameter or required-port-to-run enforcement', async () => {
    for (const rule of ['requireDiameterMatch', 'requireRunFromConnectedPort'] as const) {
      const fake = network();
      fake.rules[rule] = false;
      const response = await POST(request({ network: fake }));
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ ok: false, code: 'INVALID_PHYSICAL_NETWORK', releaseReady: false });
    }
  });

  it('rejects untyped systems and unknown extra fields at the boundary', async () => {
    const invalid = network() as Record<string, unknown>;
    (invalid.ports as Array<Record<string, unknown>>)[0]!.system = 'magic-fluid';
    (invalid.ports as Array<Record<string, unknown>>)[0]!.pass = true;
    const response = await POST(request({ network: invalid }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, code: 'INVALID_PHYSICAL_NETWORK', releaseReady: false });
  });
});
