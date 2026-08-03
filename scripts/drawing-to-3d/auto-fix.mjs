/**
 * auto-fix.mjs — **오분류를 결정론으로 고쳐서 결과를 낸다** (260803).
 *
 * ## 왜 이 파일이 있는가
 * 라이브에서 「힌지 마찰 와셔 외경18·내경8·두께1」이 `flange` 로 분류돼 게이트가 막았다.
 * 게이트는 옳았다. 그런데 사용자가 받은 것은 **에러 문구**였고, 원하던 것은 **거치대 3D** 였다.
 *
 * 260803 1차로 문구를 「원인」에서 「조치」로 바꿨다(`bcd invalid` → `washer 로 바꿔라`).
 * 그래도 **여전히 사용자가 손으로 고쳐야 한다.** 그런데 이 판정은 **판단이 아니라 규칙**이다:
 * ```
 *   외경·내경·두께가 성립하고 볼트원이 통째로 없다  →  그건 플랜지가 아니라 와셔다
 * ```
 * 규칙이면 기계가 적용하면 된다. **LLM 왕복이 필요 없다.**
 *
 * ## 경계 — 무엇을 고치고 무엇을 안 고치는가
 * - ⭕ **다시 이름 붙이기**(어휘 교체)와 **이미 주어진 값의 재배치**(키 매핑·좌표계 변환)
 * - ❌ **없는 치수를 지어내는 것.** 볼트원이 *일부만* 있으면 입력 누락이지 오분류가 아니다 —
 *      그건 그대로 에러로 남긴다(누락을 추측으로 메우면 그게 날조다).
 * - ❌ **조용한 수정.** 모든 교정은 `corrections[]` 로 보고되고 호출부가 사용자에게 보여야 한다.
 *
 * ## 안전장치 — 수리가 악화시키면 되돌린다
 * 각 규칙은 적용 전후로 **그 부품을 실제로 게이트에 태워** 에러가 줄었는지 확인한다.
 * 줄지 않으면 적용하지 않는다(`repairAgainstGate` 가 어셈블리 단위로 쓰는 규율과 같다).
 *
 * @typedef {{partId:string, rule:string, from:string, to:string, note:string, assumed?:string}} Correction
 */
import { gate } from './reconstruct.mjs';

const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const gateOf = (part) => {
  try { return gate({ type: part.type, ...(part.params ?? {}) }) ?? []; }
  catch { return ['gate threw']; }
};

/**
 * 규칙 표. 새 오분류 유형이 실측되면 여기에 추가한다.
 *
 * `when(part)` → 이 규칙이 걸리는가 (보수적으로. 애매하면 false)
 * `fix(part)`  → 고친 **새 부품**(원본 불변) 또는 null(못 고침)
 * 각 규칙은 `id` 와 사람이 읽을 `note` 를 낸다.
 */
