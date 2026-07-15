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
const isMain = typeof process !== 'undefined' && process.argv?.[1] && process.argv[1].replaceAll('\\', '/').endsWith('moving-load.mjs');
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

/**
 * 2경간 연속(등경간 L) — 3연모멘트 폐형해 스위프.
 * 단위하중 a(경간1 내): M_B = −P·a(L²−a²)/(4L²) (고전 정해 — 최대 위치 a=L/√3, 0.0962PL).
 * 경간 모멘트 = 단순보 M + M_B 선형보간. 중첩(선형탄성)으로 하중열 합산.
 * 앵커: 단일 P 최대 지점모멘트 0.09623PL · 등분포 양경간 M_B=−wL²/8 · +M=9wL²/128.
 */
export function sweepTwoSpan(L, axles, { steps = 1600, reverse = true } = {}) {
  const trains = [axles];
  if (reverse) {
    const maxX = Math.max(...axles.map((a) => a.x));
    trains.push(axles.map((a) => ({ P: a.P, x: maxX - a.x })));
  }
  const total = 2 * L;
  let MsupMax = 0, MspanMax = 0, at = 0;
  const mB_unit = (pos) => {
    // pos: 0~2L. 경간1: a=pos / 경간2: 대칭 a'=2L−pos
    const a = pos <= L ? pos : 2 * L - pos;
    return -(a * (L * L - a * a)) / (4 * L * L); // ×P
  };
  for (const tr of trains) {
    const len = Math.max(...tr.map((a) => a.x));
    for (let k = 0; k <= steps; k++) {
      const s = (k / steps) * (total + len);
      const on = tr.map((a) => ({ P: a.P, pos: s - a.x })).filter((a) => a.pos >= 0 && a.pos <= total);
      if (!on.length) continue;
      const MB = on.reduce((sum, a) => sum + a.P * mB_unit(a.pos), 0);
      if (-MB > MsupMax) MsupMax = -MB;
      // 각 축 아래 경간 모멘트 (해당 경간의 단순보 성분 + MB 보간)
      for (const a of on) {
        const inSpan1 = a.pos <= L;
        const xa = inSpan1 ? a.pos : a.pos - L;
        let Msimple = 0;
        for (const b of on) {
          const sameSpan = inSpan1 ? b.pos <= L : b.pos > L;
          if (!sameSpan) continue;
          const xb = inSpan1 ? b.pos : b.pos - L;
          // 단순보(경간 L) 하중 b가 위치 xa에 만드는 모멘트
          Msimple += xb <= xa ? b.P * xb * (L - xa) / L : b.P * xa * (L - xb) / L;
        }
        const M = Msimple + MB * (inSpan1 ? xa / L : (L - xa) / L);
        if (M > MspanMax) { MspanMax = M; at = a.pos; }
      }
    }
  }
  return { MsupMax_kNm: MsupMax, MspanMax_kNm: MspanMax, at_m: at };
}

/** 단순지지 중앙 처짐 — 하중열 임계 위치에서 각 축 P의 폐형 δ 중첩 (EI 입력). */
export function midspanDeflection(L, axles, EI_kNm2, { steps = 800 } = {}) {
  // 위치 스위프로 중앙 처짐 최대: δ_mid(P at b) = P·b(3L²−4b²)/(48EI), b=지점에서 가까운 쪽 거리
  let dMax = 0;
  const len = Math.max(...axles.map((a) => a.x));
  for (let k = 0; k <= steps; k++) {
    const s = (k / steps) * (L + len);
    let d = 0;
    for (const a of axles) {
      const pos = s - a.x;
      if (pos < 0 || pos > L) continue;
      const b = Math.min(pos, L - pos);
      d += (a.P * b * (3 * L * L - 4 * b * b)) / (48 * EI_kNm2);
    }
    if (d > dMax) dMax = d;
  }
  return dMax; // m
}

/**
 * 3등경간 연속 — 3연모멘트 2×2 폐형해 스위프 (지점 B·C 모멘트).
 * 단위하중(경간 k, 위치 a): 6Aẋ/L 항 → [4 1;1 4][MB;MC] = RHS. 앵커: 등분포
 * 전경간 동시재하 → M_B=−wL²/10 (고전). 스위프 포락선은 인접 2경간 패턴재하
 * −7wL²/60(=0.1167wL²)이 지배 — 포락선 앵커. 외측경간 +M 포락 ≈0.08wL².
 */
