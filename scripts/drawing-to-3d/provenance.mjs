/**
 * provenance.mjs — **이 숫자가 어디서 왔는가** (260803).
 *
 * ## 왜 이 파일이 있는가
 * 제품 원칙이 「어떤 입력이든 결과를 낸다」로 정해졌다(계획서 §0.4). 그런데 그것과
 * 「없는 값을 지어내지 않는다」가 충돌하는 것처럼 보인다. **충돌하지 않는다** — 축을 나누면 된다:
 * ```
 *   축 1  형상을 낸다      — 언제나. 막다른 길 없음
 *   축 2  근거를 표시한다  — 이 파일
 * ```
 * 문제가 되는 것은 **결과를 내는 것**이 아니라 **추정을 검증된 것처럼 말하는 것**이다.
 * 축 2 가 있으면 축 1 을 끝까지 밀어도 정직하다. **축 2 가 없을 때만 위험하다.**
 *
 * ## 5단계 — PBAS Evidence Graph 어휘를 그대로 쓴다
 * 이름을 새로 짓지 않는다. PBAS `evidence-graph.js` 가 쓰는 문자열과 같아야
 * 나중에 그 코어를 이식할 때 변환 계층이 필요 없다(계획서 §2.2 · B2).
 *
 * | 등급 | 뜻 | 검증에 쓸 수 있나 |
 * |---|---|---|
 * | `observed`          | 사용자가 명시한 값 | ⭕ |
 * | `geometry-derived`  | 다른 형상에서 유도(판 두께 → 볼트 길이) | ⭕ |
 * | `rule-derived`      | 표준·규칙에서(KS/ISO 표, `BOLT_TABLE`) | ⭕ |
 * | `assumed`           | **통상값 가정** | ⚠ 조건부 — 결과에 반드시 표기 |
 * | `unresolved`        | **못 정함**(형상 미확정·부품 드롭) | ❌ 검증 대상 아님 |
 *
 * ## ⚠ 이 파일이 지키는 규율
 * - **기본값은 `observed` 가 아니다.** 출처를 모르면 모른다고 해야 한다 →
 *   `unknownAs` 를 명시적으로 받는다. 조용히 `observed` 로 승격시키면 이 파일이 무의미해진다.
 * - **등급은 내려가기만 한다.** 한 파라미터에 두 번 표시되면 **더 낮은 쪽**이 남는다
 *   (가정으로 채운 값을 나중에 규칙으로 덮었다고 해서 가정이 사라지지 않는다).
 * - **부품의 등급 = 그 부품 파라미터 중 최저.** 하나라도 가정이면 부품이 가정이다.
 */

/** 등급 — 낮을수록 약한 근거. 순서가 곧 비교 연산이다. */
export const LEVELS = ['observed', 'geometry-derived', 'rule-derived', 'assumed', 'unresolved'];
const RANK = Object.fromEntries(LEVELS.map((l, i) => [l, i]));

/** 검증 결과를 그대로 믿어도 되는 등급. `assumed` 부터는 조건부다. */
export const VERIFIABLE = new Set(['observed', 'geometry-derived', 'rule-derived']);

export const isVerifiableLevel = (l) => VERIFIABLE.has(l);

