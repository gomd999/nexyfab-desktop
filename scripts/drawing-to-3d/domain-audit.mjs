/**
 * domain-audit.mjs — 5분야 판정 커버리지 감사 (260729d).
 *
 * ## 왜 리포에 두는가
 * 이 세션에 깊이를 세 번 쟀고 **세 번 다 방법이 달랐고 세 번 다 틀릴 뻔했다**:
 *  ① 표시 누락을 능력 부족으로 읽음 (교량 1.0 — 과소)
 *  ② 입력 대기를 판정으로 셈 (인테리어 14~16 — 과대)
 *  ③ 분모 확대를 저하로 읽음 (기계 2.9→2.1 — 방향 반전)
 * 임시 스크립트로 매번 새로 짜니 기준이 흔들렸다. **측정도 코드다** — 리포에 두고 고정한다.
 *
 * ## 세 가지 원칙
 *  1. **표시 계층을 거치지 않는다** — `auditDomainSafety` 로 검사 트리 원본을 순회한다.
 *  2. **이름으로 센다** — 수치만 비교하면 무엇이 늘고 무엇이 사라졌는지 놓친다.
 *  3. **소비자 도달분을 따로 센다** — 이 세션 결함 대부분이 「계산은 됐는데 안 닿음」이었고,
 *     그건 안전검토.html 만 봐서는 보이지 않는다.
 */
import { ASSEMBLY_TEMPLATES, buildAssemblyTemplate } from './domain-assemblies.mjs';
import { auditDomainSafety, domainSafetyVerdict } from './domain-dossier-verify.mjs';

const isSelf = (n) => /self[-_ ]?consistency/i.test(String(n?.kind ?? ''))
  || /자기정합/.test(String(n?.name ?? n?.labelKo ?? ''));

/** 검사 트리를 순회해 판정 항목을 **이름과 함께** 수집한다. */
export function collectJudgments(node, acc = { real: [], self: [], input: [], unjudged: [] }, path = '', depth = 0) {
  if (node == null || typeof node !== 'object' || depth > 7) return acc;
  if (Array.isArray(node)) {
    node.forEach((x, i) => collectJudgments(x, acc, `${path}[${i}]`, depth + 1));
    return acc;
  }
  const name = typeof node.labelKo === 'string' ? node.labelKo
    : (typeof node.name === 'string' ? node.name : null);
  const v = typeof node.verdict === 'string' ? node.verdict : null;
  const label = name ?? path.split('.').pop() ?? '?';

  /**
   * ⚠ **렌더러와 같은 규칙으로 센다.** 처음엔 `name` 이 있어야만 판정으로 셌더니
   * 트리 99 vs HTML 159 로 크게 어긋났다 — `verdict:'PASS'` 나 이름 없는 `pass` 를
   * 렌더러는 그리는데 수집기는 버린 것이다. 두 측정이 다른 것을 세면 **어느 쪽이
   * 맞는지 알 수 없고**, 그 상태로 비교하면 이 세션에서 세 번 겪은 오독이 반복된다.
   * 규칙 출처는 `renderGenericCheckTree` 의 분기 순서 그대로다.
   */
  if (v && /^INPUT/.test(v)) {
    acc.input.push({ label, fields: (node.needInputs ?? []).map((x) => x.field ?? x.name ?? '?') });
  } else if (v === 'PASS' || v === 'FAIL' || v === 'INFO') {
    // INFO 는 산출값 보고(합·불 아님)라 통과로 센다 — 렌더러 badge 와 같은 취급.
    (isSelf(node) ? acc.self : acc.real).push({ label, pass: v !== 'FAIL' });
  } else if (v) {
    // ⚠ `CHECK`·`ERROR` 등 **PASS/FAIL 이 아닌 verdict 는 판정이 아니다.**
    //   처음 `v !== 'PASS'` 를 FAIL 로 셌더니 배수관 기울기(CHECK)가 인테리어 FAIL 4건으로
    //   둔갑했다 — 「확인 필요」를 「기준 미달」로 바꾸는 것은 이 세션 내내 막아 온 오류다.
    acc.unjudged.push({ label, verdict: v, fields: (node.needInputs ?? []).map((x) => x.field ?? x.name ?? '?') });
  } else if (typeof node.pass === 'boolean') {
    (isSelf(node) ? acc.self : acc.real).push({ label, pass: node.pass });
  } else if (typeof node.ok === 'boolean' && name) {
    (isSelf(node) ? acc.self : acc.real).push({ label, pass: node.ok });
  } else if (name && (node.pass === null || node.ok === null)) {
    acc.unjudged.push({ label, fields: (node.needInputs ?? []).map((x) => x.field ?? x.name ?? '?') });
  }
  for (const [k, x] of Object.entries(node)) {
    if (k === 'refs' || k === 'note' || k === 'inputsEcho' || k === 'provenance' || k === 'needInputs') continue;
    if (x && typeof x === 'object') collectJudgments(x, acc, `${path}.${k}`, depth + 1);
  }
  return acc;
}

