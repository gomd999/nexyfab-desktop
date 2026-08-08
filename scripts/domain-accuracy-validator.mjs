#!/usr/bin/env node
/**
 * domain-accuracy-validator — 캠페인 러너(run-domain-accuracy-campaign.ts)의
 * `--executor` 프로토콜(stdin: {caseValue, campaign, repeat, attempt} → stdout:
 * DomainAccuracyRun JSON)을 구현하는 결정론 검증기.
 *
 * v1 판정 대상 = **템플릿 엔진 교차-프로세스 재빌드 결정론**: corpus 항목의
 * (templateId, parameters)로 어셈블리를 재구축해 후보 생성 시점의 산출물과
 * 비교한다. AI 생성 주체가 아니므로 이 검증기 단독으로는 어떤 정확도 주장의
 * 근거도 되지 않는다(내부 템플릿 소스는 promote 계층이 인증 부적격으로
 * 거부하는 설계 그대로) — 캠페인/리포트 도구 체인의 실동작 드릴과, 실 홀드아웃
 * 도입 시 재사용할 실행기 뼈대가 목적이다.
 *
 * 축 판정(정직 원칙: 측정 불가 = not_run + 사유, 날조 금지):
 *   - requirements        재빌드가 corpus 파라미터로 예외 없이 성공
 *   - dimensions          hashAssemblyArtifact(재빌드) === corpus.artifactHash
 *                         (부품 치수·배치 전체를 덮는 결정론 등가)
 *   - part_definitions    partCount·roles 집합이 corpus.artifactSummary 와 일치
 *   - collision_clearance 재빌드 정렬 게이트 재실행(alignmentErrors 0·unverified 0)
 *   - 그 외 프로파일 필수 축  not_run('dryrun_v1_out_of_scope') — 리포트에
 *                         커버리지 차단기로 정직하게 드러난다
 *
 * falseVerified/falseClear/destructivePartMerge = false: 결함 주입이 없는
 * 드릴에서는 자명하게 0이며, 검출력 주장으로 읽어서는 안 된다.
 *
 * W1-1(260808b) — `--subject ai`: 판정 주체를 **AI 생성 파이프라인**으로 전환.
 * corpus 항목의 `sourceSpec`(자연어 사양 — 실 캠페인에서는 홀드아웃 소스가
 * 공급)을 textToAssembly에 실호출 → 산출물을 GT와 축별 비교. sourceSpec 이
 * 없으면 날조하지 않고 소리내며 fail(`source_spec_missing`). AI 주체에서
 * dimensions 축은 not_run — 치수 GT는 홀드아웃 assertion 의 공차정책이
 * 정본이며 템플릿 해시 등가로 대신할 수 없다(그건 재빌드 주체의 계약).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAssemblyTemplate } from './drawing-to-3d/domain-assemblies.mjs';
import { hashAssemblyArtifact, CANDIDATE_DOMAIN_MAP } from './build-domain-accuracy-candidates.mjs';

/** 판정 축 = 케이스가 실어온 ground truth 축 그대로 — 프로파일 필수축은
 *  evidence 계층이 케이스 승인 시 완전성 검증하므로(도메인별 10~14축 상이),
 *  여기서 목록을 중복 하드코딩하면 드리프트 함정이다. */
const axesOfCase = caseValue =>
  [...new Set((caseValue.groundTruthAssertions ?? []).map(truth => truth.axis))];

const MEASURED_AXES = new Set(['requirements', 'dimensions', 'part_definitions', 'collision_clearance']);

/**
 * corpus(후보 매니페스트) 항목 + 캠페인 입력 → DomainAccuracyRun.
 * opts.subject: 'rebuild'(기본 — 템플릿 재빌드 결정론) | 'ai'(AI 생성 주체).
 * opts.generate: AI 주체의 생성 함수 주입점(async spec => textToAssembly 결과
 * 형태) — 테스트는 가짜를, CLI는 실 파이프라인을 꽂는다.
 * opts.roundtrip: true 면 step_roundtrip 축을 실측정한다(W1-2) — 재빌드 산출물을
 * STEP 방출(intentToStep)→재임포트(replicad WASM)→체적 유한/양수 검증. 케이스당
 * 수 초의 실연산이라 캠페인/드릴이 명시적으로 켠다(기본 off=not_run).
 */
