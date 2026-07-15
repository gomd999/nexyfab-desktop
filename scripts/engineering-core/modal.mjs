/**
 * modal.mjs — 층 전단빌딩 모드해석 + KDS 설계스펙트럼 SRSS (응답스펙트럼 해석).
 * K(층강성 행렬, 3중대각) + M(집중질량 대각) → 일반 고유치(K φ = ω² M φ)
 * — 대칭 표준화(M^-1/2 K M^-1/2) 후 Jacobi 회전(소규모 n≤50 정확).
 * 설계스펙트럼(KDS 41 17 00 §4 표준 형상): Sa = SDS(0.4+0.6T/T0) [T<T0] ·
 * SDS [T0≤T≤Ts] · SD1/T [Ts<T≤TL] · SD1·TL/T² [T>TL], T0=0.2SD1/SDS, Ts=SD1/SDS.
 * 모드별 V = (Sa/(R/IE))·W·Γ²(유효질량비) → SRSS 조합.
 * 앵커: 2자유도 등질량·등강성 ω² = (3±√5)/2·k/m (황금비 폐형) · SDOF ω=√(k/m).
 */

/** Jacobi 고유치 (대칭 행렬, n≤50) → { values(오름차순), vectors(열) } */
export function jacobiEigen(Ain) {
  const n = Ain.length;
  const A = Ain.map((r) => [...r]);
  let V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-15) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const idx = A.map((_, i) => i).sort((a, b) => A[a][a] - A[b][b]);
  return {
    values: idx.map((i) => A[i][i]),
    vectors: idx.map((i) => V.map((row) => row[i])), // vectors[m][dof]
  };
}

/** 전단빌딩: 층강성 k[](kN/m, 1층부터) + 층질량 m[](ton) → 모드 { T, phi, gamma, effMassRatio } */
export function shearBuildingModes(kStory, mass) {
  const n = mass.length;
  // K 3중대각
  const K = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    K[i][i] = kStory[i] + (i + 1 < n ? kStory[i + 1] : 0);
    if (i + 1 < n) { K[i][i + 1] = -kStory[i + 1]; K[i + 1][i] = -kStory[i + 1]; }
  }
  // 표준화 B = M^-1/2 K M^-1/2
  const s = mass.map((m) => 1 / Math.sqrt(m));
  const B = K.map((row, i) => row.map((v, j) => v * s[i] * s[j]));
  const { values, vectors } = jacobiEigen(B);
  const totalM = mass.reduce((a, b) => a + b, 0);
  return values.map((lam, m) => {
    const omega = Math.sqrt(Math.max(0, lam));
    const phi = vectors[m].map((v, i) => v * s[i]); // 원좌표 모드형상
    const L = phi.reduce((sum, p, i) => sum + mass[i] * p, 0);
    const Mn = phi.reduce((sum, p, i) => sum + mass[i] * p * p, 0);
    const gamma = L / Mn;
    return { mode: m + 1, omega, T_s: omega > 0 ? (2 * Math.PI) / omega : Infinity, phi, gamma, effMassRatio: (L * L) / (Mn * totalM) };
  });
}

/** KDS 설계스펙트럼 Sa(T) — SDS·SD1·TL(초) */
export function designSa(T, SDS, SD1, TL = 5) {
  const Ts = SD1 / SDS, T0 = 0.2 * Ts;
  if (T < T0) return SDS * (0.4 + 0.6 * T / T0);
  if (T <= Ts) return SDS;
  if (T <= TL) return SD1 / T;
  return (SD1 * TL) / (T * T);
}

/** 응답스펙트럼 해석: 모드별 밑면전단 → SRSS */
export function responseSpectrumAnalysis({ kStory_kNm, mass_ton, SDS, SD1, TL = 5, R = 1, IE = 1, nModes }) {
  const modes = shearBuildingModes(kStory_kNm, mass_ton);
  const take = Math.min(nModes ?? modes.length, modes.length);
  const g = 9.81;
  const rows = modes.slice(0, take).map((md) => {
    const Sa = designSa(md.T_s, SDS, SD1, TL) / (R / IE);
    const Wtot = mass_ton.reduce((a, b) => a + b, 0) * g; // kN
    const Vm = Sa * md.effMassRatio * Wtot;
    return { mode: md.mode, T_s: +md.T_s.toFixed(4), Sa_g: +Sa.toFixed(4), effMass: +md.effMassRatio.toFixed(4), V_kN: +Vm.toFixed(1) };
  });
  const V_srss = Math.sqrt(rows.reduce((s, r) => s + r.V_kN * r.V_kN, 0));
  const cumEff = rows.reduce((s, r) => s + r.effMass, 0);
  return { modes: rows, V_srss_kN: +V_srss.toFixed(1), cumEffMass: +cumEff.toFixed(3) };
}

// --- self-test ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('modal.mjs');
if (isMain) {
  const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.abs(b);
  let ok = 0, tot = 0;
  const chk = (n, c) => { tot++; if (c) ok++; else console.log('✗', n); };
  // SDOF: k=1000 kN/m, m=10 ton → ω²=100, T=2π/10=0.6283
  const m1 = shearBuildingModes([1000], [10]);
  chk('SDOF ω²', near(m1[0].omega ** 2, 100));
  // 2DOF 등질량·등강성: λ = (3∓√5)/2 · k/m = 0.382, 2.618 (황금비 폐형)
  const m2 = shearBuildingModes([1000, 1000], [10, 10]);
  chk('2DOF λ1 0.382k/m', near(m2[0].omega ** 2, 38.1966, 0.001));
  chk('2DOF λ2 2.618k/m', near(m2[1].omega ** 2, 261.803, 0.001));
  chk('유효질량 합=1', near(m2[0].effMassRatio + m2[1].effMassRatio, 1, 1e-6));
  // 스펙트럼 형상: T=Ts에서 SDS = SD1/Ts 연속
  const SDS = 0.5, SD1 = 0.2, Ts = SD1 / SDS;
  chk('스펙트럼 연속', near(designSa(Ts, SDS, SD1), SDS) && near(designSa(Ts + 1e-9, SDS, SD1), SDS, 1e-6));
  // RSA: SDOF 평탄역(T<Ts) → V = SDS/R·W 정확
  const rsa = responseSpectrumAnalysis({ kStory_kNm: [9870], mass_ton: [10], SDS: 0.5, SD1: 0.2, R: 1, IE: 1 }); // T=0.20s ∈ [T0,Ts] 평탄역
  chk('SDOF RSA V=SDS·W', near(rsa.V_srss_kN, 0.5 * 10 * 9.81, 0.002));
  console.log(`modal self-test: ${ok}/${tot}${ok === tot ? ' PASS' : ' FAIL'}`);
  if (ok !== tot) process.exit(1);
}
