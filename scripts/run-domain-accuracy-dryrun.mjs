#!/usr/bin/env node
/**
 * run-domain-accuracy-dryrun — 95% 인증 도구 체인(후보→패킷→승인→승격→캠페인→
 * 리포트)의 **드라이런(소방훈련)**. 인증이 아니다:
 *
 *   1. 내부 템플릿 후보 + 가상 승인(DRYRUN-virtual-reviewer-*)으로 promote 를
 *      실호출해 **거부(scoreEligible=0, 방출 케이스 0)를 단언**한다 — 인증
 *      방어선이 실제로 잠겨 있음을 실측으로 증명하는 단계.
 *   2. 캠페인/리포트 기계는 별도의 DRYRUN 표기 케이스(승격 우회, 리뷰어 ID·
 *      provenance 에 DRYRUN 명기)로 20케이스×3캠페인×5반복을 실구동한다.
 *      검증 주체=템플릿 엔진 재빌드 결정론(scripts/domain-accuracy-validator.mjs
 *      머리주석 참조). 리포트는 eligible=false + 미측정 축 차단기를 정직하게
 *      내야 정상이다 — 이 드릴의 성공 조건은 "체인이 돌고, 정직하게 거부한다".
 *
 * 산출물은 docs/evidence/(비추적) 아래에만 쓴다. 종료코드 0 = 드릴 전 단언 통과.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDomainCandidates } from './build-domain-accuracy-candidates.mjs';

const TSX = ['node_modules/tsx/dist/cli.mjs'];
const REVIEWERS = ['DRYRUN-virtual-reviewer-1', 'DRYRUN-virtual-reviewer-2'];
const REVIEWED_AT = '2026-08-08T00:00:00.000Z';

function sh(args, { expectCode } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stdout = [], stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (expectCode !== undefined && code !== expectCode) {
        reject(new Error(`expected exit ${expectCode}, got ${code} for ${args.join(' ')}\n${err || out}`));
      } else resolveResult({ code, out, err });
    });
  });
}

/** 후보 → DRYRUN 표기 홀드아웃 케이스(승격 우회 — 리뷰어·provenance에 명기). */
export function buildDryrunCases(candidates, requiredAxes) {
  return candidates.map(candidate => ({
    caseId: `dryrun-${candidate.caseId}`,
    domain: candidate.domain,
    sourceHash: candidate.sourceHash,
    split: 'holdout',
    approvalReviewerIds: REVIEWERS,
    groundTruthAssertions: requiredAxes.map(axis => ({
      axis,
      tolerancePolicy: 'exact-rebuild-v1 (DRYRUN)',
      provenance: 'DRYRUN-internal-template-not-certifiable',
      artifactHashes: [candidate.artifactHash],
    })),
  }));
}

