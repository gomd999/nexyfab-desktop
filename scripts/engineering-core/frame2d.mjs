/**
 * frame2d.mjs — 평면 골조 강성매트릭스 해석 (Euler-Bernoulli 6-DOF 보요소).
 * 목적: 암거 하판 Winkler 지반스프링(정확도 라운드 2-②) 등 처짐각법으로 못 푸는
 * 지지조건의 결정론 해석. 의존성 없음(자체 가우스 소거).
 *
 * 검증 앵커(self-test): 단순보 wL²/8 · 고정보 wL²/12 · 삼각분포 고정단 wL²/20·30 ·
 * 폐합 정사각 등압 박스 |M|=wL²/12 (처짐각법 앵커와 동일 조건 교차).
 *
 * 규약: 절점 [x,y] m · DOF [ux,uy,θ] · 요소 국부 y = 좌→우 진행 기준 좌측(+).
 * 분포하중 w1→w2 = 국부 +y 방향(kN/m), 요소 길이 방향 선형.
 */

/** 요소 강성 (국부): E kPa, A m², I m⁴, L m → 6×6 */
function kLocal(E, A, I, L) {
  const a = E * A / L, b = 12 * E * I / L ** 3, c = 6 * E * I / L ** 2, d = 4 * E * I / L, e = 2 * E * I / L;
  return [
    [a, 0, 0, -a, 0, 0],
    [0, b, c, 0, -b, c],
    [0, c, d, 0, -c, e],
    [-a, 0, 0, a, 0, 0],
    [0, -b, -c, 0, b, -c],
    [0, c, e, 0, -c, d],
  ];
}

/** 사다리꼴 분포하중(국부 +y, w1@i → w2@j)의 고정단 등가절점력 (국부) */
function femTrapezoid(w1, w2, L) {
  // 등분포 성분 wu + 삼각 성분 wt(j측 최대)로 분해
  const wu = w1, wt = w2 - w1;
  const V1 = wu * L / 2 + 3 * wt * L / 20;
  const V2 = wu * L / 2 + 7 * wt * L / 20;
  const M1 = wu * L * L / 12 + wt * L * L / 30;
  const M2 = -(wu * L * L / 12 + wt * L * L / 20);
  return [0, V1, M1, 0, V2, M2];
}

/**
 * @param model {
 *   nodes: [[x,y],...], elements: [{i,j,E,A,I, w1?,w2?}], // w = 국부 +y 분포하중 kN/m
 *   springs?: [{node, ky?, kx?}],  // kN/m
 *   fixes?: [{node, ux?, uy?, rz?}],  // true = 구속
 * }
 * @returns { disp, elementEnd: [{Mi,Mj,Vi,Vj,Ni,Nj}] } (전역 해·요소 국부 단부력 kN·m/kN)
 */