const RULES = [
  {
    id: 'flange_without_bolt_circle→washer',
    /**
     * 라이브 실측: 마찰 와셔 6개 + 힌지 마찰 와셔 4개 = 10부품 × 6에러 = 60건.
     * ⚠ 볼트원 키가 **하나라도** 있으면 걸지 않는다 — 그건 입력 누락이다.
     */
    when: (p) => p.type === 'flange'
      && pos(p.params?.outerDia) && pos(p.params?.boreDia) && pos(p.params?.thickness)
      && p.params.boreDia < p.params.outerDia
      && ['bcd', 'boltHoleD', 'boltCount'].every((k) => p.params[k] === undefined || p.params[k] === null),
    fix: (p) => ({
      ...p,
      type: 'washer',
      params: {
        outerDia: p.params.outerDia,
        boreDia: p.params.boreDia,
        thickness: p.params.thickness,
      },
    }),
    note: '볼트원이 없어 평와셔로 판단 — 외경·내경·두께를 그대로 옮겼다(치수 변경 없음)',
  },
  {
    id: 'thick_plate_no_holes→box',
    /**
     * `plate_with_holes` 게이트는 `thickness >= min(width,depth)` 를 「판재 아님」으로 막는다.
     * 맞는 규칙이다 — 판재 물량·전개·도면이 얇은 판 전제로 돌아간다. 그런데 사용자가
     * 「측판 250×4000 두께 9」처럼 **축 순서를 바꿔 적으면** 정상 형상인데도 거부된다.
     *
     * 구멍이 없으면 `plate_with_holes` 는 **`box` 와 정확히 같은 형상**이다
     * (둘 다 x=width · y=depth · z=두께/height). 그래서 치수 변경 없이 옮길 수 있다.
     * ⚠ 구멍이 있으면 걸지 않는다 — `box` 에는 홀이 없어 형상이 달라진다.
     */
    when: (p) => p.type === 'plate_with_holes'
      && pos(p.params?.width) && pos(p.params?.depth) && pos(p.params?.thickness)
      && p.params.thickness >= Math.min(p.params.width, p.params.depth)
      && !(Array.isArray(p.params.holes) && p.params.holes.length),
    fix: (p) => ({
      ...p,
      type: 'box',
      params: { width: p.params.width, depth: p.params.depth, height: p.params.thickness },
    }),
    note: '두께가 폭·깊이보다 커 판재가 아니다 — 구멍이 없어 동일 형상인 블록(box)으로 옮겼다(치수 변경 없음)',
  },
  {
    id: 'ellipsoid_equal_axes→sphere',
    /**
     * `ellipsoid` 게이트는 세 축 지름이 같으면 「구다」로 막는다(한 형상 = 한 어휘 원칙).
     * 막기만 하면 사용자에겐 그냥 에러다 — 어느 어휘가 맞는지 우리가 알고 있으니 옮겨 준다.
     * 치수는 그대로다(dx = dy = dz = diameter).
     */
    when: (p) => p.type === 'ellipsoid'
      && ['dx', 'dy', 'dz'].every((k) => pos(p.params?.[k]))
      && Math.abs(p.params.dx - p.params.dy) < 1e-9 && Math.abs(p.params.dy - p.params.dz) < 1e-9,
    fix: (p) => ({ ...p, type: 'sphere', params: { diameter: p.params.dx } }),
    note: '세 축 지름이 같아 구로 판단 — 지름을 그대로 옮겼다(치수 변경 없음)',
  },
  {
    id: 'sphere_with_three_axes→ellipsoid',
    /** 반대 방향 — `sphere` 에 dx/dy/dz 를 넣어 보내면 diameter 가 없어 게이트가 막는다. */
    when: (p) => p.type === 'sphere' && !pos(p.params?.diameter)
      && ['dx', 'dy', 'dz'].every((k) => pos(p.params?.[k])),
    fix: (p) => ({ ...p, type: 'ellipsoid', params: { dx: p.params.dx, dy: p.params.dy, dz: p.params.dz } }),
    note: '세 축 지름이 주어져 타원체로 판단 — 치수를 그대로 옮겼다',
  },
  {
    id: 'plate_rect_holes→slab_with_openings',
    /**
     * 라이브 실측: 받침판 280×240 의 「중앙 통풍구 180×130」을 원형 `holes` 에 밀어넣어
     * `hole[0..3] d invalid` 가 났다. 사각 개구는 `slab_with_openings` 가 정답 어휘다.
     * ⚠ 원형(d)과 사각(w/h)이 **섞여 있으면** 걸지 않는다 — 한 어휘로 못 담는다(composite 영역).
     */
    when: (p) => {
      if (p.type !== 'plate_with_holes') return false;
      const holes = p.params?.holes;
      if (!Array.isArray(holes) || holes.length === 0) return false;
      const rect = (h) => !pos(h?.d) && pos(h?.w) && (pos(h?.h) || pos(h?.d2));
      return holes.every(rect);
    },
    fix: (p) => {
      const { width, depth, thickness, holes } = p.params;
      if (!pos(width) || !pos(depth) || !pos(thickness)) return null;
      /**
       * ⚠ 좌표계가 다르다 — 여기가 이 규칙의 유일한 위험 지점이다.
       *   `plate_with_holes.holes[].x/y` = **중심**   (게이트: `h.x - h.d/2 >= 0`)
       *   `slab_with_openings.openings[].x/y` = **좌하단 모서리** (게이트: `o.x + o.w <= length`)
       *   그래서 `x_corner = x_center - w/2`. 이 가정은 `assumed` 로 보고한다.
       */
      const openings = holes.map((h) => {
        const w = h.w, d = pos(h.h) ? h.h : h.d2;
        return { x: h.x - w / 2, y: h.y - d / 2, w, d };
      });
      return { ...p, type: 'slab_with_openings', params: { length: width, depth, thickness, openings } };
    },
    note: '사각 개구는 원형 holes 로 못 낸다 — slab_with_openings 로 옮겼다(치수 변경 없음)',
    assumed: 'holes 의 x,y 를 개구 **중심**으로 보고 좌하단 모서리로 환산했다',
  },
];

/**
 * 부품 하나에 규칙을 적용한다.
 * @returns {{part:object, correction:Correction|null}}
 */
export function autoFixPart(part) {
  if (!part || typeof part !== 'object') return { part, correction: null };
  for (const rule of RULES) {
    let hit;
    try { hit = rule.when(part); } catch { hit = false; }
    if (!hit) continue;

    let fixed;
    try { fixed = rule.fix(part); } catch { fixed = null; }
    if (!fixed) continue;

    // ★수리가 실제로 나아지게 했는가. 아니면 손대지 않는다.
    const before = gateOf(part).length;
    const after = gateOf(fixed).length;
    if (after >= before) continue;

    return {
      part: fixed,
      correction: {
        partId: String(part.id ?? '(no id)'),
        rule: rule.id,
        from: part.type,
        to: fixed.type,
        note: rule.note,
        ...(rule.assumed ? { assumed: rule.assumed } : {}),
      },
    };
  }
  return { part, correction: null };
}

