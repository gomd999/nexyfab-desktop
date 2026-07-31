/**
 * transientThermal.ts — transient (time-dependent) heat conduction on the HEX8
 * kernel:  C·dT/dt + K_t·T = Q.  C is the lumped heat-capacity matrix, K_t the
 * HEX8 conductance (shared with the steady solver). Integrated with BACKWARD
 * EULER — implicit and unconditionally stable, so large time steps never blow up.
 *
 *   (C/Δt + K_t) T^{n+1} = (C/Δt) T^n + Q
 *
 * Verified against the analytic transient solution (lumped heating, modal decay
 * rate, steady-state limit).
 *
 * Units: conductivity in W/(mm·K); volHeatCapacity ρ·c_p in J/(mm³·K); cell in mm;
 * dt in s ⇒ thermal diffusivity α = k / (ρ·c_p) in mm²/s.
 */
import { TopologyGrid } from '../analysis/topology3D';
import { buildHex8Thermal0 } from './thermalFEM';

export interface TransientThermalOptions {
  conductivity: number;            // k, W/(mm·K)
  /**
   * ρ·c_p, J/(mm³·K). 스칼라(균일) 또는 **절점별** 배열.
   *
   * ★260801 — 절점별을 받게 확장했다. 상변화 해석은 절점마다 상(고체/mushy/액체)이 달라
   *   **겉보기 비열이 절점마다 다르다.** 처음엔 그걸 평균 하나로 뭉갰다가 에너지 수지가
   *   356% 어긋났다 — 서로 다른 상을 평균하면 잠열이 엉뚱한 곳에 배분된다.
   */
  volHeatCapacity: number | Float32Array;
  cell: number;                    // voxel size (mm)
  /** Prescribed temperatures (held constant in time). */
  fixedTemp: Map<number, number>;
  /** Nodal heat sources Q (W), constant in time. */
  heatSource?: Map<number, number>;
  /** Initial temperature: scalar (uniform) or per-node field. */
  initialTemp: number | Float32Array;
  dt: number;                      // time step (s)
  steps: number;                   // number of steps
  /** Nodes whose temperature time-history to record (for inspection). */
  probeNodes?: number[];
}

export interface TransientThermalResult {
  /** Final temperature per node. */
  temperature: Float32Array;
  /** Recorded times (s), length steps+1 (including t=0). */
  times: number[];
  /** probe[k] = time-history of probeNodes[k] (length steps+1). */
  probe: number[][];
  maxTemp: number;
  minTemp: number;
}

function cg(matvec: (x: Float64Array, out: Float64Array) => void, b: Float64Array, x0: Float64Array, n: number, iters = Math.max(500, n * 2), tol = 1e-10): Float64Array {
  const x = Float64Array.from(x0), r = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
  matvec(x, Ap);
  for (let i = 0; i < n; i++) { r[i] = b[i] - Ap[i]; p[i] = r[i]; }
  const dot = (u: Float64Array, v: Float64Array) => { let s = 0; for (let i = 0; i < n; i++) s += u[i] * v[i]; return s; };
  let rr = dot(r, r); const b2 = Math.max(dot(b, b), 1e-300);
  for (let it = 0; it < iters; it++) {
    matvec(p, Ap);
    const alpha = rr / (dot(p, Ap) || 1e-300);
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
    const rrNew = dot(r, r);
    if (rrNew / b2 < tol * tol) break;
    const beta = rrNew / (rr || 1e-300);
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i];
    rr = rrNew;
  }
  return x;
}

/**
 * Time-march the transient heat equation. Reuses the HEX8 conductance and adds a
 * lumped heat-capacity matrix C (ρ·c_p·V/8 per node per element); backward Euler
 * gives a constant system matrix A = C/Δt + K_t, refactored implicitly by CG each
 * step (only the RHS changes).
 */
/**
 * 전도항 (K_t·T) 와 절점 집중 체적을 돌려준다 — 엔탈피법이 쓰려고 뽑아 둔 것.
 * ⚠ K_t 는 **행 합이 0** 이다(전도는 열을 만들지도 없애지도 않는다). 그 성질이
 *   엔탈피 갱신의 보존성을 보장한다 — Σ(K·T)_i = 0 이므로 총 엔탈피 변화 = 순 투입열.
 */