export function solveFrame2D(model) {
  const n = model.nodes.length;
  const N = 3 * n;
  const K = Array.from({ length: N }, () => new Float64Array(N));
  const F = new Float64Array(N);

  const elems = model.elements.map((el) => {
    const [xi, yi] = model.nodes[el.i], [xj, yj] = model.nodes[el.j];
    const dx = xj - xi, dy = yj - yi;
    const L = Math.hypot(dx, dy);
    const cx = dx / L, cy = dy / L;
    // 변환행렬 T (국부→전역): [cx cy 0; -cy cx 0; 0 0 1] 블록×2
    const T = [
      [cx, cy, 0, 0, 0, 0],
      [-cy, cx, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0],
      [0, 0, 0, cx, cy, 0],
      [0, 0, 0, -cy, cx, 0],
      [0, 0, 0, 0, 0, 1],
    ];
    const kl = kLocal(el.E, el.A, el.I, L);
    // kg = Tᵀ kl T
    const kg = Array.from({ length: 6 }, () => new Float64Array(6));
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
      let s = 0;
      for (let p = 0; p < 6; p++) for (let q = 0; q < 6; q++) s += T[p][r] * kl[p][q] * T[q][c];
      kg[r][c] = s;
    }
    const dofs = [3 * el.i, 3 * el.i + 1, 3 * el.i + 2, 3 * el.j, 3 * el.j + 1, 3 * el.j + 2];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) K[dofs[r]][dofs[c]] += kg[r][c];
    // 분포하중 → 등가절점력 (국부 fem → 전역 Tᵀ·fem)
    let femL = null;
    if (el.w1 !== undefined || el.w2 !== undefined) {
      femL = femTrapezoid(el.w1 ?? 0, el.w2 ?? el.w1 ?? 0, L);
      for (let r = 0; r < 6; r++) {
        let s = 0;
        for (let p = 0; p < 6; p++) s += T[p][r] * femL[p];
        F[dofs[r]] += s;
      }
    }
    return { ...el, L, T, kl, dofs, femL };
  });

  for (const s of model.springs ?? []) {
    if (s.ky) K[3 * s.node + 1][3 * s.node + 1] += s.ky;
    if (s.kx) K[3 * s.node][3 * s.node] += s.kx;
  }
  for (const f of model.loads ?? []) {
    if (f.fx) F[3 * f.node] += f.fx;
    if (f.fy) F[3 * f.node + 1] += f.fy;
    if (f.mz) F[3 * f.node + 2] += f.mz;
  }
  // 구속: 대각 대치법
  const BIG = 1e14;
  for (const fx of model.fixes ?? []) {
    if (fx.ux) { K[3 * fx.node][3 * fx.node] += BIG; }
    if (fx.uy) { K[3 * fx.node + 1][3 * fx.node + 1] += BIG; }
    if (fx.rz) { K[3 * fx.node + 2][3 * fx.node + 2] += BIG; }
  }

  // 가우스 소거 (부분 피벗)
  const u = gaussSolve(K, F);

  // 요소 단부력 (국부): f = kl·T·u_e − fem
  const elementEnd = elems.map((el) => {
    const ue = el.dofs.map((d) => u[d]);
    const ul = new Float64Array(6);
    for (let r = 0; r < 6; r++) { let s = 0; for (let c = 0; c < 6; c++) s += el.T[r][c] * ue[c]; ul[r] = s; }
    const f = new Float64Array(6);
    for (let r = 0; r < 6; r++) { let s = 0; for (let c = 0; c < 6; c++) s += el.kl[r][c] * ul[c]; f[r] = s - (el.femL ? el.femL[r] : 0); }
    return { Ni: f[0], Vi: f[1], Mi: f[2], Nj: f[3], Vj: f[4], Mj: f[5], L: el.L };
  });
  return { disp: u, elementEnd };
}

function gaussSolve(K, F) {
  const N = F.length;
  const A = K.map((row, i) => { const r = new Float64Array(N + 1); r.set(row); r[N] = F[i]; return r; });
  for (let col = 0; col < N; col++) {
    let piv = col;
    for (let r = col + 1; r < N; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-30) throw new Error(`frame2d: 특이 행렬 (DOF ${col} — 구속 부족)`);
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = col + 1; r < N; r++) {
      const m = A[r][col] / A[col][col];
      if (m === 0) continue;
      for (let c = col; c <= N; c++) A[r][c] -= m * A[col][c];
    }
  }
  const u = new Float64Array(N);
  for (let r = N - 1; r >= 0; r--) {
    let s = A[r][N];
    for (let c = r + 1; c < N; c++) s -= A[r][c] * u[c];
    u[r] = s / A[r][r];
  }
  return u;
}