/** 템플릿 1종 감사. 소비자(요약) 도달분을 **따로** 센다. */
export function auditTemplate(domain, id, params = {}) {
  const asm = buildAssemblyTemplate(domain, id, {});
  const run = auditDomainSafety(asm, params);
  const j = run?.result ? collectJudgments(run.result) : { real: [], self: [], input: [], unjudged: [] };
  const v = domainSafetyVerdict(asm, params);
  return {
    domain, id, parts: (asm.parts ?? []).length,
    label: run?.label ?? null,
    real: j.real.length, self: j.self.length, input: j.input.length, unjudged: j.unjudged.length,
    failed: j.real.filter((x) => x.pass === false).map((x) => x.label),
    names: { real: j.real.map((x) => x.label), input: j.input.map((x) => x.label), unjudged: j.unjudged.map((x) => x.label) },
    // ── 소비자 도달분 ──────────────────────────────────────────────────────
    // verdict 는 쉬운요약이 받는 것이다. 검사 트리에 있어도 여기 없으면 **안 닿는다**.
    reachedSummary: v == null ? null : {
      ok: v.ok, failed: (v.failed ?? []).length, unavailable: (v.unavailable ?? []).length,
      judgedDespiteRefusal: v.judgedDespiteRefusal ?? 0,
    },
  };
}

/** 전 도메인 감사. */
export function auditAll(params = {}) {
  const rows = [];
  for (const [domain, list] of Object.entries(ASSEMBLY_TEMPLATES ?? {})) {
    for (const t of list) {
      try { rows.push(auditTemplate(domain, t.id, params)); }
      catch (e) { rows.push({ domain, id: t.id, error: String(e?.message ?? e).slice(0, 90) }); }
    }
  }
  return rows;
}

/**
 * 두 감사 결과의 **이름 diff**. 수치만 보면 「무엇이 늘고 무엇이 사라졌는지」를 놓친다.
 * 총량이 같아도 항목이 바뀌었을 수 있다 — 그게 회귀일 수도 있다.
 */
export function diffAudits(before, after) {
  const key = (r) => `${r.domain}/${r.id}`;
  const A = new Map(before.map((r) => [key(r), r]));
  const out = [];
  for (const b of after) {
    const a = A.get(key(b));
    if (!a) { out.push({ template: key(b), added: true, real: b.real }); continue; }
    const gained = (b.names?.real ?? []).filter((x) => !(a.names?.real ?? []).includes(x));
    const lost = (a.names?.real ?? []).filter((x) => !(b.names?.real ?? []).includes(x));
    if (gained.length || lost.length || a.real !== b.real) {
      out.push({ template: key(b), realBefore: a.real, realAfter: b.real, gained, lost });
    }
  }
  for (const a of before) if (!after.some((b) => key(b) === key(a))) out.push({ template: key(a), removed: true });
  return out;
}
