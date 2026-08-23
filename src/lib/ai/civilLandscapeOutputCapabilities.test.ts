import { describe, expect, it } from 'vitest';
import {
  CIVIL_LANDSCAPE_OUTPUT_CAPABILITIES,
  assertCivilLandscapeOutputEnabled,
  bindCivilLandscapeArtifact,
  buildCivilLandscapeRoundtripProbeReceipt,
  canEnableCivilLandscapeOutput,
  claimCivilLandscapeRoundtrip,
  getCivilLandscapeOutputCapability,
} from './civilLandscapeOutputCapabilities';
import { designRevisionSha256 } from '@/lib/designArtifactBinding';

const revisionValue = { domain: 'civil', alignment: { station: [0, 100] }, revision: 4 };
const revisionHash = designRevisionSha256(revisionValue);
const bytes = new TextEncoder().encode('<LandXML/>');
const parserOutputBytes = new TextEncoder().encode('{"alignment":"verified"}');
const verifierEvidenceBytes = new TextEncoder().encode('landxml-import.test.ts:pass');
const parserResult = {
  status: 'verified' as const,
  sourceArtifactSha256: 'placeholder',
  parsedRevisionId: 'r4',
  parsedRevisionSha256: revisionHash,
  outputBytes: parserOutputBytes,
};
const verifierId = 'scripts/drawing-to-3d/landxml-import.test.ts';

