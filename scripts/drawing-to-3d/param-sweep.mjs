/**
 * param-sweep.mjs — ① 안전범위 밴드 + ② 목표 기반 자동 탐색 (검증 연동 편집의 핵심).
 *
 * 파라미터 1개를 [min,max] 구간에서 스윕: 각 점마다 어셈블리 재빌드 + 해당 분야
 * 체인 실행 → PASS/FAIL 밴드. 목표 탐색은 스윕 밴드에서 경계 감지 후 이분법 정밀화
 * (단조 가정 명시 — 비단조면 밴드 원본을 그대로 반환하고 정직 노트).
 *
 * 판정 규약: 체인 결과 트리에서 verdict 필드를 재귀 수집 — 'FAIL' 하나라도 있으면
 * fail, 'PASS' 최소 1개 필요(INPUT/ERROR/INFO는 판정 불계 — 목록으로 동봉해 은폐 없음).
 */
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { loadPathCheck } from './load-path.mjs';
import { landscapeCheck } from './landscape-check.mjs';
import { interiorCheck } from './interior-check.mjs';
import { bridgeCheck } from './bridge-check.mjs';

const CHAINS = {
  building: loadPathCheck,
  landscape: landscapeCheck,
  interior: interiorCheck,
  bridge: bridgeCheck,
};

/** verdict 재귀 수집 */
export function collectVerdicts(node, path = '', out = []) {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.verdict === 'string') out.push({ path: path || 'root', verdict: node.verdict });
  for (const [k, v] of Object.entries(node)) {
    if (k === 'verdict' || v === null || typeof v !== 'object') continue;
    if (Array.isArray(v)) v.forEach((x, i) => collectVerdicts(x, `${path}${k}[${i}].`, out));
    else collectVerdicts(v, `${path}${k}.`, out);
  }
  return out;
}

export function overallPass(chainResult) {
  const vs = collectVerdicts(chainResult);
  const fails = vs.filter((v) => v.verdict === 'FAIL');
  const passes = vs.filter((v) => v.verdict === 'PASS');
  return { pass: fails.length === 0 && passes.length > 0, fails: fails.map((f) => f.path), passCount: passes.length, inputs: vs.filter((v) => v.verdict === 'INPUT' || v.verdict?.startsWith('INPUT')).length };
}

/** 분야별 대표 지표 (diff 카드·밴드 툴팁용) */
function headline(domain, r) {
  try {
    if (domain === 'bridge') return { label: '극한 Mu', value: r.ultimate?.Mu_kNm, unit: 'kN·m' };
    if (domain === 'building') return { label: '보 휨비율', value: r.beams?.[0]?.checks?.flexure?.ratio ?? r.beams?.[0]?.checks?.shear?.ratio, unit: '' };
    if (domain === 'landscape') return { label: '부재 휨비율', value: r.member?.checks?.flexure?.ratio, unit: '' };
    if (domain === 'interior') return { label: '보행거리', value: r.travel?.maxTravelM, unit: 'm' };
  } catch { /* fallthrough */ }
  return null;
}

/**
 * @param opts { domain, templateId, params, chainParams, param, min, max, points=8 }
 * @returns { band: [{value, pass, fails, metric}], note }
 */
export function sweepParam(opts) {
  const { domain, templateId, params = {}, chainParams = {}, param } = opts;
  const chain = CHAINS[domain];
  if (!chain) return { ok: false, error: `unknown domain '${domain}' — ${Object.keys(CHAINS).join('·')}` };
  const points = Math.max(3, Math.min(12, Math.round(opts.points ?? 8)));
  const min = Number(opts.min), max = Number(opts.max);
  if (!(min > 0 && max > min)) return { ok: false, error: 'min<max 필요' };
  const band = [];
  for (let i = 0; i < points; i++) {
    const value = Math.round(min + (max - min) * (i / (points - 1)));
    const asm = buildAssemblyTemplate(domain, templateId, { ...params, [param]: value });
    if (!asm) return { ok: false, error: `template '${domain}/${templateId}' 없음` };
    // 스윕 구간이 템플릿 선언 범위를 벗어나면 형상이 만들어지지 않는다(F10) — 체인 오류로
    // 뭉개지 말고 그 점의 사유를 그대로 싣는다(조용한 대체 금지).
    if (asm.ok === false && asm.error === 'invalid_params') {
      band.push({ value, pass: false, fails: asm.paramErrors.slice(0, 4), inputs: 0, metric: null });
      continue;
    }
    let entry;
    try {
      const r = chain(asm, chainParams);
      const ov = r?.ok === false ? { pass: false, fails: ['chain:' + (r.error ?? 'error')], passCount: 0, inputs: 0 } : overallPass(r);
      entry = { value, pass: ov.pass, fails: ov.fails.slice(0, 4), inputs: ov.inputs, metric: headline(domain, r) };
    } catch (e) {
      entry = { value, pass: false, fails: ['exception: ' + e.message.slice(0, 80)], inputs: 0, metric: null };
    }
    band.push(entry);
  }
  return { ok: true, band, note: '각 점 = 어셈블리 재빌드 + 체인 전체 재검증(결정론). INPUT 항목은 판정 불계(개수 동봉).' };
}

