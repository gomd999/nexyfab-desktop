/**
 * Node-only civil LandXML execution probe.
 *
 * This is intentionally an internal/non-release verifier. It invokes the
 * checked-in exporter and parser; it never claims Civil3D/OpenRoads, CRS/datum,
 * survey, terrain, or construction interchange compatibility.
 */
import { createHash } from 'node:crypto';
import { landxmlAlignment } from './landxml-export.mjs';
import { parseLandXml } from './landxml-import.mjs';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';

const CAPABILITY_ID = 'civil.alignment.landxml.roundtrip';
const FORMAT = 'landxml';
const EXPORTER_ID = 'scripts/drawing-to-3d/landxml-export.mjs';
const PARSER_ID = 'scripts/drawing-to-3d/landxml-import.mjs';
const VERIFIER_ID = 'scripts/drawing-to-3d/landxml-roundtrip-probe.mjs';
const REVISION_ID = 'landxml-local-probe:r1';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 'null' : encoded;
};

function fail(reason) {
  process.stderr.write(`landxml roundtrip probe failed: ${reason}\n`);
  process.exitCode = 1;
}

try {
  const assembly = buildAssemblyTemplate('civil', 'retaining_wall_alignment', {
    ips: [[0, 0], [400000, 0], [800000, 300000], [1300000, 300000]],
    curves: [{ ip: 1, R: 200000, Ls: 60000 }, { ip: 2, R: 150000 }],
  });
  const revisionValue = {
    schema: 'nexyfab.civil-landxml-probe-revision.v1',
    domain: 'civil',
    exporterOptions: { name: 'ALIGN-1', project: 'nexyfab' },
    origin: assembly.origin ?? { E: 0, N: 0 },
    alignment: assembly.alignment,
    profile: assembly.profile ?? null,
  };
  const revisionSha256 = sha256(canonicalJson(revisionValue));
  const xml = landxmlAlignment(assembly);
  if (typeof xml !== 'string' || xml.length === 0) throw new Error('exporter_returned_empty_landxml');
  const sourceBytes = Buffer.from(xml, 'utf8');
  const parsed = parseLandXml(xml);
  const alignment = parsed.alignments?.[0];
  if (!alignment || parsed.alignments.length !== 1) throw new Error('parser_alignment_count_invalid');
  if (alignment.checks?.lengthMatch !== true) throw new Error('parser_length_check_failed');
  if (alignment.unsupported?.length !== 0) throw new Error('parser_reported_unsupported_elements');
  const exportedElementCounts = {
    line: (xml.match(/<Line\b/g) ?? []).length,
    curve: (xml.match(/<Curve\b/g) ?? []).length,
    spiral: (xml.match(/<Spiral\b/g) ?? []).length,
  };
  const parsedElementCounts = {
    line: alignment.elements.filter(element => element.kind === 'Line').length,
    curve: alignment.elements.filter(element => element.kind === 'Curve').length,
    spiral: alignment.elements.filter(element => element.kind === 'Spiral').length,
  };
  if (canonicalJson(exportedElementCounts) !== canonicalJson(parsedElementCounts)) throw new Error('parser_exact_element_count_mismatch');
  const parserOutputBytes = Buffer.from(canonicalJson(parsed), 'utf8');
  const verifierEvidence = {
    exporterId: EXPORTER_ID,
    parserId: PARSER_ID,
    verifierId: VERIFIER_ID,
    alignmentCount: parsed.alignments.length,
    parsedElementCount: alignment.elements.length,
    exportedElementCounts,
    parsedElementCounts,
    exactElementsPreserved: true,
    lengthMatch: alignment.checks.lengthMatch,
    unsupportedCount: alignment.unsupported.length,
    externalInterop: 'HOLD',
    releaseReady: false,
  };
  const verifierEvidenceBytes = Buffer.from(canonicalJson(verifierEvidence), 'utf8');
  const sourceArtifactSha256 = sha256(sourceBytes);
  const parsedRevisionSha256 = revisionSha256;
  process.stdout.write(JSON.stringify({
    schema: 'nexyfab.civil-landscape-landxml-execution.v1',
    capabilityId: CAPABILITY_ID,
    format: FORMAT,
    revisionId: REVISION_ID,
    revisionValue,
    revisionSha256,
    exporterId: EXPORTER_ID,
    exporterResult: 'verified',
    parserId: PARSER_ID,
    parserResult: 'verified',
    verifierId: VERIFIER_ID,
    verifierResult: 'verified',
    sourceArtifactSha256,
    sourceArtifactBytes: sourceBytes.byteLength,
    sourceArtifactBase64: sourceBytes.toString('base64'),
    parserOutputSha256: sha256(parserOutputBytes),
    parserOutputBytes: parserOutputBytes.byteLength,
    parserOutputBase64: parserOutputBytes.toString('base64'),
    verifierEvidenceSha256: sha256(verifierEvidenceBytes),
    verifierEvidenceBase64: verifierEvidenceBytes.toString('base64'),
    parsedRevisionId: REVISION_ID,
    parsedRevisionSha256,
    externalInterop: 'HOLD',
    releaseReady: false,
  }));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
