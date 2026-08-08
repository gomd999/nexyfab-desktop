#!/usr/bin/env node
/**
 * author-holdout-candidate — M-C4(260808e): **실제 홀드아웃 소스**로 인증 후보를
 * 저작하는 도구. 소스 파일 해시·AI 산출물 생성·요약·검토 패킷 적격성 검증까지
 * 한 번에 — 👤/실무자는 소스와 공차정책만 공급하면 된다.
 *
 * usage (packet 적격검증이 .ts 를 임포트하므로 tsx 로 실행):
 *   node node_modules/tsx/dist/cli.mjs scripts/author-holdout-candidate.mjs --spec <author-spec.json> --out <candidate.json> [--generate | --artifact <assembly.json>]
 *
 * author-spec.json:
 * {
 *   "caseId": "civil-rw-std-001",
 *   "domain": "civil",
 *   "sourceFiles": ["path/to/standard-drawing.pdf", ...],   // 해시 대상(원본 보관은 별도)
 *   "sourceKind": "public-standard" | "licensed-customer" | "expert-authored",
 *   "sourceRights": { "basis": "public-license", "reference": "공공누리 제1유형 — <정확한 출처/조항>", "benchmarkingAllowed": true },
 *   "sourceSpec": "높이 3m 길이 10m 역T형 옹벽 — 저판 두께 400mm ...",  // AI 생성 입력(자연어 사양)
 *   "assertions": [ { "axis": "dimensions", "tolerancePolicy": "±1mm", "provenance": "standard" }, ... ]  // 축별 공차정책(리뷰어 승인 대상)
 * }
 *
 * --generate: sourceSpec 을 textToAssembly(실 AI)로 생성해 산출물로 쓴다.
 *   생략 시 --artifact <assembly.json> 필요(기성 산출물 재사용).
 *
 * 정직 계약: 해시는 실파일에서 계산·산출물 요약은 실기하에서 재도출·마지막에
 * buildReviewPacket 적격성(scoreReadyForReview)을 실검증해 미달 사유를 그대로
 * 출력한다. 이 도구는 승인을 만들지 않는다 — 승인은 리뷰어 콘솔의 몫.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { placedAabb } from './drawing-to-3d/assembly.mjs';

const stable = value => JSON.stringify(value, (_k, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
  : item);
const sha = buf => createHash('sha256').update(buf).digest('hex');

export function summarizeArtifact(assembly) {
  const parts = assembly.parts ?? [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const b = placedAabb(part);
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], b.min[k]); max[k] = Math.max(max[k], b.max[k]); }
  }
  const raw = parts.length ? [0, 1, 2].map(k => +(max[k] - min[k]).toFixed(6)) : [0, 0, 0];
  return {
    name: assembly.name ?? 'holdout-artifact',
    partCount: parts.length,
    pipeCount: assembly.pipes?.length ?? 0,
    roles: [...new Set(parts.map(part => part.role).filter(Boolean))].sort(),
    alignmentErrors: assembly.alignmentErrors ?? [],
    unverifiedPartCount: parts.filter(part => part.unverified === true).length,
    extents: raw.every(Number.isFinite) ? raw : null,
    holeTotal: parts.reduce((n, part) => n + (Array.isArray(part.params?.holes) ? part.params.holes.length : 0), 0),
    occCount: parts.filter(part => part._occ).length,
  };
}

export async function authorCandidate(spec, { generate = false, artifactFile = null } = {}) {
  const errors = [];
  for (const key of ['caseId', 'domain', 'sourceKind', 'sourceRights', 'sourceSpec', 'assertions']) {
    if (!spec[key]) errors.push(`spec.${key} 누락`);
  }
  if (!Array.isArray(spec.sourceFiles) || spec.sourceFiles.length === 0) errors.push('spec.sourceFiles 누락(해시 대상 원본)');
  if (spec.sourceKind === 'internal-template') errors.push('internal-template 은 인증 후보 저작 대상이 아님(드릴 전용)');
  if (errors.length) return { errors };

  // 소스 해시 = 원본 파일 바이트의 연쇄 해시(순서 고정)
  const fileHashes = spec.sourceFiles.map(file => sha(readFileSync(resolve(file))));
  const sourceHash = sha(stable({ files: fileHashes, spec: spec.sourceSpec }));

  let assembly;
  if (generate) {
    const { textToAssembly } = await import('./drawing-to-3d/from-text.mjs');
    const generated = await textToAssembly(spec.sourceSpec);
    if (!generated.assembly || generated.allFailed) return { errors: [`AI 생성 실패: ${(generated.gateErrors ?? []).join(', ')}`] };
    if ((generated.dropped ?? []).length) return { errors: [`AI 생성 열화(드롭 ${generated.dropped.length}) — 후보 부적합(정직 거부)`] };
    assembly = generated.assembly;
  } else if (artifactFile) {
    assembly = JSON.parse(readFileSync(resolve(artifactFile), 'utf8'));
  } else {
    return { errors: ['--generate 또는 --artifact <assembly.json> 필요'] };
  }

  const artifactHash = sha(stable(assembly));
  const artifactSummary = summarizeArtifact(assembly);
  if (artifactSummary.alignmentErrors.length || artifactSummary.unverifiedPartCount) {
    return { errors: [`산출물 게이트 미통과: ${artifactSummary.alignmentErrors.length}err/${artifactSummary.unverifiedPartCount}unverified — 후보 부적합`] };
  }

  const candidate = {
    schema: 'nexyfab.domain-accuracy-candidate.v1',
    caseId: spec.caseId,
    domain: spec.domain,
    sourceHash,
    sourceKind: spec.sourceKind,
    sourceRights: spec.sourceRights,
    sourceSpec: spec.sourceSpec,
    artifactHash,
    artifactSummary,
    groundTruthAssertions: spec.assertions.map(assertion => ({
      axis: assertion.axis,
      tolerancePolicy: assertion.tolerancePolicy,
      provenance: assertion.provenance ?? 'standard',
      artifactHashes: [artifactHash, ...fileHashes],
    })),
    split: 'candidate',
  };

  // 적격성 실검증 — 미달이면 사유 그대로(조용한 통과 없음)
  const { buildReviewPacket } = await import('./build-domain-accuracy-review-packets.ts');
  const packet = buildReviewPacket(candidate);
  return { candidate, assembly, packet, ready: packet.scoreReadyForReview, issues: packet.issues, errors: [] };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  (async () => {
    const args = process.argv.slice(2);
    const val = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
    const spec = JSON.parse(readFileSync(resolve(val('spec')), 'utf8'));
    const out = val('out') ?? 'holdout-candidate.json';
    const result = await authorCandidate(spec, { generate: args.includes('--generate'), artifactFile: val('artifact') });
    if (result.errors.length) { console.error('저작 실패:\n - ' + result.errors.join('\n - ')); process.exit(1); }
    writeFileSync(resolve(out), JSON.stringify([result.candidate], null, 2) + '\n', 'utf8');
    writeFileSync(resolve(out.replace(/\.json$/, '.artifact.json')), JSON.stringify(result.assembly, null, 2) + '\n', 'utf8');
    console.log(`후보 저작 완료 → ${out} (scoreReadyForReview: ${result.ready})`);
    if (!result.ready) console.log('적격 미달 사유:\n - ' + result.issues.join('\n - '));
    process.exit(result.ready ? 0 : 1);
  })().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exit(2); });
}
