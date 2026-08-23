/** Executable exporter -> independent parser probe for the internal finish schedule. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportInteriorFinishSchedule } from './interior-finish-schedule-export.mjs';
import { parseInteriorFinishSchedule } from './interior-finish-schedule-import.mjs';

const EXPORTER_ID = 'scripts/drawing-to-3d/interior-finish-schedule-export.mjs';
const PARSER_ID = 'scripts/drawing-to-3d/interior-finish-schedule-import.mjs';
const VERIFIER_ID = 'scripts/drawing-to-3d/interior-finish-schedule-probe.mjs';
const CAPABILITY_ID = 'interior.finish.schedule';
const REVISION_ID = 'architecture-interior-finish-local:r1';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? 'null' : encoded;
};
const sourceHash = (url) => sha256(readFileSync(fileURLToPath(url)));

try {
  const architecture = {
    schema: 'nexyfab.architecture.v1', revision: 7,
    spaces: [{ id: 'space-lobby', wallIds: ['wall-a', 'wall-b'], slabId: 'slab-lobby', ceilingId: 'ceiling-lobby' }, { id: 'space-office', wallIds: ['wall-c'], slabId: 'slab-office', ceilingId: 'ceiling-office' }],
    walls: [{ id: 'wall-a' }, { id: 'wall-b' }, { id: 'wall-c' }],
    slabs: [{ id: 'slab-lobby', spaceId: 'space-lobby' }, { id: 'slab-office', spaceId: 'space-office' }],
    ceilings: [{ id: 'ceiling-lobby', spaceId: 'space-lobby' }, { id: 'ceiling-office', spaceId: 'space-office' }],
  };
  const interior = { schema: 'nexyfab.interior.v1', revision: 4, architectureDocumentId: 'architecture-probe', finishes: [
    { id: 'finish-floor-lobby', spaceId: 'space-lobby', hostId: 'slab-lobby', surface: 'floor', material: 'terrazzo' },
    { id: 'finish-wall-lobby', spaceId: 'space-lobby', hostId: 'wall-a', surface: 'wall', material: 'paint-eggshell' },
    { id: 'finish-ceiling-office', spaceId: 'space-office', hostId: 'ceiling-office', surface: 'ceiling', material: 'acoustic-tile' },
  ] };
  const architectureContentHash = sha256(canonical(architecture));
  const interiorContentHash = sha256(canonical(interior));
  const workspaceContentHash = sha256(canonical({ workspaceRevisionId: REVISION_ID, architecture, interior }));
  const options = { workspaceRevisionId: REVISION_ID, workspaceContentHash, architectureRevision: architecture.revision, architectureContentHash, interiorRevision: interior.revision, interiorContentHash };
  const text = exportInteriorFinishSchedule({ architecture, interior }, options);
  const artifactBytes = Buffer.from(text, 'utf8');
  const parsed = parseInteriorFinishSchedule(artifactBytes, options);
  const parserOutput = Buffer.from(canonical(parsed.artifact), 'utf8');
  const exporterSourceSha256 = sourceHash(new URL('./interior-finish-schedule-export.mjs', import.meta.url));
  const parserSourceSha256 = sourceHash(new URL('./interior-finish-schedule-import.mjs', import.meta.url));
  const verifierEvidence = { exporterId: EXPORTER_ID, parserId: PARSER_ID, verifierId: VERIFIER_ID, parsedRowCount: parsed.parsedRowCount, parsedObjectCount: parsed.parsedObjectCount, stableIds: parsed.stableIds, nativeInteroperability: 'HOLD', externalCatalogProvenance: 'HOLD', boqEvidence: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false };
  const evidenceBytes = Buffer.from(canonical(verifierEvidence), 'utf8');
  process.stdout.write(JSON.stringify({ schema: 'nexyfab.interior-finish-schedule-execution.v1', capabilityId: CAPABILITY_ID, format: 'schedule', workspaceRevisionId: REVISION_ID, workspaceContentHash, architectureRevision: architecture.revision, architectureContentHash, interiorRevision: interior.revision, interiorContentHash, exporterId: EXPORTER_ID, exporterResult: 'verified', exporterSourceSha256, parserId: PARSER_ID, parserResult: 'verified', parserSourceSha256, verifierId: VERIFIER_ID, verifierResult: 'verified', artifactSha256: sha256(artifactBytes), artifactBytes: artifactBytes.byteLength, artifactBase64: artifactBytes.toString('base64'), parserOutputSha256: sha256(parserOutput), parserOutputBase64: parserOutput.toString('base64'), verifierEvidenceSha256: sha256(evidenceBytes), verifierEvidenceBase64: evidenceBytes.toString('base64'), parsedRowCount: parsed.parsedRowCount, parsedObjectCount: parsed.parsedObjectCount, stableIds: parsed.stableIds, nativeInteroperability: 'HOLD', externalCatalogProvenance: 'HOLD', boqEvidence: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false }));
} catch (error) {
  process.stderr.write(`interior finish schedule probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