export function sweepThreeSpan(L, axles, { steps = 1500, reverse = true } = {}) {
  const trains = [axles];
  if (reverse) {
    const maxX = Math.max(...axles.map((a) => a.x));
    trains.push(axles.map((a) => ({ P: a.P, x: maxX - a.x })));
  }
  const total = 3 * L;
  let MsupMax = 0, MspanMax = 0;
  const rhsUnit = (pos) => {
    // 6A x̄ / L for 각 경간의 단위하중: 경간 내 위치 a → 좌항 6Aa/L = P·a(L²−a²)/L (우측지점), P·b(L²−b²)/L (좌측지점)
    const span = Math.min(2, Math.floor(pos / L));
    const a = pos - span * L, b = L - a;
    const num1 = (a * (L * L - a * a)) / L; // 해당 경간 좌측 지점식 기여
    const num2 = (b * (L * L - b * b)) / L;
    // 3연모멘트: 2(M_left(L1+L2))... 등경간: 식1(지점B): M_A+4M_B+M_C = −(6A1x̄1/L + 6A2x̄2/L)/... 표준화:
    // 지점 B 식은 경간1·2의 항, 지점 C 식은 경간2·3의 항
    const r1 = span === 0 ? num1 : span === 1 ? num2 : 0; // 경간1 우측(=B) + 경간2 좌측(=B)
    const r2 = span === 1 ? num1 : span === 2 ? num2 : 0; // 경간2 우측(=C) + 경간3 좌측(=C)
    return [r1, r2];
  };
  for (const tr of trains) {
    const len = Math.max(...tr.map((a) => a.x));
    for (let k = 0; k <= steps; k++) {
      const s = (k / steps) * (total + len);
      const on = tr.map((a) => ({ P: a.P, pos: s - a.x })).filter((a) => a.pos >= 0 && a.pos <= total);
      if (!on.length) continue;
      let R1 = 0, R2 = 0;
      for (const a of on) { const [x1, x2] = rhsUnit(a.pos); R1 += a.P * x1; R2 += a.P * x2; }
      // [4 1;1 4][MB;MC] = [−R1; −R2] → MB=(−4R1+R2)/15, MC=(R1−4R2)/15
      const MB = (-4 * R1 + R2) / (15 * L), MC = (R1 - 4 * R2) / (15 * L);
      MsupMax = Math.max(MsupMax, -MB, -MC);
      // 경간 모멘트: 각 축 아래 = 해당 경간 단순보 M + 지점모멘트 선형보간
      for (const a of on) {
        const span = Math.min(2, Math.floor(a.pos / L));
        const xa = a.pos - span * L;
        let Ms = 0;
        for (const b of on) {
          const sb = Math.min(2, Math.floor(b.pos / L));
          if (sb !== span) continue;
          const xb = b.pos - span * L;
          Ms += xb <= xa ? (b.P * xb * (L - xa)) / L : (b.P * xa * (L - xb)) / L;
        }
        const Ml = span === 0 ? 0 : span === 1 ? MB : MC;
        const Mr = span === 0 ? MB : span === 1 ? MC : 0;
        const M = Ms + Ml * (1 - xa / L) + Mr * (xa / L);
        if (M > MspanMax) MspanMax = M;
      }
    }
  }
  return { MsupMax_kNm: MsupMax, MspanMax_kNm: MspanMax };
}

/**
 * 3등경간 UDL 패턴재하 포락 (폐형) — KDS 차로하중 "불리 구간만 재하" 대응.
 * 7조합(2³−1) 전수: 각 조합 3연모멘트 2×2 폐형 → 지점·경간 최대.
 * 앵커: 전경간 M_B=−0.100wL² · 인접2 −7/60 wL² · 교호(1·3) +M=0.10125wL²(손계산).
 */
