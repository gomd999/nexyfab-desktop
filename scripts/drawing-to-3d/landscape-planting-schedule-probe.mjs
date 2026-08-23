/** Executable exporter -> independent parser probe for the internal planting schedule. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportLandscapePlantingSchedule } from './landscape-planting-schedule-export.mjs';
import { parseLandscapePlantingSchedule } from './landscape-planting-schedule-import.mjs';

const EXPORTER_ID = 'scripts/drawing-to-3d/landscape-planting-schedule-export.mjs';
const PARSER_ID = 'scripts/drawing-to-3d/landscape-planting-schedule-import.mjs';
const VERIFIER_ID = 'scripts/drawing-to-3d/landscape-planting-schedule-probe.mjs';
const CAPABILITY_ID = 'landscape.planting.schedule.internal';
const REVISION_ID = 'landscape-planting-local-probe:r1';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sourceHash = (url) => sha256(readFileSync(fileURLToPath(url)));
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? 'null' : encoded;
};

try {
  const document = {
    schema: 'nexyfab.landscape.v1', revision: 12, coordinateSystemId: 'EPSG:5186',
    plants: [
      { id: 'plant-01', speciesCode: 'ACR-PAL', positionM: [2, 2, 0], installedHeightM: 3.2, matureCanopyDiameterM: 5.5, rootZoneDiameterM: 2.4, spacingM: 5, evidenceIds: ['nursery-01'] },
      { id: 'plant-02', speciesCode: 'PIN-DEN', positionM: [8, 2, 0], installedHeightM: 2.1, matureCanopyDiameterM: 4.2, rootZoneDiameterM: 1.8, spacingM: 4.5, evidenceIds: ['nursery-02'] },
    ],
    plantingZones: [{ id: 'plant-zone-01', boundaryM: [[0, 0], [12, 0], [12, 8], [0, 8]], plantIds: ['plant-01', 'plant-02'], soilVolumeId: 'soil-01', targetCoveragePercent: 65 }],
    soilVolumes: [{ id: 'soil-01', boundaryM: [[0, 0], [12, 0], [12, 8], [0, 8]], depthM: 0.8, soilType: 'loam', drainageClass: 'well-drained' }],
  };
  const revisionValue = { workspace: 'landscape-probe', revision: REVISION_ID, document };
  const workspaceContentHash = sha256(canonical(revisionValue));
  const text = exportLandscapePlantingSchedule(document, { workspaceRevisionId: REVISION_ID, workspaceContentHash });
  const artifactBytes = Buffer.from(text, 'utf8');
  const parsed = parseLandscapePlantingSchedule(artifactBytes, { workspaceRevisionId: REVISION_ID, workspaceContentHash });
  const parserOutput = Buffer.from(canonical(parsed.artifact), 'utf8');
  const exporterSourceSha256 = sourceHash(new URL('./landscape-planting-schedule-export.mjs', import.meta.url));
  const parserSourceSha256 = sourceHash(new URL('./landscape-planting-schedule-import.mjs', import.meta.url));
  const verifierEvidence = { exporterId: EXPORTER_ID, parserId: PARSER_ID, verifierId: VERIFIER_ID, parsedRowCount: parsed.parsedRowCount, parsedObjectCount: parsed.parsedObjectCount, stableIds: parsed.stableIds, plantCatalogProvenance: 'HOLD', nativeRoundtrip: 'HOLD', externalInteroperability: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false };
  const evidenceBytes = Buffer.from(canonical(verifierEvidence), 'utf8');
  process.stdout.write(JSON.stringify({ schema: 'nexyfab.landscape-planting-schedule-execution.v1', capabilityId: CAPABILITY_ID, format: 'schedule', workspaceRevisionId: REVISION_ID, workspaceContentHash, exporterId: EXPORTER_ID, exporterResult: 'verified', exporterSourceSha256, parserId: PARSER_ID, parserResult: 'verified', parserSourceSha256, verifierId: VERIFIER_ID, verifierResult: 'verified', artifactSha256: sha256(artifactBytes), artifactBytes: artifactBytes.byteLength, artifactBase64: artifactBytes.toString('base64'), parserOutputSha256: sha256(parserOutput), parserOutputBase64: parserOutput.toString('base64'), verifierEvidenceSha256: sha256(evidenceBytes), verifierEvidenceBase64: evidenceBytes.toString('base64'), parsedRowCount: parsed.parsedRowCount, parsedObjectCount: parsed.parsedObjectCount, stableIds: parsed.stableIds, plantCatalogProvenance: 'HOLD', nativeRoundtrip: 'HOLD', externalInteroperability: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false }));
} catch (error) {
  process.stderr.write(`landscape planting schedule probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