/** 둘 중 **약한** 쪽. 등급은 올라가지 않는다. */
export function weaker(a, b) {
  if (!(a in RANK)) return b;
  if (!(b in RANK)) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * 파라미터 하나에 근거를 단다. **원본을 변형하지 않는다.**
 * @param {object} part 부품
 * @param {string} key 파라미터 이름
 * @param {string} level LEVELS 중 하나
 * @param {string} [note] 사람이 읽을 사유(예: '통상값 6mm — 스펙 미기재')
 */
export function markParam(part, key, level, note) {
  if (!LEVELS.includes(level)) throw new Error(`provenance: 알 수 없는 등급 '${level}'`);
  const prev = part?._prov?.params?.[key];
  const next = prev ? weaker(prev, level) : level;
  return {
    ...part,
    _prov: {
      ...(part?._prov ?? {}),
      params: { ...(part?._prov?.params ?? {}), [key]: next },
      // 사유는 등급이 실제로 바뀐 회차의 것만 남긴다 — 덮어써서 이력이 뒤섞이지 않게.
      notes: note && next === level
        ? { ...(part?._prov?.notes ?? {}), [key]: note }
        : (part?._prov?.notes ?? {}),
    },
  };
}

/** 여러 파라미터를 한 번에. `marks = {key: level}` 또는 `{key: [level, note]}` */
export function markParams(part, marks) {
  let out = part;
  for (const [k, v] of Object.entries(marks ?? {})) {
    const [level, note] = Array.isArray(v) ? v : [v, undefined];
    out = markParam(out, k, level, note);
  }
  return out;
}

/**
 * 부품 전체의 등급 — **파라미터 중 최저.**
 * ⚠ 표시가 없는 파라미터는 `unknownAs` 로 센다. 기본은 `observed` 가 **아니다** —
 *   호출부가 「이 값들은 사용자가 준 것」이라고 **선언**해야 observed 가 된다.
 */
export function partLevel(part, { unknownAs = 'assumed' } = {}) {
  const keys = Object.keys(part?.params ?? {});
  if (!keys.length) return part?._prov?.level ?? unknownAs;
  const marks = part?._prov?.params ?? {};
  return keys.reduce((acc, k) => weaker(acc, marks[k] ?? unknownAs), 'observed');
}

/**
 * 어셈블리 요약 — 화면·리포트가 한 번에 쓸 수 있는 모양.
 * @returns {{counts:Record<string,number>, weakest:string, verifiable:boolean,
 *            assumed:Array<{partId:string,params:string[],notes:Record<string,string>}>,
 *            unresolved:Array<{partId:string,reason:string}>}}
 */
export function assemblyProvenance(assembly, { unknownAs = 'assumed', dropped = [] } = {}) {
  const parts = assembly?.parts ?? [];
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  const assumed = [];
  let weakest = 'observed';

  for (const p of parts) {
    const lvl = partLevel(p, { unknownAs });
    counts[lvl] = (counts[lvl] ?? 0) + 1;
    weakest = weaker(weakest, lvl);
    if (!isVerifiableLevel(lvl)) {
      const marks = p?._prov?.params ?? {};
      const keys = Object.keys(p?.params ?? {}).filter((k) => !isVerifiableLevel(marks[k] ?? unknownAs));
      assumed.push({ partId: String(p.id ?? '(no id)'), params: keys, notes: p?._prov?.notes ?? {} });
    }
  }

  // 드롭된 부품은 형상이 아예 없으므로 `unresolved` 다 — 카운트에도 넣는다.
  const unresolved = (dropped ?? []).map((d) => ({
    partId: String(d.partId ?? '(no id)'),
    reason: Array.isArray(d.errors) ? String(d.errors[0] ?? '') : String(d.reason ?? ''),
  }));
  if (unresolved.length) {
    counts.unresolved += unresolved.length;
    weakest = weaker(weakest, 'unresolved');
  }

  return { counts, weakest, verifiable: isVerifiableLevel(weakest), assumed, unresolved };
}

// ─── 결정론 판정기 (B1, 260803) ─────────────────────────────────────────────

/**
 * 숫자가 원문에 독립 토큰으로 나타나는가.
 * ⚠ 한 자리 수(0~9)는 우연 일치가 너무 흔해 **단위·치수 기호가 인접할 때만** 인정한다
 *   (`t4` · `4mm` · `⌀4` · `M4`). 그냥 「패드 4개」의 `4` 는 인정하지 않는다.
 */
function numberAppearsIn(value, text) {
  const f = String(value);
  if (!/^\d+(\.\d+)?$/.test(f)) return false;
  const core = f.replace('.', '\\.');
  const re = f.length === 1
    ? new RegExp(`(?:[⌀ØøtTRrMm×xX]\\s*${core}(?![\\d.])|(?<![\\d.])${core}\\s*(?:mm|cm|t\\b|°|×|x))`, 'i')
    : new RegExp(`(?<![\\d.])${core}(?![\\d.])`);
  return re.test(text);
}

/**
 * ★**원문에 그 숫자가 있는가.** LLM 을 믿지 않고 기계로 판정한다.
 *
 * ## 문제
 * LLM 이 낸 파라미터 중 **어느 것이 사용자가 준 값이고 어느 것이 지어낸 값인지** 알 수 없다.
 * 프롬프트가 「미기입은 통상값」을 지시하므로 **둘이 섞여서 돌아온다.**
 * 그대로 두면 가정값이 검증된 값과 구분 없이 결과에 실린다.
 *
 * ## ⚠ 이 판정의 한계 — 반드시 같이 읽어라
 * `observed` 는 **「그 숫자가 원문에 있다」**는 뜻이지 **「그 파라미터로 명시됐다」**는 뜻이 아니다.
 * 그래서:
 *   - 이 판정은 **`assumed` 쪽이 신뢰도가 높다**(원문에 없으면 확실히 지어낸 값이다)
 *   - `observed` 는 「확인 대상에서 뺄 근거」가 아니라 **「확인 우선순위가 낮다」** 정도로 쓴다
 * ⚠ 등급은 내려가기만 하므로 이미 `assumed` 인 것을 `observed` 로 되올리지 못한다.
 */
export function groundParamsInText(part, sourceText, { note = '원문에 없음 — 통상값 추정' } = {}) {
  const text = String(sourceText ?? '');
  if (!text) return part;
  let out = part;
  for (const [k, v] of Object.entries(part?.params ?? {})) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue; // 배열·객체 파라미터는 건너뛴다
    const found = numberAppearsIn(v, text);
    out = markParam(out, k, found ? 'observed' : 'assumed', found ? undefined : note);
  }
  return out;
}

