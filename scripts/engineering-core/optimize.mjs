/**
 * 단면 최적선정 — 결정론 탐색 루프 (플랫폼 중립).
 * 원리: 후보 단면 전수에 대해 기존 계산기(simple_beam/column_buckling)를 실행하고,
 * PASS 중 목적함수(기본: 최소 단위중량)를 최소화하는 단면을 고른다.
 * AI 추정 없음 — 전 후보의 검토 결과(audit)가 함께 반환되므로 판정 근거가 투명하다.
 * 전역최적이 아니라 "주어진 카탈로그 내 최적"임을 결과에 명시 (정직 게이트).
 */
import { runCalculatorCore } from './core.mjs';

/**
 * @param standards 표준 맵
 * @param opts { calculator:'simple_beam'|'column_buckling', fixedInput:{…단면 외 입력},
 *               sections:[{name,A,W,Ix,Sx,rx,ry,Aw}], standard?:'KDS'|…,
 *               axis?:'ry'|'rx' (기둥 좌굴축, 기본 ry 약축) }
 */
export function optimizeSection(standards, opts) {
  const { calculator, fixedInput, sections, standard = 'KDS', axis = 'ry' } = opts;
  if (!['simple_beam', 'column_buckling'].includes(calculator)) {
    throw new Error(`optimizer gate: unsupported calculator '${calculator}' (simple_beam|column_buckling)`);
  }
  if (!Array.isArray(sections) || sections.length === 0) throw new Error('optimizer gate: sections required');

  const audit = [];
  for (const s of sections) {
    const input = { ...fixedInput };
    if (calculator === 'simple_beam') Object.assign(input, { Sx: s.Sx, Ix: s.Ix, Aw: s.Aw });
    else Object.assign(input, { Ag: s.A, r: s[axis] });
    let entry;
    try {
      const r = runCalculatorCore(standards, calculator, input, standard);
      const worst = Math.max(...Object.values(r.checks).map((c) => c.ratio ?? 0));
      entry = { section: s.name, W_kg_per_m: s.W, verdict: r.verdict, governRatio: +worst.toFixed(3) };
    } catch (e) {
      entry = { section: s.name, W_kg_per_m: s.W, verdict: 'GATE', error: e.message };
    }
    audit.push(entry);
  }
  const passing = audit.filter((a) => a.verdict === 'PASS').sort((a, b) => a.W_kg_per_m - b.W_kg_per_m);
  const best = passing[0] ?? null;
  const detail = best
    ? runCalculatorCore(standards, calculator, (() => {
        const s = sections.find((x) => x.name === best.section);
        const input = { ...fixedInput };
        if (calculator === 'simple_beam') Object.assign(input, { Sx: s.Sx, Ix: s.Ix, Aw: s.Aw });
        else Object.assign(input, { Ag: s.A, r: s[axis] });
        return input;
      })(), standard)
    : null;
  return {
    objective: 'min unit weight among PASS',
    scope: '주어진 카탈로그 내 최적 — 전역최적 아님. 단면 데이터 draft면 발주 전 정본 대조 필요',
    calculator, standard,
    best: best?.section ?? null,
    bestWeight_kg_per_m: best?.W_kg_per_m ?? null,
    bestDetail: detail,
    audit,
  };
}
