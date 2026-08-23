import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { designRevisionSha256 } from '@/lib/designArtifactBinding';
import { POST } from './route';

describe('POST /api/nexyfab/drawing/export-step revision binding', () => {
  it('binds exact STEP bytes to the canonical intent without claiming manufacturing approval', async () => {
    const intent = {
      name: 'binding-plate',
      features: [{ kind: 'box', size: [100, 60, 8] }],
    };
    const response = await POST(new NextRequest('http://localhost/api/nexyfab/drawing/export-step', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intent }),
    }));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.step).toMatch(/^ISO-10303-21;/);
    expect(data.revisionSha256).toBe(designRevisionSha256(intent));
    expect(data.revisionId).toBe(`intent-${data.revisionSha256.slice(0, 12)}`);
    expect(data.stepSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(data.artifactManifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(data.artifactManifest).toMatchObject({
      schema: 'nexyfab.design-artifact-manifest.v1',
      revisionId: data.revisionId,
      revisionSha256: data.revisionSha256,
      artifacts: [{ name: 'model.step', sha256: data.stepSha256 }],
    });
    expect(data).toMatchObject({
      releaseStatus: 'review_required',
      manufacturingAllowed: false,
      analyticStepHandoffPassed: false,
    });
  }, 60_000);
});