export function hex8ConductionFlux(
  grid: TopologyGrid, conductivity: number, cell: number, T: ArrayLike<number>,
): { flux: Float64Array; nodeVolume: Float64Array } {
  const K0 = buildHex8Thermal0();
  const kScale = conductivity * cell;
  const n = grid.nNodes;
  const flux = new Float64Array(n);
  const nodeVolume = new Float64Array(n);
  const v8 = cell ** 3 / 8;
  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const ns = grid.elemNodes(ex, ey, ez);
    for (let a = 0; a < 8; a++) {
      nodeVolume[ns[a]] += v8;
      let sum = 0;
      for (let b = 0; b < 8; b++) sum += kScale * K0[a * 8 + b] * T[ns[b]]!;
      flux[ns[a]] += sum;
    }
  }
  return { flux, nodeVolume };
}

export function hex8TransientThermal(grid: TopologyGrid, opts: TransientThermalOptions): TransientThermalResult {
  const K0 = buildHex8Thermal0();
  const kScale = opts.conductivity * opts.cell;     // K_e = k·h·K0
  // 절점별 체적비열 → 요소당 집중 용량. 스칼라면 전 절점 동일.
  const capOf = typeof opts.volHeatCapacity === 'number'
    ? () => opts.volHeatCapacity as number
    : (nd: number) => (opts.volHeatCapacity as Float32Array)[nd] ?? 0;
  const cellVol8 = opts.cell ** 3 / 8;
  const nNodes = grid.nNodes;

  // free-node reduction (fixed-temperature nodes removed; they stay constant).
  const isFixed = new Uint8Array(nNodes);
  for (const nd of opts.fixedTemp.keys()) isFixed[nd] = 1;
  const freeIdx = new Int32Array(nNodes).fill(-1);
  let nFree = 0;
  for (let i = 0; i < nNodes; i++) if (!isFixed[i]) freeIdx[i] = nFree++;

  // assemble conductance rows (free×free) + lumped capacity per free node +
  // the steady source/Dirichlet RHS contribution (constant in time).
  const rows: Map<number, number>[] = Array.from({ length: nFree }, () => new Map());
  const C = new Float64Array(nFree);
  const fixedDir = new Float64Array(nFree);         // -Σ K·T_fixed (Dirichlet → RHS)
  const ns = new Array<number>(8);
  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const corners = grid.elemNodes(ex, ey, ez);
    for (let i = 0; i < 8; i++) ns[i] = corners[i];
    for (let a = 0; a < 8; a++) {
      const ra = freeIdx[ns[a]];
      if (ra < 0) continue;
      C[ra] += capOf(ns[a]) * cellVol8;
      for (let b = 0; b < 8; b++) {
        const kab = kScale * K0[a * 8 + b];
        if (kab === 0) continue;
        const rb = freeIdx[ns[b]];
        if (rb >= 0) rows[ra].set(rb, (rows[ra].get(rb) ?? 0) + kab);
        else fixedDir[ra] -= kab * (opts.fixedTemp.get(ns[b]) ?? 0);
      }
    }
  }
  const cols: Int32Array[] = rows.map((m) => Int32Array.from(m.keys()));
  const vals: Float64Array[] = rows.map((m) => Float64Array.from(m.values()));

  // constant source RHS term
  const Qsrc = new Float64Array(nFree);
  if (opts.heatSource) for (const [nd, q] of opts.heatSource) { const r = freeIdx[nd]; if (r >= 0) Qsrc[r] += q; }

  // A = C/dt + K_t  (matrix-free)
  const invDt = 1 / opts.dt;
  const matvecA = (x: Float64Array, out: Float64Array) => {
    for (let i = 0; i < nFree; i++) {
      const c = cols[i], v = vals[i];
      let s = C[i] * invDt * x[i];
      for (let j = 0; j < c.length; j++) s += v[j] * x[c[j]];
      out[i] = s;
    }
  };

  // initial state
  const temperature = new Float32Array(nNodes);
  for (let i = 0; i < nNodes; i++) {
    temperature[i] = isFixed[i] ? (opts.fixedTemp.get(i) ?? 0)
      : typeof opts.initialTemp === 'number' ? opts.initialTemp : opts.initialTemp[i];
  }
  let Tfree: Float64Array = new Float64Array(nFree);
  for (let i = 0; i < nNodes; i++) if (freeIdx[i] >= 0) Tfree[freeIdx[i]] = temperature[i];

  const probeNodes = opts.probeNodes ?? [];
  const times: number[] = [0];
  const probe: number[][] = probeNodes.map((nd) => [temperature[nd]]);

  const rhs = new Float64Array(nFree);
  for (let step = 0; step < opts.steps; step++) {
    // RHS = C/dt·T^n + Q + Dirichlet
    for (let i = 0; i < nFree; i++) rhs[i] = C[i] * invDt * Tfree[i] + Qsrc[i] + fixedDir[i];
    Tfree = cg(matvecA, rhs, Tfree, nFree);
    for (let i = 0; i < nNodes; i++) if (freeIdx[i] >= 0) temperature[i] = Tfree[freeIdx[i]];
    times.push((step + 1) * opts.dt);
    for (let k = 0; k < probeNodes.length; k++) probe[k].push(temperature[probeNodes[k]]);
  }

  let maxT = -Infinity, minT = Infinity;
  for (let i = 0; i < nNodes; i++) { const T = temperature[i]; if (T > maxT) maxT = T; if (T < minT) minT = T; }
  return { temperature, times, probe, maxTemp: maxT, minTemp: minT };
}

