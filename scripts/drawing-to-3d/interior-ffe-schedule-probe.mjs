/** Executable exporter -> independent parser probe for the internal FF&E schedule. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportInteriorFfeSchedule } from './interior-ffe-schedule-export.mjs';
import { parseInteriorFfeSchedule } from './interior-ffe-schedule-import.mjs';

const EXPORTER_ID = 'scripts/drawing-to-3d/interior-ffe-schedule-export.mjs';
const PARSER_ID = 'scripts/drawing-to-3d/interior-ffe-schedule-import.mjs';
const VERIFIER_ID = 'scripts/drawing-to-3d/interior-ffe-schedule-probe.mjs';
const CAPABILITY_ID = 'interior.ffe.schedule';
const REVISION_ID = 'architecture-interior-ffe-local:r1';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? 'null' : encoded;
};
const sourceHash = (url) => sha256(readFileSync(fileURLToPath(url)));

try {
  const architecture = {
    schema: 'nexyfab.architecture.v1', revision: 8,
    spaces: [
      { id: 'space-lobby', wallIds: ['wall-a', 'wall-b'], slabId: 'slab-lobby', ceilingId: 'ceiling-lobby' },
      { id: 'space-office', wallIds: ['wall-c', 'wall-d'], slabId: 'slab-office', ceilingId: 'ceiling-office' },
    ],
  };
  const interior = {
    schema: 'nexyfab.interior.v1', revision: 5, architectureDocumentId: 'architecture-ffe-probe', lights: [], finishes: [],
    furniture: [
      { id: 'ffe-desk-office', spaceId: 'space-office', positionMm: [3200, 2100, 0], sizeMm: [1400, 700, 750], clearanceMm: 450, rotationDeg: 15 },
      { id: 'ffe-lounge-lobby', spaceId: 'space-lobby', positionMm: [1800, 2400, 0], sizeMm: [1800, 850, 780], clearanceMm: 600 },
      { id: 'ffe-chair-office', spaceId: 'space-office', positionMm: [2200, 1700, 0], sizeMm: [600, 600, 850], clearanceMm: 300, rotationDeg: -10 },
    ],
  };
  const architectureContentHash = sha256(canonical(architecture));
  const interiorContentHash = sha256(canonical(interior));
  const workspaceContentHash = sha256(canonical({ workspaceRevisionId: REVISION_ID, architecture, interior }));
  const options = { workspaceRevisionId: REVISION_ID, workspaceContentHash, architectureRevision: architecture.revision, architectureContentHash, interiorRevision: interior.revision, interiorContentHash };
  const artifactBytes = Buffer.from(exportInteriorFfeSchedule({ architecture, interior }, options), 'utf8');
  const parsed = parseInteriorFfeSchedule(artifactBytes, options);
  const parserOutput = Buffer.from(canonical(parsed.artifact), 'utf8');
  const counts = { spaceCount: parsed.artifact.spaces.length, furnitureCount: parsed.artifact.furniture.length, rowCount: parsed.parsedRowCount, objectCount: parsed.parsedObjectCount };
  const exporterSourceSha256 = sourceHash(new URL('./interior-ffe-schedule-export.mjs', import.meta.url));
  const parserSourceSha256 = sourceHash(new URL('./interior-ffe-schedule-import.mjs', import.meta.url));
  const verifierEvidence = { schema: 'nexyfab.interior-ffe-schedule-verifier-evidence.v1', exporterId: EXPORTER_ID, parserId: PARSER_ID, verifierId: VERIFIER_ID, counts, stableIds: parsed.stableIds, nativeInteroperability: 'HOLD', externalCatalogProvenance: 'HOLD', priceEvidence: 'HOLD', boqEvidence: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false };
  const evidenceBytes = Buffer.from(canonical(verifierEvidence), 'utf8');
  process.stdout.write(JSON.stringify({ schema: 'nexyfab.interior-ffe-schedule-execution.v1', capabilityId: CAPABILITY_ID, format: 'schedule', workspaceRevisionId: REVISION_ID, workspaceContentHash, architectureRevision: architecture.revision, architectureContentHash, interiorRevision: interior.revision, interiorContentHash, exporterId: EXPORTER_ID, exporterResult: 'verified', exporterSourceSha256, parserId: PARSER_ID, parserResult: 'verified', parserSourceSha256, verifierId: VERIFIER_ID, verifierResult: 'verified', artifactSha256: sha256(artifactBytes), artifactBytes: artifactBytes.byteLength, artifactBase64: artifactBytes.toString('base64'), parserOutputSha256: sha256(parserOutput), parserOutputBase64: parserOutput.toString('base64'), verifierEvidenceSha256: sha256(evidenceBytes), verifierEvidenceBase64: evidenceBytes.toString('base64'), parsedRowCount: parsed.parsedRowCount, parsedObjectCount: parsed.parsedObjectCount, stableIds: parsed.stableIds, counts, nativeInteroperability: 'HOLD', externalCatalogProvenance: 'HOLD', priceEvidence: 'HOLD', boqEvidence: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false }));
} catch (error) {
  process.stderr.write(`interior FF&E schedule probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