describe('civil/landscape Wave 4 output truth contract', () => {
  it('keeps every target path visibly disabled and explains its blocker', () => {
    const targets = CIVIL_LANDSCAPE_OUTPUT_CAPABILITIES.filter(item => item.status === 'TARGET');
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.runState).toBe('NOT_RUN');
      expect(target.releaseClaimAllowed).toBe(false);
      expect(target.blocker).toBeTruthy();
      expect(canEnableCivilLandscapeOutput(target.id)).toBe(false);
      expect(() => assertCivilLandscapeOutputEnabled(target.id)).toThrow('CIVIL_LANDSCAPE_OUTPUT_UNAVAILABLE');
    }
    expect(canEnableCivilLandscapeOutput('civil.unknown.pdf')).toBe(false);
  });

  it('does not treat the hardscape DXF exporter self-test as independent verification', () => {
    const capability = getCivilLandscapeOutputCapability('landscape.hardscape.dxf.generated');
    expect(capability).toMatchObject({ status: 'PARTIAL', runState: 'NOT_RUN', verifierPaths: [], releaseClaimAllowed: false });
    expect(capability?.exporterPath).toBe('scripts/drawing-to-3d/dxf-export.mjs');
    expect(capability?.blocker).toContain('self-test is not an independent focused verifier');
    expect(canEnableCivilLandscapeOutput('landscape.hardscape.dxf.generated')).toBe(false);
    expect(() => assertCivilLandscapeOutputEnabled('landscape.hardscape.dxf.generated')).toThrow('CIVIL_LANDSCAPE_OUTPUT_UNAVAILABLE');
  });

  it('does not treat an internal/generated artifact as a round-trip capability', () => {
    const binding = bindCivilLandscapeArtifact({
      capabilityId: 'landscape.drainage.internal', projectId: 'p1', revisionId: 'r4', revisionValue,
      expectedRevisionId: 'r4', expectedRevisionSha256: revisionHash,
      artifactName: 'drainage.json', artifactMime: 'application/json', bytes,
    });
    expect(() => claimCivilLandscapeRoundtrip({
      binding, evidenceBytes: bytes,
    })).toThrow('CIVIL_LANDSCAPE_ROUNDTRIP_VERIFIER_REQUIRED');
  });

  it('requires structured parser evidence and returns an explicitly non-release probe claim', () => {
    const binding = bindCivilLandscapeArtifact({
      capabilityId: 'civil.alignment.landxml.roundtrip', projectId: 'p1', revisionId: 'r4', revisionValue,
      expectedRevisionId: 'r4', expectedRevisionSha256: revisionHash,
      artifactName: 'alignment.xml', artifactMime: 'application/xml', bytes,
    });
    const evidenceBytes = buildCivilLandscapeRoundtripProbeReceipt({
      binding, parserId: 'scripts/drawing-to-3d/landxml-import.mjs',
      parserResult: { ...parserResult, sourceArtifactSha256: binding.artifactSha256 },
      verifierId, verifierEvidenceBytes,
    });
    const claim = claimCivilLandscapeRoundtrip({ binding, evidenceBytes });
    expect(claim).toMatchObject({ claim: 'internal-roundtrip-probe-verified', format: 'landxml', releaseReady: false });
    expect(() => claimCivilLandscapeRoundtrip({ binding, evidenceBytes: bytes })).toThrow('CIVIL_LANDSCAPE_ROUNDTRIP_EVIDENCE_INVALID');
  });

  it('rejects stale revision id and content hash before binding an artifact', () => {
    const args = {
      capabilityId: 'civil.alignment.landxml.roundtrip', projectId: 'p1', revisionId: 'r4', revisionValue,
      expectedRevisionId: 'r4', expectedRevisionSha256: revisionHash,
      artifactName: 'alignment.xml', artifactMime: 'application/xml', bytes,
    };
    expect(() => bindCivilLandscapeArtifact({ ...args, expectedRevisionId: 'r3' })).toThrow('CIVIL_LANDSCAPE_STALE_REVISION');
    expect(() => bindCivilLandscapeArtifact({ ...args, expectedRevisionSha256: 'c'.repeat(64) })).toThrow('CIVIL_LANDSCAPE_STALE_REVISION_HASH');
    expect(() => bindCivilLandscapeArtifact({ ...args, artifactMime: 'application/pdf' })).toThrow('CIVIL_LANDSCAPE_ARTIFACT_FORMAT_MISMATCH');
  });

  it('rejects tampered artifact, parser, revision, and evidence bindings', () => {
    const binding = bindCivilLandscapeArtifact({
      capabilityId: 'civil.alignment.landxml.roundtrip', projectId: 'p1', revisionId: 'r4', revisionValue,
      expectedRevisionId: 'r4', expectedRevisionSha256: revisionHash,
      artifactName: 'alignment.xml', artifactMime: 'application/xml', bytes,
    });
    const evidence = JSON.parse(new TextDecoder().decode(buildCivilLandscapeRoundtripProbeReceipt({
      binding, parserId: 'scripts/drawing-to-3d/landxml-import.mjs',
      parserResult: { ...parserResult, sourceArtifactSha256: binding.artifactSha256 },
      verifierId, verifierEvidenceBytes,
    }))) as Record<string, unknown>;
    const tamper = (patch: Record<string, unknown>) => new TextEncoder().encode(JSON.stringify({ ...evidence, ...patch }));
    expect(() => claimCivilLandscapeRoundtrip({ binding, evidenceBytes: tamper({ sourceArtifactSha256: 'a'.repeat(64) }) })).toThrow('CIVIL_LANDSCAPE_ROUNDTRIP_EVIDENCE_BINDING_MISMATCH');
    expect(() => claimCivilLandscapeRoundtrip({ binding, evidenceBytes: new TextEncoder().encode(JSON.stringify({ ...evidence, parserId: 'fake' })) })).toThrow('CIVIL_LANDSCAPE_ROUNDTRIP_STALE_REVISION');
    const canonicalTamper = (patch: Record<string, unknown>) => {
      const value = { ...evidence, ...patch };
      return new TextEncoder().encode(JSON.stringify(value, Object.keys(value).sort()));
    };
    expect(() => claimCivilLandscapeRoundtrip({ binding, evidenceBytes: canonicalTamper({ sourceArtifactSha256: 'a'.repeat(64) }) })).toThrow('CIVIL_LANDSCAPE_ROUNDTRIP_EVIDENCE_BINDING_MISMATCH');
    expect(() => claimCivilLandscapeRoundtrip({ binding, evidenceBytes: canonicalTamper({ parsedRevisionId: 'r3' }) })).toThrow('CIVIL_LANDSCAPE_ROUNDTRIP_STALE_REVISION');
    expect(() => claimCivilLandscapeRoundtrip({ binding, evidenceBytes: canonicalTamper({ format: 'dxf' }) })).toThrow('CIVIL_LANDSCAPE_ROUNDTRIP_EVIDENCE_BINDING_MISMATCH');
    expect(() => claimCivilLandscapeRoundtrip({ binding, evidenceBytes: canonicalTamper({ parsedRevisionSha256: 'not-a-sha256' }) })).toThrow('CIVIL_LANDSCAPE_ROUNDTRIP_EVIDENCE_BINDING_MISMATCH');
    expect(() => claimCivilLandscapeRoundtrip({ binding, evidenceBytes: canonicalTamper({ verifierId: 'untrusted.test.ts' }) })).toThrow('CIVIL_LANDSCAPE_ROUNDTRIP_EVIDENCE_BINDING_MISMATCH');
    expect(() => buildCivilLandscapeRoundtripProbeReceipt({
      binding, parserId: 'scripts/drawing-to-3d/landxml-import.mjs',
      parserResult: { ...parserResult, sourceArtifactSha256: 'f'.repeat(64) },
      verifierId, verifierEvidenceBytes,
    })).toThrow('CIVIL_LANDSCAPE_ROUNDTRIP_RESULT_MISMATCH');
    expect(() => claimCivilLandscapeRoundtrip({
      binding: { ...binding, format: 'dxf' }, evidenceBytes: canonicalTamper({}),
    })).toThrow('CIVIL_LANDSCAPE_ARTIFACT_BINDING_INVALID');
  });
});
