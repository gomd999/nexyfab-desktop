/**
 * M-C4 저작 도구 계약 — 실소스 후보 저작이 적격(scoreReadyForReview)까지
 * 한 번에 도달하고, 권리/게이트 미달은 소리내며 거부되는지.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { authorCandidate as authorCandidateRaw, summarizeArtifact } from '../../../scripts/author-holdout-candidate.mjs';
// mjs 기본값 추론이 옵션 타입을 좁혀버려(artifactFile: null) 호출측에서 재선언
const authorCandidate = authorCandidateRaw as (
  spec: Record<string, unknown>,
  opts?: { generate?: boolean; artifactFile?: string | null },
) => Promise<{ errors: string[]; ready?: boolean; candidate?: any; issues?: string[] }>;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'holdout-'));
  const src = join(dir, 'standard-drawing.txt');
  writeFileSync(src, 'TEST standard drawing bytes');
  const raw = execFileSync(process.execPath, ['-e',
    "import('./scripts/drawing-to-3d/domain-assemblies.mjs').then(m => console.log(JSON.stringify(m.buildAssemblyTemplate('civil','retaining_wall_run',{}))))"],
    { encoding: 'utf8', cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 });
  const artifact = join(dir, 'artifact.json');
  writeFileSync(artifact, raw.trim().split('\n').pop()!);
  return { src, artifact };
}

const SPEC_BASE = {
  caseId: 'TEST-civil-ext-01',
  domain: 'civil',
  sourceKind: 'public-standard',
  sourceRights: { basis: 'public-license', reference: 'TEST 공공누리 제1유형', benchmarkingAllowed: true },
  sourceSpec: '높이 3m 길이 10m 역T형 옹벽',
  assertions: [
    'requirements', 'dimensions', 'features', 'part_definitions', 'hierarchy',
    'transforms', 'collision_clearance', 'manufacturing', 'step_roundtrip', 'repair',
  ].map(axis => ({ axis, tolerancePolicy: '±1mm', provenance: 'standard' })),
};

describe('author-holdout-candidate (M-C4)', () => {
  it('authors a score-ready candidate from real files + prebuilt artifact', async () => {
    const { src, artifact } = fixture();
    const r = await authorCandidate({ ...SPEC_BASE, sourceFiles: [src] }, { artifactFile: artifact });
    expect(r.errors).toEqual([]);
    expect(r.ready).toBe(true);
    expect(r.candidate.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.candidate.sourceSpec).toContain('옹벽');
    expect(r.candidate.artifactSummary.partCount).toBe(2);
    // 요약이 실기하 재도출(extents 유한)임을 확인
    expect(r.candidate.artifactSummary.extents?.every((v: number) => Number.isFinite(v))).toBe(true);
  });

  it('refuses missing rights and internal-template sources loudly', async () => {
    const { src, artifact } = fixture();
    const noRights = await authorCandidate({ ...SPEC_BASE, sourceRights: undefined, sourceFiles: [src] }, { artifactFile: artifact });
    expect(noRights.errors.join(',')).toContain('sourceRights');
    const internal = await authorCandidate({ ...SPEC_BASE, sourceKind: 'internal-template', sourceFiles: [src] }, { artifactFile: artifact });
    expect(internal.errors.join(',')).toContain('internal-template');
  });

  it('summarizeArtifact re-derives from geometry (not trusted metadata)', () => {
    const s = summarizeArtifact({ parts: [{ type: 'box', params: { width: 100, depth: 50, height: 10 }, at: { tx: 0, ty: 0, tz: 0 }, role: 'base' }] });
    expect(s.partCount).toBe(1);
    expect(s.extents).toEqual([100, 50, 10]);
  });
});