/* ── 상변화 열해석 (260801, 격차 항목 S4) ────────────────────────────────────
 * 잠열이 있는 재료(응고·융해)는 상변화 구간에서 **온도가 정체**한다. 위 `hex8TransientThermal`
 * 은 비열이 상수라 그 정체를 만들지 못한다 — 냉각이 실제보다 **빨리** 끝난다.
 *
 * 엔탈피로 보면 간단하다:
 * ```
 *   H(T) = ρ·c_p·T + L·f_l(T)        f_l = 액상분율 (고상선 T_s 아래 0, 액상선 T_l 위 1)
 * ```
 * ⚠ 흔한 「겉보기 비열법」(c_eff = c_p + L/ΔT_mushy 를 현재 온도에서 평가)은 **에너지를
 *   잃는다** — 한 스텝에 mushy 구간을 건너뛰면 그 구간의 잠열이 통째로 빠진다.
 *   그래서 여기서는 **엔탈피 할선(secant)** 을 쓴다:
 * ```
 *   c_app = [H(T^{n+1}) − H(T^n)] / (T^{n+1} − T^n)
 * ```
 *   구성상 에너지가 보존된다(할선은 두 점 사이 엔탈피 차를 정확히 담는다).
 *   T^{n+1} 이 미지라 스텝마다 고정점 반복을 돈다.
 */

export interface PhaseChangeOptions extends TransientThermalOptions {
  /** 체적 잠열 L (J/mm³). 0 이면 상변화 없음 — 위 솔버와 같은 답이 나와야 한다. */
  latentHeat: number;
  /** 고상선 (°C). 이 아래는 완전 고체. */
  solidusC: number;
  /** 액상선 (°C). 이 위는 완전 액체. `solidusC` 보다 커야 한다. */
  liquidusC: number;
  /**
   * 스텝당 고정점 반복 상한 (기본 30).
   *
   * ★ 엔탈피 할선은 **고정점이 수렴해야만** 에너지를 정확히 보존한다
   *   (c_app 를 만든 온도와 실제로 나온 온도가 같아야 할선이 성립한다).
   *   기본 8 로 뒀다가 에너지 수지가 3% 어긋났다 — 정확도가 아니라 **수렴**의 문제였다.
   */
  maxInnerIters?: number;
  /** 고정점 수렴 판정 온도 허용오차 (K, 기본 1e-7). */
  innerTolK?: number;
}

