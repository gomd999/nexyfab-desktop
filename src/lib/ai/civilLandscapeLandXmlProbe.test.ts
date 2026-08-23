import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  bindCivilLandscapeArtifact,
  buildCivilLandscapeRoundtripProbeReceipt,
  claimCivilLandscapeRoundtrip,
} from './civilLandscapeOutputCapabilities';

const probePath = 'scripts/drawing-to-3d/landxml-roundtrip-probe.mjs';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

type ExecutionProbe = {
  schema: string;
  capabilityId: string;
  format: string;
  revisionId: string;
  revisionValue: unknown;
  revisionSha256: string;
  exporterResult: string;
  parserResult: string;
  verifierResult: string;
  exporterId: string;
  parserId: string;
  verifierId: string;
  sourceArtifactSha256: string;
  sourceArtifactBase64: string;
  parserOutputSha256: string;
  parserOutputBase64: string;
  verifierEvidenceSha256: string;
  verifierEvidenceBase64: string;
  parsedRevisionId: string;
  parsedRevisionSha256: string;
  externalInterop: string;
  releaseReady: boolean;
};

function runProbe(): ExecutionProbe {
  return JSON.parse(execFileSync(process.execPath, [probePath], { encoding: 'utf8' })) as ExecutionProbe;
}

describe('civil LandXML local execution probe', () => {
  it('executes the checked-in exporter and parser before building the bound non-release receipt', () => {
    const probe = runProbe();
    expect(probe).toMatchObject({
      schema: 'nexyfab.civil-landscape-landxml-execution.v1',
      capabilityId: 'civil.alignment.landxml.roundtrip', format: 'landxml',
      exporterResult: 'verified', parserResult: 'verified', verifierResult: 'verified',
      externalInterop: 'HOLD', releaseReady: false,
    });
    const sourceBytes = Buffer.from(probe.sourceArtifactBase64, 'base64');
    const parserOutputBytes = Buffer.from(probe.parserOutputBase64, 'base64');
    const verifierEvidenceBytes = Buffer.from(probe.verifierEvidenceBase64, 'base64');
    const binding = bindCivilLandscapeArtifact({
      capabilityId: probe.capabilityId, projectId: 'probe-project', revisionId: probe.revisionId,
      revisionValue: probe.revisionValue, expectedRevisionId: probe.revisionId, expectedRevisionSha256: probe.revisionSha256,
      artifactName: 'alignment.xml', artifactMime: 'application/xml', bytes: sourceBytes,
    });
    expect(binding.artifactSha256).toBe(probe.sourceArtifactSha256);
    expect(sha256(sourceBytes)).toBe(probe.sourceArtifactSha256);
    expect(sha256(parserOutputBytes)).toBe(probe.parserOutputSha256);
    expect(sha256(verifierEvidenceBytes)).toBe(probe.verifierEvidenceSha256);
    const evidenceBytes = buildCivilLandscapeRoundtripProbeReceipt({
      binding, parserId: probe.parserId,
      parserResult: {
        status: 'verified', sourceArtifactSha256: probe.sourceArtifactSha256,
        parsedRevisionId: probe.parsedRevisionId, parsedRevisionSha256: probe.parsedRevisionSha256,
        outputBytes: parserOutputBytes,
      },
      verifierId: probe.verifierId, verifierEvidenceBytes,
    });
    const claim = claimCivilLandscapeRoundtrip({ binding, evidenceBytes });
    expect(claim).toMatchObject({
      capabilityId: probe.capabilityId, format: 'landxml', revisionId: probe.revisionId,
      revisionSha256: probe.revisionSha256, releaseReady: false,
    });
    expect(probe.parserOutputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(probe.verifierEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
