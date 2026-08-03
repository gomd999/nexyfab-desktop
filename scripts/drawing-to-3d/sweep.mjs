/**
 * 파라미터 스윕 — 데이터 트리(Grasshopper) 효용을 **채팅형으로** 채운다.
 *
 * ## 왜 노드 그래프가 아니라 이것인가
 * 갭 매트릭스 빈칸 ④ 는 「데이터 트리」였다. 그 효용의 핵심은 **변형 배열 생성**인데,
 * 그건 노드를 그려야만 되는 일이 아니다. 우리는 이미 갖고 있다:
 * ```
 *   템플릿 56종 · 파라미터 357개 · **전부 min/max 또는 enum 보유**
 * ```
 * 그래서 「기둥 간격 3000~5000 을 500 단위로 다 뽑아줘」를 말로 받아 결정론적으로 돈다.
 * 노드 UI 를 안 만드는 대신 **타입을 우리가 알고 있어서 검증까지 된다** — 노드 그래프는
 * 그 검증을 사용자에게 떠넘긴다.
 *
 * ## 정직성 규약
 * - **범위 밖 값을 조용히 자르지 않는다.** 클램프하고 그 사실을 `clamped[]` 로 낸다.
 *   말없이 자르면 사용자는 자기가 요청한 값이 돈 줄 안다.
 * - **조합 수 상한을 넘으면 자르지 않고 거부한다.** 「상위 N개만 돌렸다」는 조용한 truncation
 *   이고, 그러면 「전부 봤다」로 읽힌다(§10 no silent caps).
 * - **실패한 변형을 빼지 않는다.** 게이트에 걸린 조합도 결과에 남긴다 — 어디까지가 가능
 *   영역인지가 이 기능의 답이다.
 */
import { buildAssemblyTemplate, listAssemblyTemplates } from './domain-assemblies.mjs';
import { buildAssembly } from './assembly.mjs';

/** 한 번에 도는 변형 수 상한. 넘으면 **거부**한다(잘라내지 않는다). */
export const SWEEP_MAX = 120;

/**
 * 스윕 축 정규화: `{from,to,step}` 또는 값 배열 또는 단일 값 → 값 배열.
 * @returns {{values:number[]|string[], err?:string}}
 */
function axisValues(spec) {
  if (Array.isArray(spec)) {
    return spec.length ? { values: spec } : { values: [], err: '빈 배열' };
  }
  if (spec && typeof spec === 'object') {
    const { from, to, step } = spec;
    if (![from, to, step].every((v) => Number.isFinite(Number(v)))) return { values: [], err: '{from,to,step} 이 숫자가 아니다' };
    const f = Number(from), t = Number(to), s = Math.abs(Number(step));
    if (!(s > 0)) return { values: [], err: 'step 은 0 보다 커야 한다' };
    if (t < f) return { values: [], err: `to(${t}) 가 from(${f}) 보다 작다` };
    const out = [];
    // 부동소수 누적 오차로 마지막 값이 빠지는 것을 막는다(3000~5000 step 500 → 5000 포함).
    const n = Math.floor((t - f) / s + 1e-9);
    for (let i = 0; i <= n; i++) out.push(+(f + i * s).toFixed(6));
    return { values: out };
  }
  if (spec !== undefined && spec !== null) return { values: [spec] };
  return { values: [], err: '축 지정이 비었다' };
}

/**
 * 템플릿 파라미터 스윕.
 *
 * @param {{domain:string, id:string, sweep:Record<string, object|Array|number>,
 *          fixed?:Record<string, number|string>, max?:number}} spec
 * @returns {{ok:boolean, errors:string[], template?:object, axes?:object,
 *   total?:number, variants?:Array, best?:object, clamped?:string[], summary?:object}}
 */
