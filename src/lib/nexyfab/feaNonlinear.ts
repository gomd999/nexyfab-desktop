// FEA — nonlinear + modal extensions.
// The existing linear static solver lives in fea/* ; this module adds two
// extensions critical for production CAD:
//
//   1. Newton-Raphson loop for hyperelastic material (Mooney-Rivlin).
//      Each step linearizes around the current deformation, solves the
//      same linear system, and updates until residual converges.
//
//   2. Modal analysis — eigenvalue decomposition of stiffness/mass to
//      find natural frequencies. Uses inverse iteration for the lowest
//      `k` modes, which is what designers actually want.
//
// The matrix ops are implemented in plain JS so we don't bring in numjs /
// math.js. Performance is O(n²·iters) for typical < 5k-DOF meshes.

export interface MaterialNonlinear {
  /** Mooney-Rivlin C10 constant (MPa). */
  C10: number;
  /** Mooney-Rivlin C01 constant (MPa). */
  C01: number;
  /** Bulk modulus (MPa) — penalty for volume change. */
  K: number;
  /** Density (kg/m³) — needed for modal. */
  density: number;
}

export interface NonlinearStepInput {
  /** Element stiffness assembled at the current state (n×n). */
  K: number[][];
  /** Tangent stiffness (n×n) — derivative of internal force wrt DOFs. */
  Kt: number[][];
  /** External force vector (n). */
  fExt: number[];
  /** Internal force (n) at current displacement. */
  fInt: number[];
  /** Current displacement guess. */
  u: number[];
}

export interface NewtonResult {
  u: number[];
  iterations: number;
  residual: number;
  converged: boolean;
}

/**
 * One full Newton-Raphson solve for static nonlinear stress equilibrium.
 * The caller is responsible for re-assembling Kt / fInt every iteration —
 * this just drives the iteration loop and applies damping.
 */
export function newtonRaphson(
  initial: number[],
  assemble: (u: number[]) => NonlinearStepInput,
  tolerance = 1e-6,
  maxIters = 25,
  damping = 1.0,
): NewtonResult {
  let u = [...initial];
  let iter = 0;
  let residual = Infinity;
  for (iter = 0; iter < maxIters; iter++) {
    const { Kt, fExt, fInt } = assemble(u);
    const r = fExt.map((v, i) => v - fInt[i]);
    residual = Math.sqrt(r.reduce((s, v) => s + v * v, 0));
    if (residual < tolerance) break;
    // Solve Kt · du = r (Gaussian elimination — O(n³); replace with sparse
    // Cholesky for production meshes > 5k DOF).
    const du = solveLinearSystem(Kt, r);
    for (let i = 0; i < u.length; i++) u[i] += du[i] * damping;
  }
  return { u, iterations: iter, residual, converged: residual < tolerance };
}

// ─── Modal analysis ────────────────────────────────────────────────────────

export interface ModalInput {
  /** Stiffness matrix (n × n). */
  K: number[][];
  /** Mass matrix (n × n). */
  M: number[][];
  /** Number of low-frequency modes to extract. */
  modes: number;
}

export interface ModeShape {
  /** Eigenvalue λ (rad/s)². */
  eigenvalue: number;
  /** Frequency (Hz). */
  frequencyHz: number;
  /** Normalized mode shape vector. */
  shape: number[];
}

/**
 * Inverse iteration for the lowest `modes` natural frequencies. Each mode
 * is found by repeatedly solving K·v = M·v with deflation against earlier
 * modes. Converges quickly for the lowest few modes which is what design
 * review actually needs (resonance check ≤ 100 Hz typically).
 */
export function modalAnalysis(input: ModalInput, maxIters = 50, tolerance = 1e-5): ModeShape[] {
  const { K, M, modes } = input;
  const n = K.length;
  const result: ModeShape[] = [];

  for (let m = 0; m < modes; m++) {
    // Initial guess — unit vector with one component biased per mode index.
    let v = new Array(n).fill(0);
    v[m % n] = 1;
    // Deflate against earlier modes.
    for (const earlier of result) {
      const proj = innerProduct(v, earlier.shape);
      for (let i = 0; i < n; i++) v[i] -= proj * earlier.shape[i];
    }

    let lambda = 0;
    for (let iter = 0; iter < maxIters; iter++) {
      const Mv = matvec(M, v);
      const w = solveLinearSystem(K, Mv);
      // Rayleigh quotient → eigenvalue estimate.
      const num = innerProduct(w, Mv);
      const den = innerProduct(w, matvec(M, w));
      const newLambda = den > 1e-12 ? num / den : 0;
      // Normalize against mass: vᵀ M v = 1
      const nw = Math.sqrt(innerProduct(w, matvec(M, w))) || 1;
      const wn = w.map(x => x / nw);
      // Deflate again.
      for (const earlier of result) {
        const proj = innerProduct(wn, earlier.shape);
        for (let i = 0; i < n; i++) wn[i] -= proj * earlier.shape[i];
      }
      const diff = Math.abs(newLambda - lambda);
      lambda = newLambda;
      v = wn;
      if (diff < tolerance) break;
    }

    const omega = Math.sqrt(Math.max(0, lambda));
    result.push({
      eigenvalue: lambda,
      frequencyHz: omega / (2 * Math.PI),
      shape: v,
    });
  }
  return result.sort((a, b) => a.frequencyHz - b.frequencyHz);
}

// ─── Matrix helpers ────────────────────────────────────────────────────────

function matvec(M: number[][], v: number[]): number[] {
  const n = v.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const row = M[i];
    for (let j = 0; j < n; j++) s += row[j] * v[j];
    out[i] = s;
  }
  return out;
}

function innerProduct(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Solve A·x = b with Gaussian elimination + partial pivoting. */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const aug: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    // Pivot.
    let pivot = i;
    let pivotVal = Math.abs(aug[i][i]);
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(aug[k][i]) > pivotVal) { pivot = k; pivotVal = Math.abs(aug[k][i]); }
    }
    if (pivot !== i) [aug[i], aug[pivot]] = [aug[pivot], aug[i]];
    const div = aug[i][i] || 1e-12;
    // Eliminate below.
    for (let k = i + 1; k < n; k++) {
      const factor = aug[k][i] / div;
      for (let j = i; j <= n; j++) aug[k][j] -= factor * aug[i][j];
    }
  }
  // Back-substitute.
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = aug[i][n];
    for (let j = i + 1; j < n; j++) s -= aug[i][j] * x[j];
    x[i] = s / (aug[i][i] || 1e-12);
  }
  return x;
}
