/**
 * 2D 골조 매트릭스 해석 — 직접강성법 (플랫폼 중립, 결정론).
 * 범위: 선형탄성 · 2D 프레임(노드당 u,v,θ 3DOF) · 절점하중 + 부재 등분포하중(고정단력 등가).
 * 용도: 랙 프레임·가설 동바리·경량 골조 (plan §3 해석축 — 전체계 FE·비선형·시간이력은 스코프 밖).
 * 단위: N, mm (E MPa, A mm², I mm⁴) — 결과 변위 mm, 부재력 N·N·mm.
 *
 * 입력: {
 *   nodes:    [{id, x, y}],
 *   elements: [{id, from, to, E, A, I, w?}]   // w = 부재 국부 y방향 등분포 N/mm (보 하향 = 음수)
 *   supports: [{node, ux?, uy?, rz?}]          // true = 구속
 *   loads:    [{node, fx?, fy?, mz?}]          // N, N·mm
 * }
 * 출력: 절점변위, 지점반력, 부재 단부력(국부: 축력·전단·모멘트)
 */

function zeros(n, m) { return Array.from({ length: n }, () => Array.from({ length: m }, () => 0)); }

function localStiffness(E, A, I, L) {
  const a = (E * A) / L, b = (12 * E * I) / L ** 3, c = (6 * E * I) / L ** 2, d = (4 * E * I) / L, e = (2 * E * I) / L;
  return [
    [a, 0, 0, -a, 0, 0],
    [0, b, c, 0, -b, c],
    [0, c, d, 0, -c, e],
    [-a, 0, 0, a, 0, 0],
    [0, -b, -c, 0, b, -c],
    [0, c, e, 0, -c, d],
  ];
}

function transform(cs, sn) {
  const T = zeros(6, 6);
  const r = [[cs, sn, 0], [-sn, cs, 0], [0, 0, 1]];
  for (const blk of [0, 3]) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) T[blk + i][blk + j] = r[i][j];
  return T;
}

function matMul(A, B) {
  const n = A.length, m = B[0].length, p = B.length;
  const C = zeros(n, m);
  for (let i = 0; i < n; i++) for (let k = 0; k < p; k++) { const a = A[i][k]; if (a === 0) continue; for (let j = 0; j < m; j++) C[i][j] += a * B[k][j]; }
  return C;
}
function matT(A) {
  const n = A.length, m = A[0].length;
  const C = zeros(m, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) C[j][i] = A[i][j];
  return C;
}
function matVec(A, v) {
  const out = new Array(A.length).fill(0);
  for (let i = 0; i < A.length; i++) for (let k = 0; k < v.length; k++) out[i] += A[i][k] * v[k];
  return out;
}

