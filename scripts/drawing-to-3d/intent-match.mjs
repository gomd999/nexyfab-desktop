/**
 * intent-match.mjs — 요청 정합 검사 ("시킨 것과 다른 걸 만든다" 대응, 260717).
 *
 * 원리(생성≠검증의 의도 레벨 확장):
 *   ① AI 는 요청문에서 **형상으로 검증 가능한 요구**(수량·치수·존재·배치관계)만 추출
 *      — 명시 안 된 것 추측 금지, 원문 인용 동반.
 *   ② 판정은 **결정론**: 생성된 어셈블리를 실측(placedAabb·params·openings·지지관계)해
 *      항목별 MATCH / MISMATCH / UNVERIFIABLE — 검증 불가를 억지로 판정하지 않는다(정직).
 *   ③ 결과는 그물 패널에 표시 — 불일치가 "조용히" 넘어가지 않게.
 */
import { placedAabb } from './assembly.mjs';

const NUM = { type: 'NUMBER' };
export const CLAIMS_SCHEMA = {
  type: 'OBJECT', required: ['claims'],
  properties: {
    claims: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT', required: ['kind', 'text'],
        properties: {
          kind: { type: 'STRING', enum: ['count', 'dimension', 'exists', 'relation'] },
          text: { type: 'STRING' },
          part: { type: 'STRING' },
          part2: { type: 'STRING' },
          relation: { type: 'STRING', enum: ['on', 'above', 'inside', 'beside'] },
          value: NUM,
          unit: { type: 'STRING', enum: ['mm', 'cm', 'm', 'km'] },
          dim: { type: 'STRING', enum: ['width', 'depth', 'height', 'length', 'diameter', 'max'] },
          count: NUM,
        },
      },
    },
  },
};

// ⚠️ 이 프롬프트는 thinking 기본값으로 호출할 것 — thinkingBudget:0 은 flash 가
// 조용히 {"claims":[]} 를 내고 pro 는 400 거부(260717 라이브 프로브로 확인).
export const CLAIMS_PROMPT = (desc) => `아래 제품 설명문에 명시된 요구사항을 항목별로 추출하라.
종류: count(수량 요구 — 예 "다리 4개" → count:4), dimension(치수 요구 — 예 "높이 700" → value:700, unit, dim), exists(부품 존재 요구 — 예 "선반이 있어야"), relation(배치 요구 — 예 "상판이 다리 위에" → part2, relation은 on|above|inside|beside).
규칙:
- 설명문에 명시된 것만 추출(추측·상식 보충 금지). 재질·용도·미감 요구는 제외.
- text = 원문 해당 구절 그대로 인용. 치수는 value 숫자 + unit(mm|cm|m|km, 원문 단위).
- part = 대상 키워드 1단어(예 "다리", "상판", "벽"). 해당 종류에 필요한 필드만 채워라.
설명문: "${desc}"`;