export async function validateCase(corpusEntry, input, opts = {}) {
  const { caseValue, campaign, repeat } = input;
  const subject = opts.subject ?? 'rebuild';
  const axes = axesOfCase(caseValue);
  const results = new Map();
  const notRun = (axis, reason) => results.set(axis, { axis, status: 'not_run', reason });
  const judged = (axis, ok, reason) => results.set(axis, { axis, status: ok ? 'pass' : 'fail', reason });

  if (subject === 'ai') {
    return validateCaseAiSubject(corpusEntry, input, opts, { axes, results, notRun, judged });
  }

  let rebuilt = null;
  let rebuildError = null;
  if (!corpusEntry) {
    rebuildError = 'corpus_entry_missing';
  } else {
    try {
      rebuilt = buildAssemblyTemplate(
        CANDIDATE_DOMAIN_MAP[corpusEntry.domain] ?? corpusEntry.domain,
        corpusEntry.templateId,
        corpusEntry.parameters,
      );
    } catch (error) {
      rebuildError = error instanceof Error ? error.message : String(error);
    }
  }

  judged('requirements', !rebuildError, rebuildError ? `rebuild_failed:${rebuildError}` : 'rebuild_ok_with_corpus_parameters');

  if (rebuilt) {
    const hash = hashAssemblyArtifact(rebuilt);
    judged('dimensions', hash === corpusEntry.artifactHash,
      hash === corpusEntry.artifactHash
        ? 'artifact_hash_deterministic_across_processes'
        : `artifact_hash_mismatch:${hash.slice(0, 12)}!=${String(corpusEntry.artifactHash).slice(0, 12)}`);

    const parts = rebuilt.parts ?? [];
    const roles = [...new Set(parts.map(part => part.role).filter(Boolean))].sort();
    const expected = corpusEntry.artifactSummary ?? {};
    const defsOk = parts.length === expected.partCount
      && JSON.stringify(roles) === JSON.stringify(expected.roles ?? []);
    judged('part_definitions', defsOk,
      defsOk ? `part_count_${parts.length}_roles_match` : `part_defs_mismatch:${parts.length}/${expected.partCount}`);

    const alignmentErrors = rebuilt.alignmentErrors ?? [];
    const unverified = parts.filter(part => part.unverified === true).length;
    judged('collision_clearance', alignmentErrors.length === 0 && unverified === 0,
      alignmentErrors.length === 0 && unverified === 0
        ? 'alignment_gate_clean_on_rebuild'
        : `alignment_gate:${alignmentErrors.length}err_${unverified}unverified`);

    if (opts.roundtrip) {
      // W1-2 — STEP 왕복 실측: 방출(드롭 0)→재임포트→메시 체적 유한/양수.
      // 실패는 사유와 함께 fail — 왕복이 안 되는 산출물을 통과시키지 않는다.
      try {
        const { buildAssembly } = await import('./drawing-to-3d/assembly.mjs');
        const { intentToStep, ensureReplicad } = await import('./drawing-to-3d/to-step.mjs');
        const built = buildAssembly(rebuilt);
        if (!built.ok) {
          judged('step_roundtrip', false, `assembly_gate_failed:${(built.gateErrors ?? []).join(',').slice(0, 80)}`);
        } else {
          const st = await intentToStep(built.composeIntent);
          const dropped = st.fuseReport?.dropped ?? [];
          if (!st.step || dropped.length > 0) {
            judged('step_roundtrip', false, `step_emit_incomplete:${dropped.length}dropped`);
          } else {
            const rc = await ensureReplicad();
            const shape = await rc.importSTEP(new Blob([st.step]));
            const mesh = shape.mesh({ tolerance: 0.5, angularTolerance: 15 });
            let vol6 = 0;
            const v = mesh.vertices, tri = mesh.triangles;
            for (let t = 0; t < tri.length; t += 3) {
              const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
              vol6 += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1])
                + v[a + 1] * (v[b + 2] * v[c] - v[b] * v[c + 2])
                + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
            }
            const volume = Math.abs(vol6 / 6);
            judged('step_roundtrip', Number.isFinite(volume) && volume > 0,
              Number.isFinite(volume) && volume > 0
                ? `reimport_ok_volume_${volume.toFixed(0)}mm3`
                : 'reimport_volume_invalid');
          }
        }
      } catch (error) {
        judged('step_roundtrip', false, `roundtrip_failed:${(error instanceof Error ? error.message : String(error)).slice(0, 80)}`);
      }
    }
  } else {
    judged('dimensions', false, `rebuild_unavailable:${rebuildError}`);
    judged('part_definitions', false, `rebuild_unavailable:${rebuildError}`);
    judged('collision_clearance', false, `rebuild_unavailable:${rebuildError}`);
    if (opts.roundtrip) judged('step_roundtrip', false, `rebuild_unavailable:${rebuildError}`);
  }

  for (const axis of axes) {
    if (!results.has(axis)) notRun(axis, MEASURED_AXES.has(axis) ? 'unexpected_gap' : `dryrun_v1_out_of_scope:${axis}`);
  }

  return assembleRun(caseValue, campaign, repeat, axes, results);
}