export function sweepTemplate(spec = {}) {
  const errors = [];
  const tpl = listAssemblyTemplates().find((t) => t.domain === spec.domain && t.id === spec.id);
  if (!tpl) {
    const near = listAssemblyTemplates().filter((t) => t.id === spec.id).map((t) => `${t.domain}/${t.id}`);
    return { ok: false, errors: [`템플릿 '${spec.domain}/${spec.id}' 없음${near.length ? ` — 도메인이 다르다: ${near.join(', ')}` : ''}`] };
  }
  const paramByName = new Map(tpl.params.map((p) => [p.name, p]));

  // ── 축 해석 + 범위 검사 ────────────────────────────────────────────────────
  const axes = {};
  const clamped = [];
  for (const [name, raw] of Object.entries(spec.sweep ?? {})) {
    const meta = paramByName.get(name);
    if (!meta) { errors.push(`'${name}' 은 ${tpl.id} 의 파라미터가 아니다 — ${[...paramByName.keys()].join('·')}`); continue; }
    const { values, err } = axisValues(raw);
    if (err) { errors.push(`'${name}': ${err}`); continue; }
    if (meta.enum) {
      const bad = values.filter((v) => !meta.enum.includes(v));
      if (bad.length) errors.push(`'${name}': 허용 밖 값 ${bad.join(',')} — ${meta.enum.join('·')}`);
      axes[name] = values.filter((v) => meta.enum.includes(v));
      continue;
    }
    /**
     * ⚠ 범위 밖은 **클램프하고 알린다.** 조용히 자르면 사용자는 자기가 요청한 값이
     *   돌아간 줄 안다 — 그게 「최적이 경계에 있다」는 잘못된 결론을 만든다.
     */
    axes[name] = values.map((v) => {
      const n = Number(v);
      const lo = Number.isFinite(meta.min) ? meta.min : -Infinity;
      const hi = Number.isFinite(meta.max) ? meta.max : Infinity;
      const c = Math.min(hi, Math.max(lo, n));
      if (c !== n) clamped.push(`${name}=${n} → ${c} (허용 ${meta.min}~${meta.max})`);
      return c;
    });
    // 클램프로 중복이 생기면 하나로 — 같은 조합을 두 번 돌 이유가 없다
    axes[name] = [...new Set(axes[name])];
  }
  const names = Object.keys(axes);
  if (!names.length) errors.push('스윕할 축이 없다 — sweep:{파라미터명:{from,to,step}} 형태로 준다');
  if (errors.length) return { ok: false, errors, ...(clamped.length ? { clamped } : {}) };

  const total = names.reduce((a, n) => a * axes[n].length, 1);
  const cap = Math.min(SWEEP_MAX, Math.max(1, Math.floor(Number(spec.max) || SWEEP_MAX)));
  if (total > cap) {
    return {
      ok: false,
      errors: [`조합 ${total}개 > 상한 ${cap} — **자르지 않고 거부한다.** 축을 줄이거나 step 을 키워라`
        + `(${names.map((n) => `${n}:${axes[n].length}`).join(' × ')})`],
      total, axes,
    };
  }

  // ── 데카르트 곱 ────────────────────────────────────────────────────────────
  const combos = [{}];
  for (const n of names) {
    const next = [];
    for (const base of combos) for (const v of axes[n]) next.push({ ...base, [n]: v });
    combos.length = 0; combos.push(...next);
  }

  const variants = [];
  for (const params of combos) {
    const row = { params: { ...params } };
    try {
      const asm = buildAssemblyTemplate(tpl.domain, tpl.id, { ...(spec.fixed ?? {}), ...params });
      if (!asm || (asm.alignmentErrors ?? []).length) {
        row.ok = false; row.reason = (asm?.alignmentErrors ?? ['템플릿이 형상을 못 만들었다'])[0].slice(0, 120);
        variants.push(row); continue;
      }
      const b = buildAssembly(asm, { autoPlace: true });
      row.ok = !!b.ok;
      row.parts = asm.parts.length;
      row.gateErrors = (b.gateErrors ?? []).length;
      if (row.gateErrors) row.reason = b.gateErrors[0].slice(0, 120);
      row.designOk = b.designOk ?? null;
      row.floating = b.support?.floating?.length ?? null;
      row.interferences = b.interferences?.length ?? null;
      row.massKg = b.structural?.totalMassKg ?? null;
      if (b.mobility) row.mobility = b.mobility.mobility;
    } catch (e) {
      row.ok = false; row.reason = String(e?.message ?? e).slice(0, 120);
    }
    variants.push(row);
  }

  const feasible = variants.filter((v) => v.ok && v.designOk);
  // 「최적」을 우리가 정하지 않는다 — 질량 최소는 **한 가지 기준**일 뿐이라고 이름에 적는다.
  const lightest = feasible.length
    ? feasible.reduce((a, v) => ((v.massKg ?? Infinity) < (a.massKg ?? Infinity) ? v : a))
    : null;

  return {
    ok: true,
    errors: [],
    template: { domain: tpl.domain, id: tpl.id, labelKo: tpl.labelKo },
    axes: Object.fromEntries(names.map((n) => [n, axes[n]])),
    total, variants,
    ...(clamped.length ? { clamped } : {}),
    summary: {
      feasible: feasible.length,
      infeasible: variants.length - feasible.length,
      massRangeKg: feasible.length
        ? [Math.min(...feasible.map((v) => v.massKg ?? 0)), Math.max(...feasible.map((v) => v.massKg ?? 0))].map((v) => +v.toFixed(1))
        : null,
      /** ⚠ 「최적」이 아니라 「이 기준으로 가장 가벼운 것」이다. 기준은 사용자가 정한다. */
      lightestByMass: lightest ? { params: lightest.params, massKg: lightest.massKg } : null,
      note: '가능/불가능을 전부 남긴다 — 어디까지가 가능 영역인지가 스윕의 답이다. '
        + '「최적」은 정하지 않는다(질량 최소는 한 가지 기준일 뿐이다).',
    },
  };
}