export function threeSpanUdlEnvelope(L, w) {
  let MsupMax = 0, MspanMax = 0;
  const T = (w * L * L * L) / 4; // 6Ax̄/L (등분포 만재)
  for (let mask = 1; mask < 8; mask++) {
    const on = [mask & 1, (mask >> 1) & 1, (mask >> 2) & 1];
    const R1 = (on[0] + on[1]) * T, R2 = (on[1] + on[2]) * T;
    const MB = (-4 * R1 + R2) / (15 * L), MC = (R1 - 4 * R2) / (15 * L);
    MsupMax = Math.max(MsupMax, -MB, -MC);
    const ends = [[0, MB], [MB, MC], [MC, 0]];
    for (let sp = 0; sp < 3; sp++) {
      const [Ml, Mr] = ends[sp], wl = on[sp] ? w : 0;
      for (let i = 0; i <= 50; i++) {
        const x = (i / 50) * L;
        const M = (wl * x * (L - x)) / 2 + Ml * (1 - x / L) + Mr * (x / L);
        if (M > MspanMax) MspanMax = M;
      }
    }
  }
  return { MsupMax_kNm: MsupMax, MspanMax_kNm: MspanMax };
}

/**
 * N등경간 연속 — 3연모멘트 삼중대각 일반해 (지점모멘트 벡터).
 * 내부지점 i: M(i-1) + 4M(i) + M(i+1) = −(T_L(i) + T_R(i))/L,
 * T = Σ P·a(L²−a²)/L (좌측경간은 좌단, 우측경간은 우단 기준 거리).
 * 앵커: n=2·3 기존 폐형과 일치 + n=4 등분포 고전계수 M_B=−3wL²/28·M_C=−2wL²/28.
 */
function solveTridiag(a, b, c, d) {
  const n = d.length, cp = new Array(n), dp = new Array(n);
  cp[0] = c[0] / b[0]; dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) {
    const m = b[i] - a[i] * cp[i - 1];
    cp[i] = c[i] / m;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / m;
  }
  const x = new Array(n);
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

function nSpanSupportMoments(L, nSpans, loadsPerSpan) {
  // loadsPerSpan[s] = [{P, a(경간 내 좌단부터)}]
  const nInt = nSpans - 1;
  if (nInt < 1) return [];
  const TL = new Array(nSpans).fill(0), TR = new Array(nSpans).fill(0);
  for (let s = 0; s < nSpans; s++) {
    for (const { P, a } of loadsPerSpan[s] ?? []) {
      const b2 = L - a;
      TL[s] += (P * a * (L * L - a * a)) / L;   // 그 경간 우측 지점식 기여(좌단거리 a)
      TR[s] += (P * b2 * (L * L - b2 * b2)) / L; // 그 경간 좌측 지점식 기여(우단거리 b)
    }
  }
  const A = new Array(nInt).fill(1), B = new Array(nInt).fill(4), C = new Array(nInt).fill(1), D = new Array(nInt);
  A[0] = 0; C[nInt - 1] = 0;
  for (let i = 0; i < nInt; i++) D[i] = -(TL[i] + TR[i + 1]) / L;
  return solveTridiag(A, B, C, D);
}

export function sweepNSpan(L, nSpans, axles, { steps = 1200, reverse = true } = {}) {
  if (nSpans === 1) { const r = sweepSimpleSpan(L, axles); return { MsupMax_kNm: 0, MspanMax_kNm: r.Mmax_kNm }; }
  const trains = [axles];
  if (reverse) { const mx = Math.max(...axles.map((a) => a.x)); trains.push(axles.map((a) => ({ P: a.P, x: mx - a.x }))); }
  const total = nSpans * L;
  let MsupMax = 0, MspanMax = 0;
  for (const tr of trains) {
    const len = Math.max(...tr.map((a) => a.x));
    for (let k = 0; k <= steps; k++) {
      const s = (k / steps) * (total + len);
      const on = tr.map((a) => ({ P: a.P, pos: s - a.x })).filter((a) => a.pos >= 0 && a.pos <= total);
      if (!on.length) continue;
      const per = Array.from({ length: nSpans }, () => []);
      for (const a of on) {
        const sp = Math.min(nSpans - 1, Math.floor(a.pos / L));
        per[sp].push({ P: a.P, a: a.pos - sp * L });
      }
      const M = nSpanSupportMoments(L, nSpans, per);
      for (const m of M) MsupMax = Math.max(MsupMax, -m);
      const Msup = [0, ...M, 0];
      for (const a of on) {
        const sp = Math.min(nSpans - 1, Math.floor(a.pos / L));
        const xa = a.pos - sp * L;
        let Ms = 0;
        for (const b2 of per[sp]) Ms += b2.a <= xa ? (b2.P * b2.a * (L - xa)) / L : (b2.P * xa * (L - b2.a)) / L;
        const Mv = Ms + Msup[sp] * (1 - xa / L) + Msup[sp + 1] * (xa / L);
        if (Mv > MspanMax) MspanMax = Mv;
      }
    }
  }
  return { MsupMax_kNm: MsupMax, MspanMax_kNm: MspanMax };
}