// 한국어/영어 키워드 → role/type 후보 (부품 매칭 사전 — 확장 지점)
const KW_MAP = [
  [/다리|leg|포스트|post|기둥|column/i, ['column', 'leg', 'post']],
  [/상판|천판|top|판재|plate/i, ['table', 'top', 'plate', 'counter']],
  [/테이블|table|책상|desk/i, ['table', 'desk', 'top']],
  [/옹벽|retaining/i, ['retaining', 'stem']], // 구체어 우선(일반 '벽'보다 먼저)
  [/벽|wall/i, ['wall']],
  [/문|door/i, ['door']],
  [/창|window/i, ['window']],
  [/보|beam|거더|girder/i, ['beam', 'girder']],
  [/슬래브|slab|바닥판/i, ['slab']],
  [/바닥|floor|데크|deck/i, ['floor', 'deck']],
  [/탱크|tank|용기|베셀|vessel|드럼/i, ['tank', 'vessel']],
  [/펌프|pump|모터|motor/i, ['pump', 'motor']],
  [/프레임|frame|골조/i, ['frame', 'column', 'beam']],
  [/선반|shelf/i, ['shelf']],
  [/플랜지|flange/i, ['flange']],
  [/파이프|pipe|관|tube/i, ['tube', 'pipe']],
  [/볼트|bolt/i, ['bolt']],
  [/기어|gear/i, ['gear']],
  // 비기계 도메인 확장(260717): 건축·토목·조경·인테리어 대상어
  [/계단|stair|디딤/i, ['stair', 'step', 'tread']],
  [/난간|handrail|baluster/i, ['rail', 'handrail', 'baluster']],
  [/서까래|rafter/i, ['rafter']],
  [/장선|joist/i, ['joist']],
  [/지붕|roof/i, ['roof']],
  [/천장|ceiling/i, ['ceiling']],
  [/싱크|sink|개수대/i, ['sink']],
  [/변기|toilet/i, ['toilet', 'wc']],
  [/세면대|세면기|lavatory/i, ['basin', 'lavatory']],
  [/욕조|bathtub|tub/i, ['bath', 'tub']],
  [/암거|culvert/i, ['culvert']],
  [/집수정|맨홀|manhole|catch/i, ['basin', 'manhole', 'catch']],
  [/기초|footing|foundation|매트/i, ['footing', 'foundation', 'base', 'mat']],
  [/브래킷|bracket|거세트|gusset/i, ['bracket', 'gusset']],
  [/리브|rib/i, ['rib']],
  [/수납장|캐비닛|cabinet/i, ['cabinet']],
  [/서랍|drawer/i, ['drawer']],
  [/파고라|퍼걸러|pergola/i, ['pergola', 'post', 'rafter']],
  [/카운터|counter|조리대/i, ['counter']],
];

const UNIT_MM = { mm: 1, cm: 10, m: 1000, km: 1e6 };
const toMm = (v, u) => Number(v) * (UNIT_MM[u] ?? 1);

function matchParts(parts, keyword) {
  if (!keyword) return [];
  const kw = String(keyword).toLowerCase();
  const cand = KW_MAP.find(([re]) => re.test(kw))?.[1] ?? [kw];
  return parts.filter((p) => {
    const hay = `${p.id ?? ''} ${p.role ?? ''} ${p.type ?? ''} ${p.name ?? ''}`.toLowerCase();
    return cand.some((c) => hay.includes(c)) || hay.includes(kw);
  });
}

// 문/창 수량은 부품이 아니라 wall_with_openings 의 개구(문=sill 0 · 창=sill>0)
function openingCount(parts, keyword) {
  const isDoor = /문|door/i.test(keyword ?? '');
  const isWin = /창|window/i.test(keyword ?? '');
  if (!isDoor && !isWin) return null;
  let n = 0;
  for (const p of parts) {
    if (p.type !== 'wall_with_openings') continue;
    for (const o of p.params?.openings ?? []) {
      const sill = Number(o.sill) || 0;
      if ((isDoor && sill === 0) || (isWin && sill > 0)) n++;
    }
  }
  return n;
}

const dimsOf = (p) => {
  const b = placedAabb(p);
  const env = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  return { env, params: p.params ?? {} };
};

/**
 * 결정론 판정. AI 추출 claims → 항목별 MATCH/MISMATCH/UNVERIFIABLE.
 * 치수 허용오차: max(2%, 5mm) — 기본값 채움·라운딩 여유(명시).
 */
