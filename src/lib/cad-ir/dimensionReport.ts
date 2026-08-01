/**
 * dimensionReport — **게이트의 치수 대조를 사용자 문장으로** (260801, 격차 W4).
 *
 * ## 왜 필요한가 — 또 「계산은 하는데 안 내보냄」이다
 * 게이트는 치수별로 `expected` / `actual` / `delta_pct` / `tol_pct` 를 이미 만든다.
 * 그런데 그 배열은 `repairLoop.ts` 에서 **버려지고** 영문 `feedback` 한 덩어리만 남는다:
 * ```
 *   ■ X length 92 (expected 80) — 15% too large. Tolerance 2%. Correct by 12 units.
 * ```
 * 이건 **다음 시도에게 주는 수리 지시문**이지 사용자에게 보여 줄 문장이 아니다.
 * 사용자가 알고 싶은 것은 하나다 — **내가 말한 치수대로 나왔나.**
 *
 * ## ⚠ 단위를 지어내지 않는다
 * 이 게이트는 **단위를 모를 수 있다**(STL 유래 등 — `unitsKnown` 참조). 단위가 없을 때
 * 「80mm」라고 쓰면 그건 측정이 아니라 창작이다. 그래서 `unit` 이 주어질 때만 붙인다.
 *
 * ## ⚠ 세 상태를 섞지 않는다
 * ```
 *   passed=true    맞았다              ✓
 *   passed=false   틀렸다              ✗
 *   passed=null    **검사하지 않았다**  — ✓ 도 ✗ 도 아니다
 * ```
 * 건너뛴 검사를 「이상 없음」으로 읽히게 두면, 이 저장소가 반복해 온 그 착각이 그대로 재현된다.
 */
import type { GateCheck } from './gate';

export type DimVerdict = 'ok' | 'failed' | 'unchecked';

export interface DimSentence {
  /** 원래 검사 이름 — 화면이 접거나 정렬할 때 쓴다. */
  name: string;
  verdict: DimVerdict;
  /** 그대로 보여도 되는 한 문장. */
  text: string;
  /** 참고용(advisory) 검사인가 — 이것만으로 불합격이 되지 않는다. */
  advisory: boolean;
}

/**
 * 검사 이름 → 사람 이름.
 * ⚠ `bbox_x` 를 「가로」로 옮기지 않는다. 축과 가로/세로의 대응은 **모델을 어느 방향으로
 *   놓았는지에 따라 달라진다** — 모르는 것을 아는 척하는 번역이 된다. 축 이름 그대로 쓴다.
 */
const LABEL_KO: Record<string, string> = {
  bbox_x: 'X축 길이', bbox_y: 'Y축 길이', bbox_z: 'Z축 길이',
  bbox_sorted: '3축 길이(방향 무시하고 비교)',
  volume: '부피', watertight: '수밀(닫힌 solid)',
  genus: '관통 구멍 수', genus_max: '관통 구멍 수 상한',
  body_count: '분리된 덩어리 수', render: '형상 측정',
  volume_fill_plausible_weak: '부피 충전율', evidence_sufficient: '근거 충분성',
};
const LABEL_EN: Record<string, string> = {
  bbox_x: 'X length', bbox_y: 'Y length', bbox_z: 'Z length',
  bbox_sorted: '3-axis lengths (orientation-free)',
  volume: 'Volume', watertight: 'Watertight solid',
  genus: 'Through-holes', genus_max: 'Through-hole limit',
  body_count: 'Separate bodies', render: 'Geometry measurement',
  volume_fill_plausible_weak: 'Volume fill ratio', evidence_sufficient: 'Evidence sufficiency',
};

/** 숫자를 사람이 읽는 자리수로. 지어낸 정밀도를 붙이지 않는다. */
function num(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const a = Math.abs(v);
    return String(a >= 100 ? Math.round(v) : a >= 1 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v) && v.every((x) => typeof x === 'number')) {
    return v.map((x) => num(x)).join(' × ');
  }
  return null;
}

/** 단위는 **주어졌을 때만** 붙인다. */
const withUnit = (s: string | null, unit: string | null): string | null =>
  s === null ? null : unit ? `${s}${unit}` : s;

export interface DimReportOptions {
  lang?: 'ko' | 'en';
  /**
   * 길이 단위(예 `'mm'`). **단위를 모르면 넘기지 않는다** — 넘기지 않으면 숫자만 나간다.
   * ⚠ 기본값을 `'mm'` 로 두지 않는 이유: 기본값은 곧 「모를 때도 mm 라고 쓴다」가 된다.
   */
  unit?: string | null;
  /** 참고 검사도 포함할지. 기본은 포함하되 문장에 「참고」라고 밝힌다. */
  includeAdvisory?: boolean;
}

