/**
 * transientThermal — time-dependent heat conduction on the HEX8 kernel, verified
 * against the analytic transient solution: lumped heating (capacity + integrator),
 * modal decay rate α(π/L)² (capacity↔conductance coupling), and the steady-state
 * limit (backward Euler converges to the exact steady profile).
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { hex8TransientThermal, hex8PhaseChangeThermal } from './transientThermal';

const k = 0.05, rhoC = 0.0035; // steel-ish: α = k/ρc ≈ 14.3 mm²/s

describe('transientThermal — time-dependent conduction (verified)', () => {
  it('insulated body + uniform source rises linearly: dT/dt = Q/C', () => {
    const grid = new TopologyGrid(1, 1, 1);
    const h = 5, Q = 2;
    const heatSource = new Map<number, number>();
    for (let n = 0; n < 8; n++) heatSource.set(n, Q);   // every node of the single element
    const r = hex8TransientThermal(grid, {
      conductivity: k, volHeatCapacity: rhoC, cell: h, fixedTemp: new Map(), heatSource,
      initialTemp: 20, dt: 1, steps: 10, probeNodes: [0, 7],
    });
    const C = (rhoC * h ** 3) / 8;                       // lumped nodal capacity
    const expected = 20 + (Q / C) * 10;
    expect(r.probe[0][10]).toBeCloseTo(expected, 4);     // exact linear rise
    expect(Math.abs(r.probe[0][10] - r.probe[1][10])).toBeLessThan(1e-6); // stays uniform
  });

  it('a bar cooling with fixed ends decays at the analytic rate α(π/L)²', () => {
    const nx = 10, h = 5;
    const grid = new TopologyGrid(nx, 1, 1);
    const fixedTemp = new Map<number, number>();
    for (let iy = 0; iy <= 1; iy++) for (let iz = 0; iz <= 1; iz++) {
      fixedTemp.set(grid.node(0, iy, iz), 0); fixedTemp.set(grid.node(nx, iy, iz), 0);
    }
    const mid = grid.node(nx / 2, 0, 0);
    const r = hex8TransientThermal(grid, {
      conductivity: k, volHeatCapacity: rhoC, cell: h, fixedTemp, initialTemp: 100,
      dt: 0.5, steps: 160, probeNodes: [mid],
    });
    const L = nx * h, alpha = k / rhoC;
    const analyticRate = alpha * (Math.PI / L) ** 2;
    const i1 = r.times.indexOf(40), i2 = r.times.indexOf(70);  // late: higher modes gone
    const femRate = -Math.log(r.probe[0][i2] / r.probe[0][i1]) / (r.times[i2] - r.times[i1]);
    expect(femRate / analyticRate).toBeGreaterThan(0.92);
    expect(femRate / analyticRate).toBeLessThan(1.08);
    // monotonic cooling toward the fixed 0.
    expect(r.probe[0][i2]).toBeLessThan(r.probe[0][i1]);
    expect(r.probe[0][i2]).toBeGreaterThan(0);
  });

  it('converges to the exact steady-state linear profile (backward Euler stable at large Δt)', () => {
    const nx = 10, h = 5;
    const grid = new TopologyGrid(nx, 2, 2);
    const fixedTemp = new Map<number, number>();
    for (let iy = 0; iy <= 2; iy++) for (let iz = 0; iz <= 2; iz++) {
      fixedTemp.set(grid.node(0, iy, iz), 100); fixedTemp.set(grid.node(nx, iy, iz), 0);
    }
    const r = hex8TransientThermal(grid, {
      conductivity: k, volHeatCapacity: rhoC, cell: h, fixedTemp, initialTemp: 0,
      dt: 5, steps: 200,  // large Δt — implicit scheme stays stable
    });
    let maxErr = 0;
    for (let ix = 0; ix <= nx; ix++) {
      const T = r.temperature[grid.node(ix, 1, 1)];
      maxErr = Math.max(maxErr, Math.abs(T - 100 * (1 - ix / nx)));
    }
    expect(maxErr).toBeLessThan(1e-3);                  // matches the steady linear solution
  });
});

/**
 * hex8PhaseChangeThermal — 상변화(잠열) 열해석 (260801).
 *
 * 채점 기준은 **에너지 보존**과 **닫힌해**다:
 *   · 잠열 0 → 기존 상수비열 솔버와 **같은 답**이어야 한다
 *   · 단열체에 일정 열량 Q 를 넣으면 상변화 구간 통과에 L·V/Q 만큼 **더 걸린다**
 *   · 그 지연은 잠열에 **비례**한다
 * 「값이 나온다」가 아니라 「열역학이 맞는가」를 본다.
 */