function assembleRun(caseValue, campaign, repeat, axes, results) {
  const assertions = axes.map(axis => results.get(axis));
  return {
    caseId: caseValue.caseId,
    domain: caseValue.domain,
    campaign,
    repeat,
    usedForTuning: false,
    sourceHash: caseValue.sourceHash,
    requiredGatesPassed: assertions
      .filter(item => item.status !== 'not_run')
      .every(item => item.status === 'pass'),
    falseVerified: false,
    falseClear: false,
    destructivePartMerge: false,
    assertions,
  };
}

/** W1-1 — AI 생성 주체 판정. 측정 축: requirements(생성+게이트)·part_definitions
 *  (부품수·역할 vs GT)·collision_clearance(정렬 게이트). dimensions 는 홀드아웃
 *  assertion 공차정책이 정본이라 not_run(템플릿 해시 등가로 대신하면 날조). */
async function validateCaseAiSubject(corpusEntry, input, opts, ctx) {
  const { caseValue, campaign, repeat } = input;
  const { axes, results, notRun, judged } = ctx;
  const spec = corpusEntry?.sourceSpec;
  let generated = null;
  let genError = null;

  if (!corpusEntry) genError = 'corpus_entry_missing';
  else if (typeof spec !== 'string' || !spec.trim()) genError = 'source_spec_missing:ai_subject_requires_holdout_spec';
  else if (typeof opts.generate !== 'function') genError = 'generator_unavailable';
  else {
    try {
      generated = await opts.generate(spec);
    } catch (error) {
      genError = `generation_failed:${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const asm = generated?.assembly ?? null;
  const genOk = !genError && !!asm && !generated.allFailed
    && (generated.gateErrors ?? []).length === 0 && (generated.dropped ?? []).length === 0;
  judged('requirements', genOk, genOk
    ? 'ai_generation_ok_gates_clean'
    : (genError ?? `ai_generation_degraded:${(generated?.gateErrors ?? []).length}err_${(generated?.dropped ?? []).length}dropped`));

  if (asm) {
    const parts = asm.parts ?? [];
    const roles = [...new Set(parts.map(part => part.role).filter(Boolean))].sort();
    const expected = corpusEntry.artifactSummary ?? {};
    const defsOk = parts.length === expected.partCount
      && JSON.stringify(roles) === JSON.stringify(expected.roles ?? []);
    judged('part_definitions', defsOk,
      defsOk ? `ai_part_count_${parts.length}_roles_match` : `ai_part_defs_mismatch:${parts.length}/${expected.partCount}`);
    const alignmentErrors = asm.alignmentErrors ?? [];
    const unverified = parts.filter(part => part.unverified === true).length;
    judged('collision_clearance', alignmentErrors.length === 0 && unverified === 0,
      alignmentErrors.length === 0 && unverified === 0
        ? 'ai_alignment_gate_clean'
        : `ai_alignment_gate:${alignmentErrors.length}err_${unverified}unverified`);
  } else {
    judged('part_definitions', false, `ai_output_unavailable:${genError}`);
    judged('collision_clearance', false, `ai_output_unavailable:${genError}`);
  }
  notRun('dimensions', 'ai_subject_dimension_gt_requires_holdout_assertions');

  for (const axis of axes) {
    if (!results.has(axis)) notRun(axis, `dryrun_v1_out_of_scope:${axis}`);
  }
  return assembleRun(caseValue, campaign, repeat, axes, results);
}

export function loadCorpus(file) {
  const parsed = JSON.parse(readFileSync(resolve(file), 'utf8'));
  if (!Array.isArray(parsed)) throw new TypeError('corpus must be a JSON array of candidate entries');
  return new Map(parsed.map(entry => [entry.caseId, entry]));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  (async () => {
    const args = process.argv.slice(2);
    const index = args.indexOf('--corpus');
    const corpusFile = index >= 0 ? args[index + 1] : undefined;
    if (!corpusFile) throw new TypeError('--corpus <candidate-manifest.json> is required');
    const corpus = loadCorpus(corpusFile);
    const subjectIndex = args.indexOf('--subject');
    const subject = subjectIndex >= 0 ? args[subjectIndex + 1] : 'rebuild';
    const roundtrip = args.includes('--roundtrip');
    const generate = subject === 'ai'
      ? async spec => (await import('./drawing-to-3d/from-text.mjs')).textToAssembly(spec)
      : undefined;
    const input = JSON.parse(await readStdin());
    const run = await validateCase(corpus.get(input.caseValue.caseId), input, { subject, generate, roundtrip });
    process.stdout.write(`${JSON.stringify(run)}\n`);
  })().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