/**
 * 표준표 파생을 부품 수준에 남긴다.
 *
 * `hex_bolt` 는 `boltDims()` 가 `BOLT_TABLE`(ISO 4017 M3~M36)에서 머리치수·피치를 채운다 —
 * 사용자가 명시하지 않았는데 값이 생기는 **정당한** 경로다(가정이 아니라 표준이다).
 * ⚠ `params` 에 그 키가 없으므로 파라미터 단위로 못 단다 → 부품 수준 `standard` 로 남긴다.
 */
export function markStandardDerived(part) {
  if (part?.type !== 'hex_bolt' || !Number.isFinite(part?.params?.threadDia)) return part;
  return { ...part, _prov: { ...(part._prov ?? {}), standard: 'ISO 4017 BOLT_TABLE — 머리치수·피치 자동' } };
}

/**
 * 어셈블리 일괄 표시 — **B1 의 진입점.**
 * @param {object} assembly
 * @param {string} sourceText 사용자 원문(설명·스펙 문서)
 * @param {{repairedIds?: Iterable<string>}} [opt] `repairAgainstGate` 가 손댄 부품 id
 */
export function annotateAssembly(assembly, sourceText, { repairedIds = [] } = {}) {
  const repaired = new Set([...repairedIds].map(String));
  const parts = (assembly?.parts ?? []).map((p) => {
    let out = markStandardDerived(groundParamsInText(p, sourceText));
    /**
     * ⚠ 수리된 부품은 **전량 `assumed`** 다. `repairAgainstGate` 는 「미기입은 통상값」
     *   프롬프트로 LLM 에 다시 물어본 결과라 어느 값이 원문에서 왔는지 보장할 수 없다.
     *   원문 대조로 `observed` 가 붙었더라도 **내려간다**(등급은 내려가기만 한다).
     */
    if (repaired.has(String(p?.id))) {
      for (const k of Object.keys(out.params ?? {})) {
        out = markParam(out, k, 'assumed', '게이트 수리 중 재추출 — 원문 근거 불명');
      }
    }
    return out;
  });
  return { ...assembly, parts };
}

/**
 * 사용자에게 보여줄 한 줄. **검증됐다고 말할 수 있는지**를 먼저 말한다.
 * ⚠ 문구를 부드럽게 만들지 마라 — 「조건부」와 「검증됨」을 흐리면 이 파일이 무의미해진다.
 */
export function provenanceSummary(prov) {
  if (!prov) return '';
  const { counts, verifiable, assumed, unresolved } = prov;
  if (verifiable && !unresolved.length) return '전 부품 근거 확인 — 검증 결과를 그대로 볼 수 있습니다.';
  const bits = [];
  if (assumed.length) bits.push(`가정값 포함 ${assumed.length}개 부품(검증 결과는 **조건부**)`);
  if (unresolved.length) bits.push(`형상 미확정 ${unresolved.length}개 부품(질량·물량에서 제외됨)`);
  const ruleN = (counts['rule-derived'] ?? 0) + (counts['geometry-derived'] ?? 0);
  if (ruleN) bits.push(`표준·형상 파생 ${ruleN}개`);
  return bits.join(' · ');
}
