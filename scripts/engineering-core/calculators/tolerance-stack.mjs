/**
 * P17 기계 — 공차 스택업 (최악조건 / RSS 통계 — 폐형).
 * 치수 사슬 [{nominal, tol(±), dir(+1/−1)}] → 결과치수 공칭 Σ(dir·nominal),
 * 최악 ±Σ|tol| · RSS ±√Σtol² (정규분포·독립 가정 명시 — Cp 동일 전제).
 * 판정: 목표 간극/끼움 범위 입력 시 최악·RSS 각각 게이트.
 * 앵커: 동일 공차 n개 RSS = tol·√n 폐형 자체검증.
 */
export default {
  id: 'tolerance_stack',
  domain: 'mechanical/precision',
  title: '공차 스택업 (최악/RSS)',
  description: '치수 사슬 → 결과 공차(최악·RSS)·목표 범위 판정 — 조립 간극/끼움 검토.',
  refs: ['공차 누적 해석 표준(최악조건·RSS — 기계설계 폐형)', 'RSS는 정규·독립·동일 공정능력 가정 명시'],
  status: 'verified — 폐형 앵커(√n). 비대칭 공차·GD&T 자세공차 스택·몬테카를로는 후속',
  inputSchema: {
    type: 'object',
    required: ['chain'],
    properties: {
      chain: { description: '치수 사슬 [{name?, nominal_mm, tol_mm(±대칭), dir(+1|-1 — 닫힘 방향)}] 2~30개' },
      targetMin_mm: { type: 'number', description: '결과치수 하한 (간극 최소 등 — 판정용)' },
      targetMax_mm: { type: 'number', description: '결과치수 상한' },
    },
  },
  run(input) {
    const ch = input.chain;
    if (!Array.isArray(ch) || ch.length < 2 || ch.length > 30) throw new Error('input gate: chain 2~30개');
    let nom = 0, wc = 0, ss = 0;
    const rows = ch.map((c, i) => {
      const n = Number(c.nominal_mm), t = Number(c.tol_mm), d = c.dir === -1 ? -1 : 1;
      if (!Number.isFinite(n) || !(t >= 0)) throw new Error(`input gate: chain[${i}]`);
      nom += d * n; wc += t; ss += t * t;
      return { name: c.name ?? `치수${i + 1}`, nominal: n, tol: t, dir: d };
    });
    const rss = Math.sqrt(ss);
    const wcRange = { min: +(nom - wc).toFixed(4), max: +(nom + wc).toFixed(4) };
    const rssRange = { min: +(nom - rss).toFixed(4), max: +(nom + rss).toFixed(4) };
    let judge = null;
    if (Number.isFinite(Number(input.targetMin_mm)) || Number.isFinite(Number(input.targetMax_mm))) {
      const lo = Number.isFinite(Number(input.targetMin_mm)) ? Number(input.targetMin_mm) : -Infinity;
      const hi = Number.isFinite(Number(input.targetMax_mm)) ? Number(input.targetMax_mm) : Infinity;
      judge = {
        worstCase: { pass: wcRange.min >= lo && wcRange.max <= hi },
        rss: { pass: rssRange.min >= lo && rssRange.max <= hi },
        note: '최악 PASS=전수 보증 · RSS만 PASS=통계적 합격(±3σ 관례, 불량률 별도) — 구분 명시',
      };
    }
    return {
      verdict: judge ? (judge.worstCase.pass ? 'PASS' : judge.rss.pass ? 'WARN' : 'FAIL') : 'INFO',
      checks: {
        result: { nominal_mm: +nom.toFixed(4), worst_pm: +wc.toFixed(4), rss_pm: +rss.toFixed(4), worstRange: wcRange, rssRange },
        ...(judge ? { judge } : {}),
      },
      chain: rows,
      notes: [
        `공칭 ${nom.toFixed(3)} · 최악 ±${wc.toFixed(3)} · RSS ±${rss.toFixed(3)}mm (${ch.length}개 사슬).`,
        'RSS=정규·독립·±3σ 동일 공정능력 가정(명시). WARN=최악 불합격·RSS 합격(통계적 관리 필요). 비대칭 공차·GD&T는 후속.',
      ],
    };
  },
};