export async function main(args = process.argv.slice(2)) {
  const value = name => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
  const domain = value('domain') ?? 'civil';
  const count = Number(value('count') ?? 20);
  const outDir = resolve(value('out') ?? `docs/evidence/domain-accuracy-dryrun-${domain}`);
  mkdirSync(outDir, { recursive: true });
  const file = name => join(outDir, name);
  const writeJson = (name, valueToWrite) => writeFileSync(file(name), `${JSON.stringify(valueToWrite, null, 2)}\n`, 'utf8');
  const checks = [];
  const assert = (ok, label) => { checks.push({ ok, label }); if (!ok) console.error(`  ✗ ${label}`); else console.log(`  ✓ ${label}`); };

  console.log(`[dryrun] domain=${domain} count=${count} out=${outDir}`);

  // ── 1) 후보 생성 ──
  const candidates = buildDomainCandidates(domain, count);
  writeJson('candidates.json', candidates);
  assert(candidates.length === count, `candidates generated ${candidates.length}/${count}`);

  // ── 2) 리뷰 패킷: 홀드아웃 소스 요구가 전 후보에 표기되는가 ──
  const packetsRun = await sh([...TSX, 'scripts/build-domain-accuracy-review-packets.ts', '--candidates', file('candidates.json')]);
  writeFileSync(file('review-packets.json'), packetsRun.out, 'utf8');
  const packets = JSON.parse(packetsRun.out);
  const packetList = Array.isArray(packets) ? packets : packets.packets ?? [];
  assert(
    packetList.length === count && packetList.every(packet => (packet.issues ?? []).includes('independent_holdout_source_required')),
    'every review packet flags independent_holdout_source_required',
  );

  // ── 3) 가상 승인 ×2 → promote 실호출: 거부돼야 한다(방어선 실측) ──
  const approvals = packetList.flatMap(packet => REVIEWERS.map(reviewerId => ({
    ...(packet.approvalTemplate ?? {}),
    reviewerId,
    reviewedAt: REVIEWED_AT,
    decision: 'approve',
  })));
  writeJson('virtual-approvals.json', approvals);
  const promote = await sh([...TSX, 'scripts/promote-domain-accuracy-candidates.ts',
    '--candidates', file('candidates.json'), '--approvals', file('virtual-approvals.json')]);
  writeFileSync(file('promotion-result.json'), promote.out, 'utf8');
  const promotion = JSON.parse(promote.out);
  assert(promote.code !== 0, `promote refuses certification path (exit ${promote.code})`);
  assert(promotion.summary.scoreEligible === 0, 'promote scoreEligible=0 (internal-template locked out)');
  assert((promotion.approvedCases ?? []).length === 0, 'promote emits zero benchmark cases');

  // ── 4) DRYRUN 케이스(승격 우회, 표기 명시) + corpus ──
  const requiredAxes = [...new Set(
    packetList.flatMap(packet => [
      ...(packet.requiredAxes ?? []),
      ...(packet.issues ?? [])
        .filter(issue => issue.startsWith('ground_truth_axis_missing:'))
        .map(issue => issue.split(':')[1]),
    ]),
  )];
  assert(requiredAxes.length >= 10, `required axes discovered from packets (${requiredAxes.length})`);
  const cases = buildDryrunCases(candidates, requiredAxes);
  writeJson('dryrun-cases.json', cases);
  const corpus = candidates.map(candidate => ({ ...candidate, caseId: `dryrun-${candidate.caseId}` }));
  writeJson('dryrun-corpus.json', corpus);

  // ── 5) 캠페인 실구동 (count×3×5 실행기 호출, 상태파일 재개 가능) ──
  const campaign = await sh([...TSX, 'scripts/run-domain-accuracy-campaign.ts',
    '--domain', domain,
    '--cases', file('dryrun-cases.json'),
    '--state', file('campaign-state.json'),
    '--runs', file('campaign-runs.json'),
    '--executor', process.execPath,
    '--executor-arg', 'scripts/domain-accuracy-validator.mjs',
    '--executor-arg', '--corpus',
    '--executor-arg', file('dryrun-corpus.json'),
    '--executor-arg', '--roundtrip',
    '--executor-arg', '--repair',
    '--timeout-ms', '120000',
  ]);
  writeFileSync(file('campaign-summary.json'), campaign.out, 'utf8');
  const campaignSummary = JSON.parse(campaign.out);
  assert(campaign.code === 0, `campaign completed (exit ${campaign.code})`);
  assert(campaignSummary.completed === count * 15, `campaign runs ${campaignSummary.completed}/${count * 15}`);

  // ── 6) 재개 무결성: 완료 상태에서 재실행 = 전 슬롯 캐시, 실행기 0회 ──
  const resume = await sh([...TSX, 'scripts/run-domain-accuracy-campaign.ts',
    '--domain', domain,
    '--cases', file('dryrun-cases.json'),
    '--state', file('campaign-state.json'),
    '--runs', file('campaign-runs.json'),
    '--executor', process.execPath,
    '--executor-arg', 'scripts/domain-accuracy-validator.mjs',
    '--executor-arg', '--corpus',
    '--executor-arg', file('dryrun-corpus.json'),
  ]);
  assert(resume.code === 0, 'campaign resume on completed state is a clean no-op');

  // ── 7) 리포트: eligible=false + 미측정 축 차단기가 정직하게 나와야 정상 ──
  const report = await sh([...TSX, 'scripts/report-domain-accuracy.ts',
    '--domain', domain, '--cases', file('dryrun-cases.json'), '--runs', file('campaign-runs.json')]);
  writeFileSync(file('report.json'), report.out, 'utf8');
  const reportValue = JSON.parse(report.out);
  assert(report.code === 1 && reportValue.assessment.eligible === false, 'report refuses eligibility (DRYRUN must not certify)');
  assert((reportValue.issues ?? []).length === 0, `evidence integrity issues: ${reportValue.issues.length}`);
  const axes = reportValue.assessment.axes;
  const measured = axes.filter(axis => axis.measured > 0);
  const unmeasured = axes.filter(axis => axis.measured === 0);
  const CORE_AXES = ['requirements', 'dimensions', 'part_definitions', 'collision_clearance', 'step_roundtrip'];
  const measuredNames = new Set(measured.map(axis => axis.axis));
  assert(CORE_AXES.every(axis => measuredNames.has(axis)) && measured.every(axis => axis.accuracy === 1 && axis.coverage === 1),
    `measured axes clean, core 5 included (${measured.map(axis => axis.axis).join(',')})`);
  assert(unmeasured.every(axis => reportValue.assessment.blockers.includes(`coverage:${axis.axis}`)),
    'unmeasured axes surface as coverage blockers');
  assert(reportValue.evidence.requiredGatePasses === reportValue.evidence.requiredGateRuns,
    `gate passes ${reportValue.evidence.requiredGatePasses}/${reportValue.evidence.requiredGateRuns}`);

  // ── 8) 드릴 리포트 ──
  const passed = checks.filter(check => check.ok).length;
  const summary = {
    schema: 'nexyfab.domain-accuracy-dryrun.v1',
    kind: 'DRYRUN — toolchain drill, NOT certification evidence',
    domain,
    reviewers: REVIEWERS,
    subject: 'template-engine cross-process rebuild determinism (no AI subject)',
    checks,
    passed: `${passed}/${checks.length}`,
    campaign: campaignSummary,
    blockers: reportValue.assessment.blockers,
  };
  writeJson('DRYRUN-SUMMARY.json', summary);
  writeFileSync(file('DRYRUN-README.md'), [
    `# 도메인 정확도 캠페인 드라이런 — ${domain}`,
    '',
    '**이 디렉터리는 인증 증거가 아니다.** 가상 승인(DRYRUN-virtual-reviewer-*)과',
    '내부 템플릿 소스로 도구 체인을 소방훈련한 산출물이며, promote 계층이 이런',
    '소스를 인증 경로에서 거부함을 실측 단언하는 것 자체가 훈련 항목이다.',
    '',
    `- 검증 주체: 템플릿 엔진 재빌드 결정론 (AI 생성 아님)`,
    `- 체크: ${passed}/${checks.length} 통과`,
    `- 캠페인: ${campaignSummary.completed} 실행 완료 (state 재개 무결성 포함)`,
    `- 리포트 판정: eligible=false (정상 — 미측정 축 차단기 ${reportValue.assessment.blockers.length}건)`,
    '',
    '실 인증은 독립 홀드아웃 소스 + 실제 리뷰어 2인(👤)이 준비된 뒤 같은 체인으로 진행한다.',
    '',
  ].join('\n'), 'utf8');

  console.log(`[dryrun] ${passed}/${checks.length} checks passed — artifacts in ${outDir}`);
  return checks.every(check => check.ok) ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 2;
  });
}