export interface PhaseChangeResult extends TransientThermalResult {
  /** 최종 시각의 절점별 액상분율 (0~1). */
  liquidFraction: Float32Array;
  /** 상변화가 진행 중인(0<f_l<1) 절점 수 — 계면이 격자에 잡혔는지 본다. */
  mushyNodes: number;
  /** 사용자가 읽어야 할 한계. 비어 있으면 「검출된 것 없음」이지 「없음」이 아니다. */
  warnings: string[];
  /**
   * 고정점이 **끝까지 수렴하지 않은** 스텝 수. 0 이 아니면 그만큼 에너지 보존이 깨진다 —
   * ⚠ 결과를 막지는 않되 **숨기지도 않는다.**
   */
  nonConvergedSteps: number;
}

/** 액상분율 — 고상선/액상선 사이를 선형으로 본다(가장 흔한 가정). */
export function liquidFractionAt(T: number, solidusC: number, liquidusC: number): number {
  if (!(liquidusC > solidusC)) return T >= liquidusC ? 1 : 0; // 등온 상변화(폭 0)
  if (T <= solidusC) return 0;
  if (T >= liquidusC) return 1;
  return (T - solidusC) / (liquidusC - solidusC);
}

/**
 * 상변화를 포함한 과도 열전도.
 *
 * ⚠ **격자는 복셀(HEX8)** 이라 상변화 계면이 격자 해상도로만 잡힌다 — 계면 위치의
 *   정확도를 주장하려면 격자를 계면 두께보다 잘게 해야 한다. 그 판단을 돕도록
 *   `mushyNodes` 를 돌려준다(0 이면 계면이 격자에 **하나도 안 잡힌 것**이다).
 * ⚠ `latentHeat = 0` 이면 `hex8TransientThermal` 과 같은 문제가 된다 — 그 등가성은
 *   테스트로 잠가 두었다.
 */
/**
 * 엔탈피 → 온도 (닫힌 형태). H(T) 는 단조라 역이 유일하다.
 * 등온 상변화(T_l = T_s)면 H 가 그 온도에서 L 만큼 **점프**하므로, 그 구간의 T 는 T_s 다.
 */
export function temperatureFromEnthalpy(H: number, rhoCp: number, L: number, Ts: number, Tl: number): number {
  const Hs = rhoCp * Ts;              // 고상선에서의 엔탈피 (f=0)
  const Hl = rhoCp * Tl + L;          // 액상선에서의 엔탈피 (f=1)
  if (H <= Hs) return rhoCp > 0 ? H / rhoCp : Ts;
  if (H >= Hl) return rhoCp > 0 ? (H - L) / rhoCp : Tl;
  if (!(Tl > Ts)) return Ts;          // 등온 상변화 — 잠열을 흡수하는 동안 온도 정체
  // mushy: H = rhoCp·T + L·(T−Ts)/(Tl−Ts)
  const k = L / (Tl - Ts);
  return (H + k * Ts) / (rhoCp + k);
}

/**
 * 상변화를 포함한 과도 열전도 — **엔탈피 갱신법**.
 *
 * ## 왜 겉보기 비열법을 쓰지 않았나 (실측)
 * 처음엔 겉보기 비열(엔탈피 할선)로 만들었다. 그런데 절점이 mushy 구간에 **진입하는
 * 순간** 비열이 불연속으로 뛰어 고정점이 **진동**했고, 에너지가 한 번에 새어 나갔다:
 * ```
 *   L=1  40스텝: −5.5% (미수렴 6스텝)      L=2  40스텝: −19.9% (미수렴 14스텝)
 *   반복 상한을 8→30 으로 올려도 2.77% → 2.77%  ← 수렴 문제가 아니었다
 * ```
 * **반복을 늘려 고칠 수 있는 문제가 아니다.** 그래서 방법을 바꿨다.
 *
 * ## 엔탈피 갱신 — **수렴이 아니라 구성으로 보존된다**
 * ```
 *   V_i (H_i^{n+1} − H_i^n) = Δt · [ Q_i − (K·T)_i ]      T = T(H)  (닫힌 형태 역변환)
 * ```
 * K 의 행 합이 0 이므로 Σ_i (K·T)_i = 0 → **총 엔탈피 변화 = 순 투입 열량**이 항등적으로
 * 성립한다. 반복이 덜 수렴해도 **에너지는 정확히 보존된다** — 반복은 정확도만 좌우한다.
 *
 * ⚠ 전도항을 반복 안에서 갱신한다(반음해). 큰 Δt 에서는 정확도가 떨어질 수 있어
 *   푸리에 수를 검사해 경고한다 — **조용히 틀린 답을 주지 않는다.**
 * ⚠ 격자는 복셀(HEX8)이라 계면이 격자 해상도로만 잡힌다. `mushyNodes` 로 알린다.
 */
