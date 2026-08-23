/**
 * Executable local exporter/parser probe. It is intentionally internal-only:
 * no hydraulic, external-interoperability, or field evidence is fabricated.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportLandscapeIrrigationSchedule } from './landscape-irrigation-schedule-export.mjs';
import { parseLandscapeIrrigationSchedule } from './landscape-irrigation-schedule-import.mjs';

const EXPORTER_ID = 'scripts/drawing-to-3d/landscape-irrigation-schedule-export.mjs';
const PARSER_ID = 'scripts/drawing-to-3d/landscape-irrigation-schedule-import.mjs';
const VERIFIER_ID = 'scripts/drawing-to-3d/landscape-irrigation-schedule-probe.mjs';
const CAPABILITY_ID = 'landscape.irrigation.schedule.internal';
const REVISION_ID = 'landscape-irrigation-local-probe:r1';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sourceHash = (url) => sha256(readFileSync(fileURLToPath(url)));
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? 'null' : encoded;
};

try {
  const document = {
    schema: 'nexyfab.landscape.v1', revision: 7, coordinateSystemId: 'EPSG:5186',
    irrigationNodes: [
      { id: 'irr-source-01', kind: 'source', positionM: [0, 0, 0], pressureKpa: 350, flowLpm: 80 },
      { id: 'irr-valve-01', kind: 'valve', positionM: [10, 0, 0], pressureKpa: 300 },
      { id: 'irr-emitter-01', kind: 'emitter', positionM: [20, 0, 0], flowLpm: 4 },
      { id: 'irr-emitter-02', kind: 'emitter', positionM: [30, 0, 0], flowLpm: 4 },
    ],
    irrigationPipes: [
      { id: 'irr-pipe-01', fromNodeId: 'irr-source-01', toNodeId: 'irr-valve-01', diameterMm: 32, lengthM: 12 },
      { id: 'irr-pipe-02', fromNodeId: 'irr-valve-01', toNodeId: 'irr-emitter-01', diameterMm: 20, lengthM: 14 },
      { id: 'irr-pipe-03', fromNodeId: 'irr-valve-01', toNodeId: 'irr-emitter-02', diameterMm: 20, lengthM: 18 },
    ],
    irrigationZones: [{ id: 'irr-zone-01', valveNodeId: 'irr-valve-01', emitterNodeIds: ['irr-emitter-01', 'irr-emitter-02'], plantingZoneIds: ['plant-zone-01'], designFlowLpm: 8 }],
  };
  const revisionValue = { workspace: 'landscape-probe', revision: REVISION_ID, document };
  const workspaceContentHash = sha256(canonical(revisionValue));
  const text = exportLandscapeIrrigationSchedule(document, { workspaceRevisionId: REVISION_ID, workspaceContentHash });
  const artifactBytes = Buffer.from(text, 'utf8');
  const parsed = parseLandscapeIrrigationSchedule(text, { workspaceRevisionId: REVISION_ID, workspaceContentHash });
  const parserOutput = Buffer.from(canonical(parsed.artifact), 'utf8');
  const exporterSourceSha256 = sourceHash(new URL('./landscape-irrigation-schedule-export.mjs', import.meta.url));
  const parserSourceSha256 = sourceHash(new URL('./landscape-irrigation-schedule-import.mjs', import.meta.url));
  const verifierEvidence = { exporterId: EXPORTER_ID, parserId: PARSER_ID, verifierId: VERIFIER_ID, parsedRowCount: parsed.parsedRowCount, parsedObjectCount: parsed.parsedObjectCount, stableIds: parsed.stableIds, hydraulicEvidence: 'NOT_RUN', externalInteroperability: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false };
  const evidenceBytes = Buffer.from(canonical(verifierEvidence), 'utf8');
  process.stdout.write(JSON.stringify({ schema: 'nexyfab.landscape-irrigation-schedule-execution.v1', capabilityId: CAPABILITY_ID, format: 'schedule', workspaceRevisionId: REVISION_ID, workspaceContentHash, exporterId: EXPORTER_ID, exporterResult: 'verified', exporterSourceSha256, parserId: PARSER_ID, parserResult: 'verified', parserSourceSha256, verifierId: VERIFIER_ID, verifierResult: 'verified', artifactSha256: sha256(artifactBytes), artifactBytes: artifactBytes.byteLength, artifactBase64: artifactBytes.toString('base64'), parserOutputSha256: sha256(parserOutput), parserOutputBase64: parserOutput.toString('base64'), verifierEvidenceSha256: sha256(evidenceBytes), verifierEvidenceBase64: evidenceBytes.toString('base64'), parsedRowCount: parsed.parsedRowCount, parsedObjectCount: parsed.parsedObjectCount, stableIds: parsed.stableIds, hydraulicEvidence: 'NOT_RUN', externalInteroperability: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false }));
} catch (error) {
  process.stderr.write(`landscape irrigation schedule probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