// ── self-test ────────────────────────────────────────────────────────────────
const isMain = typeof process !== 'undefined' && process.argv?.[1] && process.argv[1].replaceAll('\\', '/').endsWith('frame2d.mjs');
if (isMain) {
  const E = 27e6, A = 0.4, I = 0.4 ** 3 / 12; // kPa·m²·m⁴
  const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol * Math.abs(b);
  let ok = 0, tot = 0;
  const chk = (name, cond) => { tot++; if (cond) ok++; else console.log('✗', name); };

  // 1) 고정보 w=10, L=6 → 단부 M = wL²/12 = 30
  {
    const nseg = 8, L = 6, nodes = Array.from({ length: nseg + 1 }, (_, i) => [i * L / nseg, 0]);
    const elements = Array.from({ length: nseg }, (_, i) => ({ i, j: i + 1, E, A, I, w1: -10, w2: -10 }));
    const r = solveFrame2D({ nodes, elements, fixes: [{ node: 0, ux: true, uy: true, rz: true }, { node: nseg, ux: true, uy: true, rz: true }] });
    chk('고정보 wL²/12', near(Math.abs(r.elementEnd[0].Mi), 30));
  }
  // 2) 단순보 중앙 M = wL²/8 = 45 (요소 경계 모멘트로 근사 — 중앙 절점 좌요소 Mj)
  {
    const nseg = 8, L = 6, nodes = Array.from({ length: nseg + 1 }, (_, i) => [i * L / nseg, 0]);
    const elements = Array.from({ length: nseg }, (_, i) => ({ i, j: i + 1, E, A, I, w1: -10, w2: -10 }));
    const r = solveFrame2D({ nodes, elements, fixes: [{ node: 0, ux: true, uy: true }, { node: nseg, uy: true }] });
    chk('단순보 wL²/8', near(Math.abs(r.elementEnd[nseg / 2 - 1].Mj), 45));
  }
  // 3) 삼각분포(0→10) 고정보: M_i = wL²/30 = 12, M_j = wL²/20 = 18
  {
    const nseg = 10, L = 6, nodes = Array.from({ length: nseg + 1 }, (_, i) => [i * L / nseg, 0]);
    const elements = Array.from({ length: nseg }, (_, i) => ({ i, j: i + 1, E, A, I, w1: -10 * (i / nseg), w2: -10 * ((i + 1) / nseg) }));
    const r = solveFrame2D({ nodes, elements, fixes: [{ node: 0, ux: true, uy: true, rz: true }, { node: nseg, ux: true, uy: true, rz: true }] });
    chk('삼각 고정단 wL²/30', near(Math.abs(r.elementEnd[0].Mi), 12, 0.01));
    chk('삼각 고정단 wL²/20', near(Math.abs(r.elementEnd[nseg - 1].Mj), 18, 0.01));
  }
  // 4) 폐합 정사각 박스 4면 등압 p=10, L=4 → 모든 우각부 |M| = pL²/12 = 13.333 (처짐각법 앵커 교차)
  {
    const L = 4, nseg = 6, nodes = [], elements = [];
    const ring = [];
    // 하변 → 우변 → 상변 → 좌변 (반시계), 내향 압력 = 각 변의 국부 −y? 진행방향 좌측이 내부가 되도록 반시계 순회 → 외압(내향)은 국부 −y
    const corners = [[0, 0], [L, 0], [L, L], [0, L]];
    for (let s = 0; s < 4; s++) {
      const [x0, y0] = corners[s], [x1, y1] = corners[(s + 1) % 4];
      for (let k = 0; k < nseg; k++) {
        ring.push([x0 + (x1 - x0) * k / nseg, y0 + (y1 - y0) * k / nseg]);
      }
    }
    ring.forEach((p) => nodes.push(p));
    const nn = ring.length;
    for (let k = 0; k < nn; k++) elements.push({ i: k, j: (k + 1) % nn, E, A, I, w1: -10, w2: -10 });
    const r = solveFrame2D({ nodes, elements, fixes: [{ node: 0, ux: true, uy: true }, { node: nseg, uy: true }] });
    const Mc = Math.abs(r.elementEnd[0].Mi); // 우각부(절점0)
    chk('폐합박스 등압 pL²/12', near(Mc, 10 * 16 / 12, 0.01));
  }
  console.log(`frame2d self-test: ${ok}/${tot}${ok === tot ? ' PASS' : ' FAIL'}`);
  if (ok !== tot) process.exit(1);
}