export function nSpanUdlEnvelope(L, nSpans, w) {
  if (nSpans > 6) throw new Error('input gate: UDL 패턴 포락은 6경간 이하(2^n 조합)');
  const T = (w * L * L * L) / 4;
  let MsupMax = 0, MspanMax = 0;
  for (let mask = 1; mask < (1 << nSpans); mask++) {
    const on = Array.from({ length: nSpans }, (_, i) => (mask >> i) & 1);
    const per = on.map((o) => (o ? [{ udl: true }] : []));
    // UDL 만재 경간: TL=TR=T
    const nInt = nSpans - 1;
    const A = new Array(nInt).fill(1), B = new Array(nInt).fill(4), C = new Array(nInt).fill(1), D = new Array(nInt);
    A[0] = 0; C[nInt - 1] = 0;
    for (let i = 0; i < nInt; i++) D[i] = -((on[i] ? T : 0) + (on[i + 1] ? T : 0)) / L;
    const M = solveTridiag(A, B, C, D);
    for (const m of M) MsupMax = Math.max(MsupMax, -m);
    const Msup = [0, ...M, 0];
    for (let sp = 0; sp < nSpans; sp++) {
      const wl = on[sp] ? w : 0;
      for (let i = 0; i <= 50; i++) {
        const x = (i / 50) * L;
        const Mv = (wl * x * (L - x)) / 2 + Msup[sp] * (1 - x / L) + Msup[sp + 1] * (x / L);
        if (Mv > MspanMax) MspanMax = Mv;
      }
    }
    void per;
  }
  return { MsupMax_kNm: MsupMax, MspanMax_kNm: MspanMax };
}

/**
 * 부등경간 연속 UDL 패턴 포락 — 3연모멘트 일반형(부등 Li).
 * 내부지점 i: M(i−1)Li + 2Mi(Li+L(i+1)) + M(i+1)L(i+1) = −6(A_L·x̄/L + A_R·x̄/L)
 * 등분포 만재 경간: 6Ax̄/L = wL³/4 (양단 동일). 2^n 패턴 전수 → 지점·경간 최대.
 * 앵커: 등경간 입력 시 nSpanUdlEnvelope와 일치(자체 교차검증).
 */
export function unequalSpanUdlEnvelope(spans, w) {
  const n = spans.length;
  if (n < 2 || n > 6) throw new Error('input gate: 부등경간 2~6');
  let MsupMax = 0, MspanMax = 0;
  for (let mask = 1; mask < (1 << n); mask++) {
    const on = Array.from({ length: n }, (_, i) => (mask >> i) & 1);
    const nInt = n - 1;
    const A = new Array(nInt), B = new Array(nInt), C = new Array(nInt), D = new Array(nInt);
    for (let i = 0; i < nInt; i++) {
      const Ll = spans[i], Lr = spans[i + 1];
      A[i] = i === 0 ? 0 : Ll;
      B[i] = 2 * (Ll + Lr);
      C[i] = i === nInt - 1 ? 0 : Lr;
      D[i] = -((on[i] ? (w * Ll ** 3) / 4 : 0) + (on[i + 1] ? (w * Lr ** 3) / 4 : 0)); // 6Ax̄/L=wL³/4 자체가 우변항
    }
    // Thomas
    const cp = new Array(nInt), dp = new Array(nInt);
    cp[0] = C[0] / B[0]; dp[0] = D[0] / B[0];
    for (let i = 1; i < nInt; i++) {
      const m = B[i] - A[i] * cp[i - 1];
      cp[i] = C[i] / m; dp[i] = (D[i] - A[i] * dp[i - 1]) / m;
    }
    const M = new Array(nInt);
    M[nInt - 1] = dp[nInt - 1];
    for (let i = nInt - 2; i >= 0; i--) M[i] = dp[i] - cp[i] * M[i + 1];
    for (const m of M) MsupMax = Math.max(MsupMax, -m);
    const Msup = [0, ...M, 0];
    for (let sp = 0; sp < n; sp++) {
      const L = spans[sp], wl = on[sp] ? w : 0;
      for (let i = 0; i <= 50; i++) {
        const x = (i / 50) * L;
        const Mv = (wl * x * (L - x)) / 2 + Msup[sp] * (1 - x / L) + Msup[sp + 1] * (x / L);
        if (Mv > MspanMax) MspanMax = Mv;
      }
    }
  }
  return { MsupMax_kNm: MsupMax, MspanMax_kNm: MspanMax };
}

