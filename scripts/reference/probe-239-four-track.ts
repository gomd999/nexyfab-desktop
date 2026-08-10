import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import unzipper from 'unzipper';
import { adaptAihub239Track, mergeAihub239Tracks } from '../../src/lib/ai/aihub239DrawingAdapter';
import { buildArchitectureDrawingSemanticGraph, type ArchitectureDrawingTrack } from '../../src/lib/ai/architectureDrawingReconstruction';
import { canonicalDrawingKey } from './audit-239-drawing-corpus.mjs';

const TRACKS: ArchitectureDrawingTrack[] = ['STR', 'SPA', 'OBJ', 'OCR'];

function valueAfter(args: string[], flag: string) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2), root = valueAfter(args, '--root'), auditPath = valueAfter(args, '--audit'), out = valueAfter(args, '--out');
  if (!root || !auditPath || !out) throw new Error('usage: tsx scripts/reference/probe-239-four-track.ts --root <239-root> --audit <audit.json> --out <report.json>');
  const audit = JSON.parse(await readFile(auditPath, 'utf8')) as { fourTrackIntersectionSamples?: { training?: string[] } };
  const drawingKeys = audit.fourTrackIntersectionSamples?.training ?? [];
  const labelBase = path.join(root, '01-1.정식개방데이터', 'Training', '02.라벨링데이터');
  const indexes = new Map<ArchitectureDrawingTrack, Map<string, { entry: { path: string; buffer(): Promise<Buffer> }; archive: string }>>();
  for (const track of TRACKS) {
    const archive = path.join(labelBase, `TL_${track}.zip`), directory = await unzipper.Open.file(archive), index = new Map();
    for (const entry of directory.files) if (entry.type === 'File' && entry.path.toLowerCase().endsWith('.json')) index.set(canonicalDrawingKey(entry.path.replace(/\.json$/i, '.png')), { entry, archive });
    indexes.set(track, index);
  }
  const cases = [];
  for (const drawingKey of drawingKeys) {
    const adapted = [];
    for (const track of TRACKS) {
      const found = indexes.get(track)?.get(drawingKey);
      if (!found) continue;
      let parsed: unknown;
      try { parsed = JSON.parse((await found.entry.buffer()).toString('utf8')); }
      catch { parsed = {}; }
      adapted.push(adaptAihub239Track(parsed as Record<string, unknown>, track, `${path.basename(found.archive)}:${found.entry.path}`));
    }
    const merged = mergeAihub239Tracks(adapted);
    const graph = merged.drawingId && merged.widthPx && merged.heightPx
      ? buildArchitectureDrawingSemanticGraph({ drawingId: merged.drawingId, widthPx: merged.widthPx, heightPx: merged.heightPx, annotations: merged.annotations })
      : null;
    cases.push({
      drawingKey,
      trackCount: adapted.length,
      annotationCounts: Object.fromEntries(adapted.map(track => [track.track, track.annotations.length])),
      adapterIssueCount: merged.issues.length,
      adapterIssueSamples: merged.issues.slice(0, 10),
      graphGateStatus: graph ? Object.fromEntries(graph.gates.map(gate => [gate.id, gate.status])) : null,
      graphIssueCount: graph ? graph.gates.reduce((sum, gate) => sum + gate.reasons.length, 0) : null,
      eligibleForAuthoritativeScaleReview: Boolean(graph && graph.gates.every(gate => gate.status === 'passed')),
    });
  }
  const report = {
    schema: 'nexyfab.aihub239-four-track-probe.v1', generatedAt: new Date().toISOString(),
    sourcePolicy: { readOnly: true, extracted: false, copiedPayload: false, trainingAuthorized: false, commercialEvidenceAuthorized: false },
    summary: {
      candidateCount: cases.length,
      adapterCleanCount: cases.filter(item => item.adapterIssueCount === 0).length,
      graphCleanCount: cases.filter(item => item.eligibleForAuthoritativeScaleReview).length,
      validationFourTrackCandidateCount: 0,
    },
    cases,
  };
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report.summary)}\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