/**
 * 상변화를 포함한 과도 열전도 — **Voller 소스법(엔탈피)**.
 *
 * ## 두 번의 실패에서 얻은 방법 (실측 기록)
 * ```
 * ① 겉보기 비열법  mushy 진입 시 비열이 불연속 → 고정점 진동 → 에너지 −5.5~−19.9% 손실
 *                  반복 8→30 으로 올려도 2.77% 그대로. **반복으로 고칠 문제가 아니었다.**
 * ② 엔탈피 명시갱신 보존은 정확했으나 전도항 Picard 반복이 **발산**(T ~ 1e115).
 *                  보존과 안정성을 맞바꾼 셈.
 * ③ Voller 소스법  전도는 **기존 음해 솔버**에 맡기고, 잠열만 우변 소스로 넘긴다.
 * ```
 *
 * ## 방법
 * ```
 *   (C_s/Δt + K) T^{k+1} = (C_s/Δt) T^n + Q − (V·L/Δt)(f^k − f^n)      C_s = ρc_p·V (상수)
 *   f^{k+1} = clamp[ f^k + ω·(ρc_p/L)·(T^{k+1} − T_mid(f^k)) ]         T_mid(f)=Ts+f(Tl−Ts)
 * ```
 * 행렬이 **상수**라 조건이 좋고(비열이 뛰지 않는다), 수렴하면 총 엔탈피 변화가 순 투입열과
 * 정확히 같다. 전도는 음해라 큰 Δt 에서도 발산하지 않는다.
 *
 * ⚠ 격자는 복셀(HEX8)이라 계면이 격자 해상도로만 잡힌다 — `mushyNodes` 로 알린다.
 * ⚠ 수렴하지 않은 스텝 수를 **숨기지 않는다**(`nonConvergedSteps`).
 */
