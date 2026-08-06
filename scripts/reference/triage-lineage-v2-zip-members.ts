/**
 * lineage-v2 ZIP member triage — P1 "ZIP member 선택을 source member hash에 결속".
 *
 * freecad-zip 러너가 28건 전부 `freecad_zip_supported_member_missing`으로 스킵한
 * 상태에서, 각 ZIP의 실제 멤버를 전수 열람해 (1) 아카이브 sha256이 요청의
 * sourceHash와 일치하는지 검증하고, (2) 설계 소스 멤버를 확장자 우선순위로
 * 선택해 멤버 단위 sha256으로 결속하고, (3) 실행기 라우트를 판정한다.
 * 라우트가 로컬에 없으면 정직하게 not_run — 여기서 형상을 만들지 않는다.
 *
 * usage: npx tsx scripts/reference/triage-lineage-v2-zip-members.ts \
 *   [requests.json] [corpusRoot] [output.json]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const requestsPath = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-extraction-requests.json');
const corpusRoot = path.resolve(process.argv[3] ?? 'C:/Users/gomd9/Downloads/참고파일들');
const output = path.resolve(process.argv[4] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/zip-member-triage.json');

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const safePath = (root: string, locator: string) => {
  const absolute = path.resolve(root, locator);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`unsafe_locator:${locator}`);
  return absolute;
};

// 라우트 우선순위: 로컬 실행기 보유 포맷 → 외부 워커 포맷 순. mesh 계열은
// B-rep 증거가 아니므로 별도 라우트(정확도 축 승격 금지)로만 기록한다.
const ROUTES: Array<{ route: string; extensions: string[]; localExecutor: boolean }> = [
  { route: 'freecad-step', extensions: ['step', 'stp'], localExecutor: true },
  { route: 'freecad-iges', extensions: ['iges', 'igs'], localExecutor: true },
  { route: 'ifc-native-import', extensions: ['ifc'], localExecutor: true },
  { route: 'solidworks-worker', extensions: ['sldasm', 'sldprt'], localExecutor: false },
  { route: 'inventor-worker', extensions: ['iam', 'ipt'], localExecutor: false },
  { route: 'catia-worker', extensions: ['catproduct', 'catpart'], localExecutor: false },
  { route: 'creo-worker', extensions: ['asm', 'prt'], localExecutor: false },
  { route: 'parasolid-worker', extensions: ['x_t', 'x_b'], localExecutor: false },
  { route: 'revit-api', extensions: ['rvt', 'rfa'], localExecutor: false },
  { route: 'autocad-or-oda', extensions: ['dwg', 'dxf'], localExecutor: false },
  { route: 'sketchup-api', extensions: ['skp'], localExecutor: false },
  { route: 'rhino-api', extensions: ['3dm'], localExecutor: false },
  { route: 'mesh-scene-import', extensions: ['max', '3ds', 'blend', 'obj', 'fbx', 'dae', 'stl', 'glb', 'gltf'], localExecutor: false },
];
const routeFor = (extensions: Set<string>) => ROUTES.find(candidate => candidate.extensions.some(item => extensions.has(item))) ?? null;

type MemberSelection = { name: string; extension: string; bytes: number; sha256: string };
type CaseResult = {
  caseId: string; status: 'routed' | 'not_run' | 'fail'; reason: string;
  sourceHashVerified: boolean; archiveBytes: number; entries: number;
  extensionCounts: Record<string, number>; route: string | null; localExecutor: boolean;
  memberSelections: MemberSelection[];
};

async function main() {
  const manifest = JSON.parse(fs.readFileSync(requestsPath, 'utf8')) as {
    requests: Array<{ caseId: string; sourceHash: string; format: string; localLocator: string }>;
  };
  const results: CaseResult[] = [];
  for (const request of manifest.requests.filter(item => item.format === 'zip')) {
    const source = safePath(corpusRoot, request.localLocator);
    let archiveBuffer: Buffer;
    try {
      archiveBuffer = fs.readFileSync(source);
    } catch (error) {
      results.push({ caseId: request.caseId, status: 'fail', reason: `archive_unreadable:${error instanceof Error ? error.message : String(error)}`, sourceHashVerified: false, archiveBytes: 0, entries: 0, extensionCounts: {}, route: null, localExecutor: false, memberSelections: [] });
      continue;
    }
    const archiveHash = sha256(archiveBuffer);
    const sourceHashVerified = archiveHash === request.sourceHash;
    if (!sourceHashVerified) {
      results.push({ caseId: request.caseId, status: 'fail', reason: `source_hash_mismatch:${archiveHash.slice(0, 12)}`, sourceHashVerified, archiveBytes: archiveBuffer.length, entries: 0, extensionCounts: {}, route: null, localExecutor: false, memberSelections: [] });
      continue;
    }
    try {
      const archive = await JSZip.loadAsync(archiveBuffer);
      const members = Object.values(archive.files).filter(item => !item.dir);
      const counts: Record<string, number> = {};
      for (const member of members) {
        const extension = path.extname(member.name).slice(1).toLowerCase() || '(none)';
        counts[extension] = (counts[extension] ?? 0) + 1;
      }
      const matched = routeFor(new Set(Object.keys(counts)));
      const selections: MemberSelection[] = [];
      if (matched) {
        for (const member of members) {
          const extension = path.extname(member.name).slice(1).toLowerCase();
          if (!matched.extensions.includes(extension)) continue;
          const buffer = await member.async('nodebuffer');
          selections.push({ name: member.name, extension, bytes: buffer.length, sha256: sha256(buffer) });
        }
        selections.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
      }
      results.push({
        caseId: request.caseId,
        status: matched ? 'routed' : 'not_run',
        reason: matched ? `route_identified:${matched.route}` : 'supported_design_source_not_found',
        sourceHashVerified, archiveBytes: archiveBuffer.length, entries: members.length,
        extensionCounts: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
        route: matched?.route ?? null, localExecutor: matched?.localExecutor ?? false,
        memberSelections: selections,
      });
    } catch (error) {
      results.push({ caseId: request.caseId, status: 'fail', reason: `archive_parse_error:${error instanceof Error ? error.message : String(error)}`, sourceHashVerified, archiveBytes: archiveBuffer.length, entries: 0, extensionCounts: {}, route: 'archive-repair', localExecutor: false, memberSelections: [] });
    }
  }
  const routes: Record<string, number> = {};
  for (const item of results) { const key = item.route ?? '(none)'; routes[key] = (routes[key] ?? 0) + 1; }
  const artifact = {
    schema: 'nexyfab.lineage-v2-zip-member-triage.v1',
    generatedAt: new Date().toISOString(),
    scoreEligible: false,
    sourceBytesEmbedded: false,
    summary: {
      zipCases: results.length,
      routed: results.filter(item => item.status === 'routed').length,
      localExecutorAvailable: results.filter(item => item.status === 'routed' && item.localExecutor).length,
      notRun: results.filter(item => item.status === 'not_run').length,
      fail: results.filter(item => item.status === 'fail').length,
      sourceHashMismatch: results.filter(item => !item.sourceHashVerified).length,
      routes,
    },
    results,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary }));
  if (artifact.summary.fail) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