/** 부등경간 트럭 스위프 — 3연모멘트 부등 Li + 점하중 우변(Pa(L²−a²)/L 계열). */
export function sweepUnequalSpans(spans, axles, { steps = 1200, reverse = true } = {}) {
  const n = spans.length;
  const total = spans.reduce((a, b) => a + b, 0);
  const bounds = [0]; for (const L of spans) bounds.push(bounds[bounds.length - 1] + L);
  const trains = [axles];
  if (reverse) { const mx = Math.max(...axles.map((a) => a.x)); trains.push(axles.map((a) => ({ P: a.P, x: mx - a.x }))); }
  let MsupMax = 0, MspanMax = 0;
  for (const tr of trains) {
    const len = Math.max(...tr.map((a) => a.x));
    for (let k = 0; k <= steps; k++) {
      const s = (k / steps) * (total + len);
      const on = tr.map((a) => ({ P: a.P, pos: s - a.x })).filter((a) => a.pos >= 0 && a.pos <= total);
      if (!on.length) continue;
      const per = Array.from({ length: n }, () => []);
      for (const a of on) {
        let sp = 0; while (sp < n - 1 && a.pos > bounds[sp + 1]) sp++;
        per[sp].push({ P: a.P, a: a.pos - bounds[sp] });
      }
      const nInt = n - 1;
      if (nInt < 1) continue;
      const A = new Array(nInt), B = new Array(nInt), C = new Array(nInt), D = new Array(nInt).fill(0);
      for (let i = 0; i < nInt; i++) {
        const Ll = spans[i], Lr = spans[i + 1];
        A[i] = i === 0 ? 0 : Ll; B[i] = 2 * (Ll + Lr); C[i] = i === nInt - 1 ? 0 : Lr;
        for (const { P, a } of per[i]) D[i] -= (P * a * (Ll * Ll - a * a)) / Ll;        // 좌경간(우단 지점식): x̄=좌단거리 a
        for (const { P, a } of per[i + 1]) { const b2 = Lr - a; D[i] -= (P * b2 * (Lr * Lr - b2 * b2)) / Lr; } // 우경간: 우단거리 b
      }
      const cp = new Array(nInt), dp = new Array(nInt);
      cp[0] = C[0] / B[0]; dp[0] = D[0] / B[0];
      for (let i = 1; i < nInt; i++) { const m = B[i] - A[i] * cp[i - 1]; cp[i] = C[i] / m; dp[i] = (D[i] - A[i] * dp[i - 1]) / m; }
      const M = new Array(nInt); M[nInt - 1] = dp[nInt - 1];
      for (let i = nInt - 2; i >= 0; i--) M[i] = dp[i] - cp[i] * M[i + 1];
      for (const m of M) MsupMax = Math.max(MsupMax, -m);
      const Msup = [0, ...M, 0];
      for (const a of on) {
        let sp = 0; while (sp < n - 1 && a.pos > bounds[sp + 1]) sp++;
        const L = spans[sp], xa = a.pos - bounds[sp];
        let Ms = 0;
        for (const b2 of per[sp]) Ms += b2.a <= xa ? (b2.P * b2.a * (L - xa)) / L : (b2.P * xa * (L - b2.a)) / L;
        const Mv = Ms + Msup[sp] * (1 - xa / L) + Msup[sp + 1] * (xa / L);
        if (Mv > MspanMax) MspanMax = Mv;
      }
    }
  }
  return { MsupMax_kNm: MsupMax, MspanMax_kNm: MspanMax };
}