/**
 * 목표 탐색: 'minPass'(통과하는 최소값) | 'maxPass'(통과하는 최대값).
 * 밴드에서 경계 브래킷 감지 → 이분법 정밀화(해상도 res, 기본 10mm). 단조 가정 명시.
 */
export function searchGoal(opts) {
  const goal = opts.goal ?? 'minPass';
  const sw = sweepParam(opts);
  if (!sw.ok) return sw;
  const band = sw.band;
  const flips = [];
  for (let i = 1; i < band.length; i++) if (band[i].pass !== band[i - 1].pass) flips.push(i);
  if (!flips.length) {
    return { ok: true, result: band.every((b) => b.pass) ? 'all-pass' : 'all-fail', band, note: '구간 전체가 동일 판정 — 경계 없음. 구간을 넓혀 재시도.' };
  }
  if (flips.length > 1) {
    return { ok: true, result: 'non-monotonic', band, note: '비단조(경계 2개 이상) — 이분법 부적용, 밴드 원본 참조(정직 반환).' };
  }
  const i = flips[0];
  // 브래킷 [band[i-1].value, band[i].value] — 목표 방향 확인
  let lo = band[i - 1].value, hi = band[i].value;
  const passHi = band[i].pass; // true면 증가 방향이 PASS (minPass 탐색)
  if ((goal === 'minPass') !== passHi) {
    return { ok: true, result: 'wrong-direction', band, note: `경계는 있으나 ${goal} 방향 아님(감소 시 PASS) — maxPass로 재시도 권장.` };
  }
  const { domain, templateId, params = {}, chainParams = {}, param } = opts;
  const chain = CHAINS[domain];
  const res = Math.max(1, opts.res ?? 10);
  for (let k = 0; k < 24 && hi - lo > res; k++) {
    const mid = Math.round((lo + hi) / 2);
    const asm = buildAssemblyTemplate(domain, templateId, { ...params, [param]: mid });
    let pass = false;
    try { const r = chain(asm, chainParams); pass = r?.ok !== false && overallPass(r).pass; } catch { pass = false; }
    if (pass === passHi) hi = mid; else lo = mid;
  }
  return { ok: true, result: 'found', value: goal === 'minPass' ? hi : lo, bracket: [lo, hi], band, note: `이분법 정밀화(해상도 ${res}mm) — 단조 가정 명시. 최종값은 재검증 1회로 확정 표시 권장.` };
}

// --- self-test ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('param-sweep.mjs');
if (isMain) {
  // 조경 데크 장선 간격: 좁으면 PASS, 넓으면 FAIL — 단조 경계 기대
  const sw = sweepParam({ domain: 'landscape', templateId: 'timber_deck', params: {}, chainParams: {}, param: 'joistSpacing', min: 300, max: 600, points: 6 });
  const passes = sw.band.filter((b) => b.pass).length;
  console.log('밴드:', sw.band.map((b) => `${b.value}:${b.pass ? 'P' : 'F'}`).join(' '), `(PASS ${passes})`);
  const goal = searchGoal({ domain: 'landscape', templateId: 'timber_deck', params: {}, chainParams: {}, param: 'joistSpacing', min: 300, max: 600, points: 6, goal: 'maxPass', res: 5 });
  console.log('maxPass 탐색:', goal.result, goal.value ?? '', goal.note.slice(0, 30));
  const ok = sw.ok && sw.band.length === 6 && goal.ok;
  console.log(ok ? 'param-sweep self-test: PASS' : 'param-sweep self-test: FAIL');
  if (!ok) process.exit(1);
}