export function hex8PhaseChangeThermal(grid: TopologyGrid, opts: PhaseChangeOptions): PhaseChangeResult {
  const warnings: string[] = [];
  const { latentHeat: L, solidusC: Ts, liquidusC: Tl } = opts;
  const n = grid.nNodes;
  const empty = (msg: string): PhaseChangeResult => ({
    temperature: new Float32Array(n), times: [0], probe: [], maxTemp: NaN, minTemp: NaN,
    liquidFraction: new Float32Array(n), mushyNodes: 0, nonConvergedSteps: 0, warnings: [msg],
  });
  // ⚠ 뒤집힌·음수 입력을 말없이 바로잡지 않는다 — 무엇을 의도했는지 우리는 모른다.
  if (!(Tl >= Ts)) return empty(`액상선(${Tl})이 고상선(${Ts})보다 작다 — 입력이 뒤집혔다. 계산하지 않는다.`);
  if (L < 0) return empty(`잠열이 음수(${L})다 — 계산하지 않는다.`);

  const rhoCp = typeof opts.volHeatCapacity === 'number' ? opts.volHeatCapacity : (opts.volHeatCapacity[0] ?? 0);
  const maxInner = opts.maxInnerIters ?? 30;
  const innerTol = opts.innerTolK ?? 1e-5;
  const omega = 0.8;   // Voller 완화계수 — 1 보다 작게 두어야 진동하지 않는다
  let nonConverged = 0;

  const isFixed = new Uint8Array(n);
  for (const nd of opts.fixedTemp.keys()) isFixed[nd] = 1;

  let T = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    T[i] = isFixed[i] ? (opts.fixedTemp.get(i) ?? 0)
      : typeof opts.initialTemp === 'number' ? opts.initialTemp : opts.initialTemp[i]!;
  }
  const { nodeVolume } = hex8ConductionFlux(grid, opts.conductivity, opts.cell, T);
  let f = new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = liquidFractionAt(T[i]!, Ts, Tl);

  const baseQ = new Float64Array(n);
  if (opts.heatSource) for (const [nd, q] of opts.heatSource) baseQ[nd] += q;

  const probeNodes = opts.probeNodes ?? [];
  const times: number[] = [0];
  const probe: number[][] = probeNodes.map((nd) => [T[nd]!]);
  let crossedInOneStep = 0;
  const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

  for (let step = 0; step < opts.steps; step++) {
    const Tn = Float64Array.from(T);
    const fn = Float64Array.from(f);
    let fk = Float64Array.from(f);
    let Tk = Float64Array.from(T);
    let converged = false;

    for (let inner = 0; inner < maxInner; inner++) {
      // 잠열을 **소스로** 넘긴다 — 행렬(비열)은 건드리지 않는다.
      const src = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        const latent = (nodeVolume[i]! * L * (fk[i]! - fn[i]!)) / opts.dt;
        const q = baseQ[i]! - latent;
        if (q !== 0) src.set(i, q);
      }
      const r = hex8TransientThermal(grid, {
        ...opts, volHeatCapacity: rhoCp, initialTemp: Float32Array.from(Tn),
        heatSource: src, dt: opts.dt, steps: 1, probeNodes: [],
      });
      const Tnew = r.temperature;
      // Voller 액상분율 갱신 (완화). L=0 이면 상변화가 없으므로 f 는 온도에서 직접 얻는다.
      const fNext = new Float64Array(n);
      let maxDiff = 0;
      for (let i = 0; i < n; i++) {
        const Tmid = Ts + fk[i]! * (Tl - Ts);
        fNext[i] = L > 0 ? clamp01(fk[i]! + (omega * rhoCp * (Tnew[i]! - Tmid)) / L)
          : liquidFractionAt(Tnew[i]!, Ts, Tl);
        maxDiff = Math.max(maxDiff, Math.abs(Tnew[i]! - Tk[i]!));
        Tk[i] = Tnew[i]!;
      }
      fk = fNext;
      if (maxDiff < innerTol) { converged = true; break; }
    }
    if (!converged) nonConverged++;

    for (let i = 0; i < n; i++) {
      if ((fn[i] === 0 && fk[i] === 1) || (fn[i] === 1 && fk[i] === 0)) crossedInOneStep++;
    }
    T = Tk; f = fk;
    times.push((step + 1) * opts.dt);
    probeNodes.forEach((nd, k) => probe[k]!.push(T[nd]!));
  }

  const temperature = new Float32Array(n);
  const liquidFraction = new Float32Array(n);
  let mushy = 0, maxT = -Infinity, minT = Infinity;
  for (let i = 0; i < n; i++) {
    temperature[i] = T[i]!;
    liquidFraction[i] = f[i]!;
    if (f[i]! > 0 && f[i]! < 1) mushy++;
    if (T[i]! > maxT) maxT = T[i]!;
    if (T[i]! < minT) minT = T[i]!;
  }
  if (L > 0 && mushy === 0) {
    warnings.push('상변화 구간에 있는 절점이 하나도 없다 — 계면이 격자·시간 해상도에 잡히지 않았다. 계면 위치를 주장하지 말 것.');
  }
  if (crossedInOneStep > 0) {
    warnings.push(`${crossedInOneStep}개 절점이 한 스텝에 상변화 구간을 통째로 통과했다 — 계면 추적의 시간 해상도가 부족하다. Δt 를 줄이라.`);
  }
  if (nonConverged > 0) {
    warnings.push(`${nonConverged}/${opts.steps} 스텝에서 내부 반복이 수렴하지 않았다 — 그 스텝의 에너지 수지와 온도 분포를 신뢰할 수 없다.`);
  }
  return { temperature, times, probe, maxTemp: maxT, minTemp: minT, liquidFraction, mushyNodes: mushy, warnings, nonConvergedSteps: nonConverged };
}
