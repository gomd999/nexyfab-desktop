import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { dwgToNexyfabAssembly, readDwgToDxf } from '../../src/lib/brep-bridge/dwgImport';
import type { ComplexNativeExtractionRequest } from '../../src/lib/reference/complexNativeExtraction';

type Triage = { results: Array<{ caseId: string; route: string; preferredExtensions?: string[] }> };
type Attempt = {
  caseId: string;
  route: 'dwg-primary' | 'revit-dwg-fallback';
  status: 'pass' | 'not_run';
  classification: 'brep-polyhedron' | 'mixed' | 'aabb-approximation' | '2d-drawing' | 'unsupported';
  reason: string;
  sourceMember: { path: string; sha256: string; bytes: number };
  threeD?: { fidelity: string; parts: number; exactPolyParts: number; approximateParts: number; representative: boolean; stats: unknown };
  twoD?: { emitted: number; truncated: boolean; stats: unknown };
};

const reviewRoot = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-review-260806');
const corpusRoot = path.resolve(process.argv[3] ?? 'C:/Users/gomd9/Downloads/참고파일들');
const output = path.resolve(process.argv[4] ?? path.join(reviewRoot, 'dwg-import-results.json'));
const triagePath = path.resolve(process.argv[5] ?? 'docs/evidence/external-step-structure-coverage-260806/unsupported-archive-triage-run-1.json');
const repair = (value: string) => {
  if (!/[Ãìë]/.test(value)) return value;
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? value : decoded;
};
const safePath = (root: string, locator: string) => {
  const absolute = path.resolve(root, repair(locator));
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`unsafe_locator:${locator}`);
  return absolute;
};
const asArrayBuffer = (bytes: Buffer): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

async function main() {
  const requestBatch = JSON.parse(fs.readFileSync(path.join(reviewRoot, 'native-extraction-requests.json'), 'utf8')) as { requests: ComplexNativeExtractionRequest[] };
  const triage = JSON.parse(fs.readFileSync(triagePath, 'utf8')) as Triage;
  const routes = new Map(triage.results.map(item => [item.caseId, item.route]));
  const selected = requestBatch.requests.filter(request => ['autocad-or-oda', 'revit-api'].includes(routes.get(request.caseId) ?? ''));
  const attempts: Attempt[] = [];

  for (const request of selected) {
    const route = routes.get(request.caseId) === 'revit-api' ? 'revit-dwg-fallback' : 'dwg-primary';
    try {
      const archive = await JSZip.loadAsync(fs.readFileSync(safePath(corpusRoot, request.localLocator)));
      const member = Object.keys(archive.files).filter(name => !archive.files[name]!.dir && path.extname(name).toLowerCase() === '.dwg').sort()[0];
      if (!member) throw new Error('dwg_member_missing');
      const bytes = await archive.files[member]!.async('nodebuffer');
      const sourceMember = { path: member.replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
      const threeD = await dwgToNexyfabAssembly(asArrayBuffer(bytes), { name: request.caseId });
      if (threeD.ok && threeD.assembly && threeD.stats) {
        const exactPolyParts = threeD.assembly.parts.filter(part => part.fidelity === 'brep-polyhedron').length;
        const approximateParts = threeD.assembly.parts.length - exactPolyParts;
        const classification = threeD.assembly.fidelity ?? (exactPolyParts ? 'brep-polyhedron' : 'aabb-approximation');
        attempts.push({
          caseId: request.caseId, route, status: 'pass', classification,
          reason: route === 'revit-dwg-fallback' ? 'DWG fallback geometry imported; native Revit semantics were not evaluated.' : 'DWG geometry imported.',
          sourceMember,
          threeD: { fidelity: classification, parts: threeD.assembly.parts.length, exactPolyParts, approximateParts, representative: threeD.stats.representative ?? false, stats: threeD.stats },
        });
        continue;
      }
      const twoD = await readDwgToDxf(asArrayBuffer(bytes), { maxEntities: 250_000 });
      if (twoD.ok && twoD.stats) {
        attempts.push({
          caseId: request.caseId, route, status: 'pass', classification: '2d-drawing',
          reason: route === 'revit-dwg-fallback' ? 'DWG fallback contains supported 2D drawing entities; native Revit semantics were not evaluated.' : 'DWG contains supported 2D drawing entities, not a manufacturing 3D assembly.',
          sourceMember,
          twoD: { emitted: twoD.stats.emitted, truncated: twoD.stats.truncated, stats: twoD.stats },
        });
      } else {
        attempts.push({ caseId: request.caseId, route, status: 'not_run', classification: 'unsupported', reason: threeD.error ?? twoD.error ?? 'dwg_import_unavailable', sourceMember });
      }
    } catch (error) {
      attempts.push({
        caseId: request.caseId, route, status: 'not_run', classification: 'unsupported',
        reason: error instanceof Error ? error.message : String(error),
        sourceMember: { path: '', sha256: '0'.repeat(64), bytes: 0 },
      });
    }
  }

  const counts = attempts.reduce((out, item) => {
    out[item.classification] = (out[item.classification] ?? 0) + 1;
    return out;
  }, {} as Record<string, number>);
  const exact3d = attempts.filter(item => item.classification === 'brep-polyhedron').length;
  const report = {
    schema: 'nexyfab.dwg-import-evidence.v1',
    generatedAt: new Date().toISOString(),
    scoreEligible: false,
    releaseReady: false,
    sourceBytesEmbedded: false,
    accuracyBoundary: {
      nativeAssemblySemanticsRecovered: false,
      bodyMembershipAsserted: false,
      revitFallbackCountsAsRevitNative: false,
      exact3dRequires: 'classification=brep-polyhedron and no approximate parts',
    },
    summary: { requested: selected.length, completed: attempts.filter(item => item.status === 'pass').length, notRun: attempts.filter(item => item.status === 'not_run').length, exact3d, classifications: counts },
    attempts,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: path.relative(process.cwd(), output), summary: report.summary }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