/**
 * 어셈블리 전체에 규칙을 적용한다. **원본은 건드리지 않는다.**
 *
 * ⚠ 교정이 0건이면 **입력 객체를 그대로** 돌려준다 — 참조 동일성이 유지돼야
 *   호출부가 `if (fixed.assembly !== asm)` 로 값싸게 분기할 수 있다.
 * @returns {{assembly:object, corrections:Correction[]}}
 */
export function autoFixAssembly(assembly) {
  const parts = assembly?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return { assembly, corrections: [] };

  const corrections = [];
  const next = parts.map((p) => {
    const { part, correction } = autoFixPart(p);
    if (correction) corrections.push(correction);
    return part;
  });
  if (!corrections.length) return { assembly, corrections: [] };
  return { assembly: { ...assembly, parts: next }, corrections };
}

/**
 * ★**어떤 입력이든 결과를 낸다** (260803).
 *
 * ## 왜
 * 실측: 부품 4개 중 **1개**가 게이트에 걸리면 `buildAssembly` 가
 * `ok:false · openscad:false · parts:0 · structural:없음` 을 낸다.
 * **멀쩡한 3개가 통째로 버려지고 사용자는 빈 화면과 에러 문구만 받는다.**
 * 고객은 에러만 나오는 도구를 쓰지 않는다.
 *
 * ## 사다리 — 위에서부터 시도하고, 바닥은 「빈 결과 아님」이다
 * ```
 *   L1  결정론 규칙 교정   autoFixPart (위 RULES) — 치수 불변
 *   L6  부품 드롭          그 부품만 빼고 나머지로 조립 + 드롭 보고
 * ```
 *
 * ## ⚠ L5(프록시 형상)를 **일부러 넣지 않았다**
 * 못 만든 부품을 AABB 상자로 대체하면 형상은 나오지만 **질량이 조용히 과대**해진다.
 * 이 리포에는 그 전력이 있다 — 「주력 경로 전 부품 AABB 상자 → 질량 최대 **58배 과대**」.
 * `structural.mjs` 에 프록시 제외 플래그가 **없어서**(grep 확인) 지금 넣으면 그 함정이 재현된다.
 * 드롭은 질량을 **과소**로 만들지만 `dropped[]` 가 **명시적**이라 사용자가 무엇이 빠졌는지 안다.
 * → 프록시는 `structural` 질량 제외 배선이 생긴 뒤에 켠다(계획서 후속 항목).
 *
 * ## ⚠ 드롭은 **최후 수단**이다
 * 호출부는 LLM 수리 라운드를 **다 쓴 뒤에** `drop:true` 로 부른다. 먼저 드롭하면
 * 고칠 수 있었던 부품을 버리게 된다.
 *
 * @returns {{assembly:object, corrections:Correction[],
 *            dropped:Array<{partId:string,type:string,errors:string[],params:object}>,
 *            allFailed:boolean}}
 */
export function resolveAssembly(assembly, { drop = false } = {}) {
  const fixed = autoFixAssembly(assembly);
  const parts = fixed.assembly?.parts ?? [];
  if (!drop || parts.length === 0) {
    return { assembly: fixed.assembly, corrections: fixed.corrections, dropped: [], allFailed: false };
  }

  const kept = [];
  const dropped = [];
  for (const p of parts) {
    const errs = gateOf(p);
    if (errs.length === 0) { kept.push(p); continue; }
    dropped.push({
      partId: String(p.id ?? '(no id)'),
      type: String(p.type ?? '(no type)'),
      errors: errs,
      // ⚠ 원본 파라미터를 실어 보낸다 — 사용자가 값을 채워 다시 넣을 수 있어야 한다.
      params: p.params ?? {},
    });
  }
  if (!dropped.length) {
    return { assembly: fixed.assembly, corrections: fixed.corrections, dropped: [], allFailed: false };
  }
  return {
    // 전부 실패해도 **원본을 돌려준다** — 호출부가 사유를 보고할 수 있어야 한다.
    assembly: kept.length ? { ...fixed.assembly, parts: kept } : fixed.assembly,
    corrections: fixed.corrections,
    dropped,
    allFailed: kept.length === 0,
  };
}

/** 드롭 내역 요약 — 무엇이 왜 빠졌고 어떻게 되살리는지. */
export function droppedSummary(dropped = []) {
  if (!dropped.length) return '';
  return dropped
    .map((d) => `${d.partId}(${d.type}) 제외 — ${d.errors[0]}`)
    .join('\n');
}

/** 사용자에게 보여줄 한 줄 요약. 조용한 수정을 만들지 않기 위한 기본 문구. */
export function correctionsSummary(corrections = []) {
  if (!corrections.length) return '';
  return corrections
    .map((c) => `${c.partId}: ${c.from} → ${c.to} (${c.note}${c.assumed ? ` · 가정: ${c.assumed}` : ''})`)
    .join('\n');
}

export const AUTO_FIX_RULE_IDS = RULES.map((r) => r.id);