export function verifyClaims(claims, assembly) {
  const parts = assembly?.parts ?? [];
  const results = [];
  for (const c of claims ?? []) {
    const r = { kind: c.kind, text: c.text, verdict: 'UNVERIFIABLE', note: '' };
    try {
      if (c.kind === 'count') {
        const want = Number(c.count ?? c.value);
        if (!(want > 0)) { r.note = '수량 값 없음'; results.push(r); continue; }
        const viaOpen = openingCount(parts, c.part);
        const got = viaOpen ?? matchParts(parts, c.part).length;
        if (viaOpen === null && got === 0 && !matchParts(parts, c.part).length && !c.part) { r.note = '대상 미상'; results.push(r); continue; }
        r.found = got;
        r.verdict = got === want ? 'MATCH' : 'MISMATCH';
        r.note = `요구 ${want} vs 생성 ${got}(${c.part ?? '전체'})`;
      } else if (c.kind === 'exists') {
        const got = (openingCount(parts, c.part) ?? matchParts(parts, c.part).length);
        r.found = got;
        r.verdict = got >= 1 ? 'MATCH' : 'MISMATCH';
        r.note = got >= 1 ? `${c.part}: ${got}개 존재` : `${c.part}: 없음`;
      } else if (c.kind === 'dimension') {
        const wantMm = toMm(c.value, c.unit ?? 'mm');
        if (!(wantMm > 0)) { r.note = '치수 값 없음'; results.push(r); continue; }
        const tol = Math.max(wantMm * 0.02, 5);
        const targets = c.part ? matchParts(parts, c.part) : parts;
        if (!targets.length && c.part) {
          // 부품 미매칭 → **전체 조립 외형(월드 AABB union)** 대조 폴백 — "테이블 높이 720"처럼
          // 대상어가 조립 전체를 가리키는 경우(부품별 최대치는 다리 690 등으로 오판)
          const world = parts.map((p) => placedAabb(p))
            .filter((b) => [0, 1, 2].every((k) => Number.isFinite(b.min[k]) && Number.isFinite(b.max[k])));
          if (world.length) {
            const envAsm = [0, 1, 2].map((k) => Math.max(...world.map((b) => b.max[k])) - Math.min(...world.map((b) => b.min[k])));
            r.verdict = envAsm.some((v) => Math.abs(v - wantMm) <= tol) ? 'MATCH' : 'UNVERIFIABLE';
            r.note = `부품 '${c.part}' 미매칭 — 전체 외형 ${envAsm.map((v) => Math.round(v)).join('×')}mm 대조`;
          } else r.note = `부품 '${c.part}' 미매칭`;
          results.push(r); continue;
        }
        // 후보 풀 — 부품 자체 치수 + **월드 상면고**(예: "테이블 높이 730"=상판 상면−지면) +
        // 전체 엔벨로프(높이류 요구는 흔히 조립 전체를 가리킴 — 최근접 대조라 과잉매칭은 tol 로 제한)
        const asmMinZ = Math.min(...parts.map((p) => placedAabb(p).min[2]));
        let best = null;
        for (const p of targets) {
          const { env, params } = dimsOf(p);
          const worldTopH = placedAabb(p).max[2] - asmMinZ;
          const candidates = [
            ...env, worldTopH,
            ...['width', 'depth', 'height', 'length', 'diameter', 'outerDia'].map((k) => Number(params[k])).filter((v) => v > 0),
          ];
          const pool = c.dim && c.dim !== 'max' && c.dim !== 'height'
            ? [Number(params[c.dim]), env[{ width: 0, depth: 1, length: 1, diameter: 0 }[c.dim] ?? 2]].filter((v) => v > 0)
            : c.dim === 'max' || c.dim === 'height' ? [Math.max(...env), worldTopH, Number(params.height)].filter((v) => v > 0) : candidates;
          for (const v of pool) {
            const dvi = Math.abs(v - wantMm);
            if (best === null || dvi < best.dv) best = { dv: dvi, v };
          }
        }
        if (!best) { r.note = '실측 후보 없음'; results.push(r); continue; }
        r.found = Math.round(best.v);
        r.verdict = best.dv <= tol ? 'MATCH' : 'MISMATCH';
        r.note = `요구 ${Math.round(wantMm)}mm vs 최근접 실측 ${Math.round(best.v)}mm(±${Math.round(tol)})`;
      } else if (c.kind === 'relation') {
        const A = matchParts(parts, c.part), B = matchParts(parts, c.part2);
        if (!A.length || !B.length) { r.note = `대상 미매칭(${c.part}/${c.part2})`; results.push(r); continue; }
        const rel = c.relation ?? 'on';
        const ok = A.some((pa) => B.some((pb) => {
          const a = placedAabb(pa), b = placedAabb(pb);
          const xy = Math.min(a.max[0], b.max[0]) > Math.max(a.min[0], b.min[0]) && Math.min(a.max[1], b.max[1]) > Math.max(a.min[1], b.min[1]);
          if (rel === 'on') return xy && Math.abs(a.min[2] - b.max[2]) <= 10;
          if (rel === 'above') return xy && a.min[2] >= b.max[2] - 10;
          if (rel === 'inside') return a.min.every((v, k) => v >= b.min[k] - 1) && a.max.every((v, k) => v <= b.max[k] + 1);
          if (rel === 'beside') return Math.abs(a.min[2] - b.min[2]) < Math.max(200, (b.max[2] - b.min[2]) / 2) && !xy;
          return false;
        }));
        r.verdict = ok ? 'MATCH' : 'MISMATCH';
        r.note = `${c.part} ${rel} ${c.part2}`;
      }
    } catch (e) { r.verdict = 'UNVERIFIABLE'; r.note = '판정 오류: ' + (e?.message ?? e); }
    results.push(r);
  }
  const matched = results.filter((q) => q.verdict === 'MATCH').length;
  const mismatched = results.filter((q) => q.verdict === 'MISMATCH').length;
  const unverifiable = results.filter((q) => q.verdict === 'UNVERIFIABLE').length;
  return { results, matched, mismatched, unverifiable };
}