describe('hex8PhaseChangeThermal — 상변화(잠열)', () => {
  const grid = new TopologyGrid(3, 3, 3);
  const cell = 10;
  const base = {
    conductivity: 0.05,        // W/(mm·K)
    volHeatCapacity: 0.0036,   // J/(mm³·K)  ≈ 강
    cell,
    fixedTemp: new Map<number, number>(),
    initialTemp: 0,
    dt: 5,
    steps: 60,
    solidusC: 40,
    liquidusC: 60,
  };
  /** 전 절점에 균등 가열 — 단열체(고정온도 없음)라 에너지 수지가 정확히 성립한다. */
  const heatEach = 0.5; // W per node
  const src = new Map<number, number>();
  for (let i = 0; i < grid.nNodes; i++) src.set(i, heatEach);

  it('★잠열 0 이면 기존 상수비열 솔버와 같은 답 — 새 경로가 옛 경로를 깨지 않는다', () => {
    const a = hex8TransientThermal(grid, { ...base, heatSource: src });
    const b = hex8PhaseChangeThermal(grid, { ...base, heatSource: src, latentHeat: 0 });
    expect(b.maxTemp).toBeCloseTo(a.maxTemp, 3);
  });

  it('★잠열이 있으면 상변화 구간을 지나는 데 더 걸린다 — 온도가 낮게 끝난다', () => {
    const noL = hex8PhaseChangeThermal(grid, { ...base, heatSource: src, latentHeat: 0 });
    const withL = hex8PhaseChangeThermal(grid, { ...base, heatSource: src, latentHeat: 2 });
    expect(withL.maxTemp).toBeLessThan(noL.maxTemp);
  });

  it('★에너지 보존 — 총 엔탈피 증가 = 투입 열량 (잠열 포함)', () => {
    /**
     * ⚠ 처음엔 `maxTemp` 하나로 「균일 온도」를 가정해 검사했다가 18.6% 어긋났다.
     *   절점마다 **집중 체적이 다르다**(모서리는 요소 1개, 내부는 8개) — 균등 열원을 주면
     *   온도가 균일하지 않다. **검사식이 틀렸던 것이지 솔버가 틀린 게 아니었다.**
     *   그래서 절점 체적으로 **제대로 적분**한다.
     */
    const h3_8 = cell ** 3 / 8;
    const nodeVol = (ix: number, iy: number, iz: number) =>
      h3_8 * (ix === 0 || ix === grid.nx ? 1 : 2) * (iy === 0 || iy === grid.ny ? 1 : 2) * (iz === 0 || iz === grid.nz ? 1 : 2);
    const rhoCp = base.volHeatCapacity;
    const steps = 80;
    const totalEnthalpy = (L: number) => {
      const r = hex8PhaseChangeThermal(grid, { ...base, heatSource: src, latentHeat: L, steps });
      let H = 0;
      for (let iz = 0; iz <= grid.nz; iz++) for (let iy = 0; iy <= grid.ny; iy++) for (let ix = 0; ix <= grid.nx; ix++) {
        const T = r.temperature[grid.node(ix, iy, iz)]!;
        const fl = T <= base.solidusC ? 0 : T >= base.liquidusC ? 1 : (T - base.solidusC) / (base.liquidusC - base.solidusC);
        H += (rhoCp * T + L * fl) * nodeVol(ix, iy, iz);
      }
      return H;
    };
    const supplied = heatEach * grid.nNodes * base.dt * steps;   // [J]
    // ⚠ 물리적 값을 쓴다. 강의 체적 잠열 ≈ 250 kJ/kg × 7.85e-6 kg/mm³ ≈ 2 J/mm³.
    //   처음엔 50~300 을 썼다가 잠열이 투입 열량의 1000배가 되어 상변화가 아예 진행되지 않았다.
    for (const L of [0, 1, 2]) {
      const err = Math.abs(totalEnthalpy(L) - supplied) / supplied;
      expect(err, `L=${L} 에서 엔탈피 오차 ${(err * 100).toFixed(3)}%`).toBeLessThan(0.005);
    }
  });

  it('상변화 구간을 지나는 중이면 mushy 절점이 잡힌다', () => {
    const r = hex8PhaseChangeThermal(grid, { ...base, heatSource: src, latentHeat: 2, steps: 40 });
    expect(r.mushyNodes).toBeGreaterThan(0);
    expect(r.liquidFraction.some((f) => f > 0 && f < 1)).toBe(true);
  });
});

describe('★hex8PhaseChangeThermal — 모르는 것을 지어내지 않는다', () => {
  const grid = new TopologyGrid(2, 2, 2);
  const base = {
    conductivity: 0.05, volHeatCapacity: 0.0036, cell: 10,
    fixedTemp: new Map<number, number>(), initialTemp: 0, dt: 5, steps: 5,
    solidusC: 40, liquidusC: 60,
  };

  it('★고상선>액상선(뒤집힌 입력)을 말없이 바로잡지 않고 거부한다', () => {
    const r = hex8PhaseChangeThermal(grid, { ...base, solidusC: 60, liquidusC: 40, latentHeat: 100 });
    expect(r.warnings[0]).toContain('뒤집혔다');
    expect(Number.isNaN(r.maxTemp)).toBe(true);
  });

  it('음수 잠열을 거부한다', () => {
    const r = hex8PhaseChangeThermal(grid, { ...base, latentHeat: -1 });
    expect(r.warnings[0]).toContain('음수');
  });

  it('★계면이 격자에 안 잡히면 경고한다 — 조용히 계면 위치를 주장하지 않는다', () => {
    // 전 영역이 고상선 아래에 머무는 조건
    const r = hex8PhaseChangeThermal(grid, { ...base, latentHeat: 100, steps: 1, dt: 0.01 });
    expect(r.mushyNodes).toBe(0);
    expect(r.warnings.join(' ')).toContain('계면');
  });
});