function solve(K, F) {
  const n = F.length;
  const A = K.map((row, i) => [...row, F[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-9) throw new Error(`singular stiffness matrix (불안정 구조 — 지점/부재 구성 확인, DOF ${col})`);
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      for (let c2 = col; c2 <= n; c2++) A[r][c2] -= f * A[col][c2];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = A[r][n];
    for (let c2 = r + 1; c2 < n; c2++) s -= A[r][c2] * x[c2];
    x[r] = s / A[r][r];
  }
  return x;
}

export function analyzeFrame2D({ nodes, elements, supports = [], loads = [] }) {
  if (!nodes?.length || !elements?.length) throw new Error('input gate: nodes/elements required');
  if (nodes.length > 200 || elements.length > 400) throw new Error('size gate: 200노드/400부재 초과 — 본 도구는 경량 골조용');
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const ndof = nodes.length * 3;
  const K = zeros(ndof, ndof);
  const F = new Float64Array(ndof);
  const elemData = [];

  for (const el of elements) {
    const i = idx.get(el.from), j = idx.get(el.to);
    if (i === undefined || j === undefined) throw new Error(`element ${el.id}: unknown node`);
    const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
    const L = Math.hypot(dx, dy);
    if (L <= 0) throw new Error(`element ${el.id}: zero length`);
    for (const [f, nm] of [[el.E, 'E'], [el.A, 'A'], [el.I, 'I']]) if (!(f > 0)) throw new Error(`element ${el.id}: ${nm} > 0 required`);
    const cs = dx / L, sn = dy / L;
    const k = localStiffness(el.E, el.A, el.I, L);
    const T = transform(cs, sn);
    const Kg = matMul(matT(T), matMul(k, T));
    const dofs = [3 * i, 3 * i + 1, 3 * i + 2, 3 * j, 3 * j + 1, 3 * j + 2];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) K[dofs[r]][dofs[c]] += Kg[r][c];
    // 등분포하중 고정단력 등가 (국부 y방향 w)
    const w = el.w ?? 0;
    const feq = [0, (w * L) / 2, (w * L * L) / 12, 0, (w * L) / 2, -(w * L * L) / 12];
    if (w !== 0) {
      const feqG = matVec(matT(T), feq);
      for (let r = 0; r < 6; r++) F[dofs[r]] += feqG[r];
    }
    elemData.push({ el, dofs, k, T, feq, L });
  }
  for (const ld of loads) {
    const i = idx.get(ld.node);
    if (i === undefined) throw new Error(`load: unknown node ${ld.node}`);
    F[3 * i] += ld.fx ?? 0; F[3 * i + 1] += ld.fy ?? 0; F[3 * i + 2] += ld.mz ?? 0;
  }

  const fixed = new Set();
  for (const s of supports) {
    const i = idx.get(s.node);
    if (i === undefined) throw new Error(`support: unknown node ${s.node}`);
    if (s.ux) fixed.add(3 * i); if (s.uy) fixed.add(3 * i + 1); if (s.rz) fixed.add(3 * i + 2);
  }
  if (fixed.size < 3) throw new Error('support gate: 최소 3 DOF 구속 필요(강체운동 방지)');

  const free = [...Array(ndof).keys()].filter((d) => !fixed.has(d));
  const Kff = free.map((r) => free.map((c) => K[r][c]));
  const Ff = free.map((d) => F[d]);
  const df = solve(Kff, Ff);
  const d = new Float64Array(ndof);
  free.forEach((dof, i) => { d[dof] = df[i]; });

  // 반력 = K·d − F (구속 DOF)
  const reactions = [];
  for (const s of supports) {
    const i = idx.get(s.node);
    const rx = s.ux ? matVecRow(K, d, 3 * i) - F[3 * i] : null;
    const ry = s.uy ? matVecRow(K, d, 3 * i + 1) - F[3 * i + 1] : null;
    const rm = s.rz ? matVecRow(K, d, 3 * i + 2) - F[3 * i + 2] : null;
    reactions.push({ node: s.node, Rx_N: rx, Ry_N: ry, Mz_Nmm: rm });
  }

  const memberForces = elemData.map(({ el, dofs, k, T, feq }) => {
    const dl = matVec(T, dofs.map((dof) => d[dof]));
    const fl = matVec(k, dl).map((v, r) => v - feq[r]);
    return {
      element: el.id,
      end_i: { axial_N: fl[0], shear_N: fl[1], moment_Nmm: fl[2] },
      end_j: { axial_N: fl[3], shear_N: fl[4], moment_Nmm: fl[5] },
    };
  });

  return {
    method: '직접강성법(선형탄성 2D 프레임) — 결정론',
    scope: '경량 골조 1차해석. P-Δ·비선형·좌굴계수 미포함 — 부재검토는 column_buckling/simple_beam으로 연계',
    displacements: nodes.map((n, i) => ({ node: n.id, ux_mm: d[3 * i], uy_mm: d[3 * i + 1], rz_rad: d[3 * i + 2] })),
    reactions,
    memberForces,
  };
}

function matVecRow(K, d, row) {
  let s = 0;
  for (let c = 0; c < d.length; c++) s += K[row][c] * d[c];
  return s;
}
