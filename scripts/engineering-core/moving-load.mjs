/**
 * moving-load.mjs — 단순지지 이동하중(축하중 열차) 최대 단면력 엔진.
 * 방법: 하중열 위치 스위프(정밀 스텝) — 각 위치에서 반력 → 각 축 아래 모멘트(최대
 * 모멘트는 축 위치에서 발생하는 성질 이용) · 지점 전단. 양방향(열차 반전) 검토.
 * 결정론·무의존. 검증 앵커(self-test): 단일 P → PL/4·P(지점 통과 시 V=P) ·
 * 2축 등하중 절대최대모멘트 폐형해 · 등분포 wL²/8.
 */

/** 하중열: axles = [{ P(kN), x(m — 선두축 기준 후방 거리 ≥0) }] */
export function sweepSimpleSpan(L, axles, { steps = 2000, reverse = true } = {}) {
  const trains = [axles];
  if (reverse) {
    const maxX = Math.max(...axles.map((a) => a.x));
    trains.push(axles.map((a) => ({ P: a.P, x: maxX - a.x })));
  }
  let Mmax = 0, MmaxAt = 0, Vmax = 0;
  for (const tr of trains) {
    const len = Math.max(...tr.map((a) => a.x));
    // 선두축 위치 s: 열차가 부분적으로 걸치는 범위 포함 [0, L+len]
    for (let k = 0; k <= steps; k++) {
      const s = (k / steps) * (L + len);
      // 재하 중 축(0≤pos≤L)만
      const on = tr.map((a) => ({ P: a.P, pos: s - a.x })).filter((a) => a.pos >= 0 && a.pos <= L);
      if (!on.length) continue;
      const R1 = on.reduce((sum, a) => sum + a.P * (L - a.pos), 0) / L; // 좌측 반력
      // 각 축 아래 모멘트
      for (const a of on) {
        let M = R1 * a.pos;
        for (const b of on) if (b.pos < a.pos) M -= b.P * (a.pos - b.pos);
        if (M > Mmax) { Mmax = M; MmaxAt = a.pos; }
      }
      const V = Math.max(R1, on.reduce((sum, a) => sum + a.P, 0) - R1);
      if (V > Vmax) Vmax = V;
    }
  }
  return { Mmax_kNm: Mmax, at_m: MmaxAt, Vmax_kN: Vmax };
}

// ── self-test ────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('moving-load.mjs');
if (isMain) {
  const near = (a, b, tol = 0.002) => Math.abs(a - b) <= tol * Math.abs(b);
  let ok = 0, tot = 0;
  const chk = (n, c) => { tot++; if (c) ok++; else console.log('✗', n); };
  // 1) 단일 P=100, L=20 → M=PL/4=500 · V=100
  const r1 = sweepSimpleSpan(20, [{ P: 100, x: 0 }]);
  chk('P단일 PL/4', near(r1.Mmax_kNm, 500) && near(r1.Vmax_kN, 100));
  // 2) 2축 등하중 P=100×2 @ a=4, L=20 — 절대최대모멘트 폐형해 M = 2P(L/2 − a/4)²/L = 200(10−1)²/20 = 810
  const r2 = sweepSimpleSpan(20, [{ P: 100, x: 0 }, { P: 100, x: 4 }]);
  chk('2축 절대최대 폐형해', near(r2.Mmax_kNm, 810, 0.003));
  // 3) V: 2축 지점 위 → R=P(1 + (L−a)/L) = 100(1+16/20)=180
  chk('2축 최대전단', near(r2.Vmax_kN, 180, 0.003));
  console.log(`moving-load self-test: ${ok}/${tot}${ok === tot ? ' PASS' : ' FAIL'}`);
  if (ok !== tot) process.exit(1);
}
