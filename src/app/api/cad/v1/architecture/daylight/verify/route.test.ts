import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { POST } from './route';

const request = (body: unknown) => new NextRequest('http://localhost/api/cad/v1/architecture/daylight/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': `daylight-verify-${Math.random()}` },
  body: JSON.stringify(body),
});

describe('daylight verification release boundary', () => {
  it('does not promote caller-supplied annual evidence to commercial release', async () => {
    const response = await POST(request({
      latitudeDeg: 37.5,
      longitudeDeg: 127,
      instants: ['2026-06-21T08:00:00.000Z', '2026-06-21T09:00:00.000Z'],
      windows: [],
      obstacles: [],
      annualEvidence: { ran: true, engine: 'radiance', weatherFileHash: 'weather-sha', sensorCount: 1, spatialDaylightAutonomyPercent: 75, annualSunlightExposurePercent: 10 },
      criteria: { minimumSpatialDaylightAutonomyPercent: 50, maximumAnnualSunlightExposurePercent: 20 },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      verificationPassed: true,
      releaseReady: false,
      releaseBlocker: 'SIGNED_INDEPENDENT_RELEASE_EVIDENCE_REQUIRED',
      quoteOrRfqSideEffects: false,
    });
  });
});