/** 선형(civilAlignment) 전용 결정론 대조 — 연장·곡선 R·구조물 존재. */
export function verifyAlignmentClaims(claims, alignment) {
  const results = [];
  for (const c of claims ?? []) {
    const r = { kind: c.kind, text: c.text, verdict: 'UNVERIFIABLE', note: '' };
    const kw = `${c.part ?? ''} ${c.text ?? ''}`;
    if (c.kind === 'dimension' && /연장|길이|length/i.test(kw) && Number(c.value) > 0) {
      const wantMm = toMm(c.value, c.unit ?? 'm');
      const tol = Math.max(wantMm * 0.02, 1000);
      r.found = Math.round(alignment.totalMm);
      r.verdict = Math.abs(alignment.totalMm - wantMm) <= tol ? 'MATCH' : 'MISMATCH';
      r.note = `연장 요구 ${Math.round(wantMm / 1000)}m vs 생성 ${Math.round(alignment.totalMm / 1000)}m`;
    } else if (c.kind === 'dimension' && /반경|R\b|radius/i.test(kw) && Number(c.value) > 0) {
      const wantMm = toMm(c.value, c.unit ?? 'm');
      const tol = Math.max(wantMm * 0.02, 500);
      const hit = (alignment.curveTable ?? []).some((ct) => Math.abs(ct.R - wantMm) <= tol);
      r.verdict = hit ? 'MATCH' : (alignment.curveTable ?? []).length ? 'MISMATCH' : 'MISMATCH';
      r.note = `곡선 R ${(alignment.curveTable ?? []).map((ct) => Math.round(ct.R / 1000) + 'm').join(',') || '없음'}`;
    } else if ((c.kind === 'count' || c.kind === 'exists') && /곡선|커브|curve/i.test(kw)) {
      // 곡선 수량/존재 — 곡선은 부품이 아니라 curveTable 이 실측(부품 매칭 거짓 MISMATCH 방지)
      const got = (alignment.curveTable ?? []).length;
      const want = c.kind === 'count' ? Number(c.count ?? c.value) : 1;
      r.found = got;
      r.verdict = (c.kind === 'count' ? got === want : got >= 1) ? 'MATCH' : 'MISMATCH';
      r.note = `곡선 ${got}개소`;
    } else if ((c.kind === 'exists' || c.kind === 'count') && /암거|culvert|집수정|basin|신축|joint/i.test(kw)) {
      const map = { 암거: 'culvert', culvert: 'culvert', 집수정: 'catch_basin', basin: 'catch_basin', 신축: 'expansion_joint', joint: 'expansion_joint' };
      const key = Object.entries(map).find(([k]) => kw.toLowerCase().includes(k))?.[1];
      const got = (alignment.structures ?? []).filter((s) => !key || s.type === key).length;
      const want = c.kind === 'count' ? Number(c.count ?? c.value) : 1;
      r.found = got;
      r.verdict = (c.kind === 'count' ? got === want : got >= 1) ? 'MATCH' : 'MISMATCH';
      r.note = `구조물 ${key ?? '전체'}: ${got}개`;
    } else { r.note = '선형 대조 항목 아님'; }
    results.push(r);
  }
  const matched = results.filter((q) => q.verdict === 'MATCH').length;
  const mismatched = results.filter((q) => q.verdict === 'MISMATCH').length;
  return { results, matched, mismatched, unverifiable: results.length - matched - mismatched };
}