/**
 * 게이트 검사 배열 → 사용자 문장 배열.
 * ⚠ **실패를 앞에 놓는다.** 통과 문장이 먼저 쌓이면 그 아래 경고를 아무도 안 읽는다.
 */
export function dimensionSentences(checks: readonly GateCheck[] | null | undefined, opts: DimReportOptions = {}): DimSentence[] {
  if (!Array.isArray(checks)) return [];
  const lang = opts.lang ?? 'ko';
  const unit = opts.unit ?? null;
  const ko = lang === 'ko';
  const labels = ko ? LABEL_KO : LABEL_EN;
  const out: DimSentence[] = [];

  for (const c of checks) {
    if (!c || typeof c.name !== 'string') continue;
    const advisory = c.advisory === true;
    if (advisory && opts.includeAdvisory === false) continue;
    const label = labels[c.name] ?? c.name;
    const tag = advisory ? (ko ? ' (참고)' : ' (advisory)') : '';

    // ① 수행하지 않은 검사 — ✓ 도 ✗ 도 붙이지 않는다
    if (c.passed === null || c.status === 'skipped' || c.status === 'error') {
      const why = c.reason || c.note || (ko ? '사유 기록 없음' : 'no reason recorded');
      out.push({
        name: c.name, verdict: 'unchecked', advisory,
        text: ko ? `${label}${tag}: 검사 안 함 — ${why}` : `${label}${tag}: not checked — ${why}`,
      });
      continue;
    }

    const exp = withUnit(num(c.expected), unit);
    const act = withUnit(num(c.actual), unit);
    const d = typeof c.delta_pct === 'number' && Number.isFinite(c.delta_pct) ? c.delta_pct : null;
    const tol = typeof c.tol_pct === 'number' && Number.isFinite(c.tol_pct) ? c.tol_pct : null;

    // ② 숫자로 비교할 수 없는 검사(수밀·덩어리 수 등)는 값만 대조한다
    if (exp === null || act === null) {
      const mark = c.passed ? '✓' : '✗';
      const body = exp !== null && act === null
        ? (ko ? `요청 ${exp} → 측정 못 함` : `requested ${exp} → not measured`)
        : act !== null
          ? (ko ? `측정 ${act}` : `measured ${act}`)
          : (ko ? '비교값 없음' : 'no comparable value');
      out.push({ name: c.name, verdict: c.passed ? 'ok' : 'failed', advisory, text: `${label}${tag}: ${body} ${mark}` });
      continue;
    }

    const diff = d === null ? '' : ko ? ` (${d}% 차이` : ` (${d}% off`;
    const tolPart = d === null ? '' : tol !== null && !c.passed ? (ko ? `, 허용 ${tol}%)` : `, tolerance ${tol}%)`) : ')';
    const mark = c.passed ? '✓' : '✗';
    out.push({
      name: c.name, verdict: c.passed ? 'ok' : 'failed', advisory,
      text: ko
        ? `${label}${tag}: 요청 ${exp} → 실제 ${act}${diff}${tolPart} ${mark}`
        : `${label}${tag}: requested ${exp} → actual ${act}${diff}${tolPart} ${mark}`,
    });
  }

  // 실패 → 미검사 → 통과. 참고 검사는 각 등급 안에서 뒤로.
  const rank: Record<DimVerdict, number> = { failed: 0, unchecked: 1, ok: 2 };
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || Number(a.advisory) - Number(b.advisory));
}

/**
 * 한 줄 요약.
 * ⚠ **미검사를 통과 수에 넣지 않는다.** 「8개 중 8개 통과」로 적으면서 그중 3개를 안 쟀다면
 *   그건 통계가 아니라 거짓말이다. 세 수를 따로 적는다.
 */
export function dimensionSummary(sentences: readonly DimSentence[], lang: 'ko' | 'en' = 'ko'): string {
  const ok = sentences.filter((s) => s.verdict === 'ok').length;
  const bad = sentences.filter((s) => s.verdict === 'failed').length;
  const un = sentences.filter((s) => s.verdict === 'unchecked').length;
  if (!sentences.length) return lang === 'ko' ? '치수 대조를 수행하지 않았습니다.' : 'No dimension comparison was performed.';
  if (lang === 'en') {
    const head = bad ? `${bad} dimension(s) off` : un && !ok ? 'nothing verified' : 'all checked dimensions match';
    return `${head} · ${ok} ok / ${bad} off / ${un} not checked`;
  }
  const head = bad ? `치수 ${bad}개가 요청과 다릅니다`
    : un && !ok ? '확인된 치수가 없습니다'
      : '검사한 치수는 모두 요청과 일치합니다';
  return `${head} · 일치 ${ok} / 불일치 ${bad} / 미검사 ${un}`;
}
