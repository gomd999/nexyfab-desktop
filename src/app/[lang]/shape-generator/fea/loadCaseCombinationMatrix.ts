/**
 * loadCaseCombinationMatrix.ts — Build the load case combination
 * matrix per design code (Eurocode 0, AISC LRFD, ASME).
 *
 * In structural FEA, you don't analyse loads individually — you
 * combine them with code-specified factors:
 *
 *   Eurocode 0 (ULS):
 *     1.35·DL + 1.5·LL + 1.5·ψ·WIND + …
 *
 *   AISC LRFD:
 *     1.2·DL + 1.6·LL
 *     1.2·DL + 1.0·LL + 1.0·WIND
 *
 * Module:
 *   - Accepts named base load cases (DL, LL, WIND, SNOW, etc.).
 *   - Generates combination rows per chosen design code.
 *   - Outputs a matrix [combination × loadCase] of factors.
 *   - Tags each combination "ULS" vs "SLS".
 */

export type DesignCode = 'eurocode-uls' | 'eurocode-sls' | 'aisc-lrfd' | 'aisc-asd' | 'asme-allowable';

export type LoadCaseKind = 'dead' | 'live' | 'wind' | 'snow' | 'seismic' | 'thermal' | 'pressure' | 'crane';

export interface BaseLoadCase {
  id: string;
  kind: LoadCaseKind;
  /** Stored magnitude (units depend on case). */
  magnitude: number;
}

export interface CombinationRow {
  id: string;
  code: DesignCode;
  /** 'ULS' = Ultimate Limit State, 'SLS' = Serviceability. */
  state: 'ULS' | 'SLS' | 'allowable';
  /** Per-load-case factor. */
  factors: Record<string, number>;
  description: string;
}

export interface CombinationMatrix {
  baseCases: BaseLoadCase[];
  rows: CombinationRow[];
}

// ── Top-level entry ────────────────────────────────────────────

export function buildMatrix(cases: BaseLoadCase[], code: DesignCode): CombinationMatrix {
  let rows: CombinationRow[];
  switch (code) {
    case 'eurocode-uls':
      rows = eurocodeUls(cases);
      break;
    case 'eurocode-sls':
      rows = eurocodeSls(cases);
      break;
    case 'aisc-lrfd':
      rows = aiscLrfd(cases);
      break;
    case 'aisc-asd':
      rows = aiscAsd(cases);
      break;
    case 'asme-allowable':
      rows = asmeAllowable(cases);
      break;
  }
  return { baseCases: cases, rows };
}

// ── Code-specific generators ──────────────────────────────────

function eurocodeUls(cases: BaseLoadCase[]): CombinationRow[] {
  const has = (k: LoadCaseKind) => cases.some(c => c.kind === k);
  const rows: CombinationRow[] = [];
  const dl = idsOf(cases, 'dead');
  const ll = idsOf(cases, 'live');
  const wind = idsOf(cases, 'wind');
  const snow = idsOf(cases, 'snow');

  if (has('dead') && has('live')) {
    rows.push({
      id: 'EC-ULS-1', code: 'eurocode-uls', state: 'ULS',
      factors: factorize({ ...mapTo(dl, 1.35), ...mapTo(ll, 1.5) }),
      description: '1.35·DL + 1.5·LL',
    });
  }
  if (has('dead') && has('live') && has('wind')) {
    rows.push({
      id: 'EC-ULS-2', code: 'eurocode-uls', state: 'ULS',
      factors: factorize({ ...mapTo(dl, 1.35), ...mapTo(ll, 1.5 * 0.7), ...mapTo(wind, 1.5) }),
      description: '1.35·DL + 1.5·0.7·LL + 1.5·WIND',
    });
  }
  if (has('dead') && has('snow')) {
    rows.push({
      id: 'EC-ULS-3', code: 'eurocode-uls', state: 'ULS',
      factors: factorize({ ...mapTo(dl, 1.35), ...mapTo(snow, 1.5) }),
      description: '1.35·DL + 1.5·SNOW',
    });
  }
  return rows;
}

function eurocodeSls(cases: BaseLoadCase[]): CombinationRow[] {
  const has = (k: LoadCaseKind) => cases.some(c => c.kind === k);
  const dl = idsOf(cases, 'dead');
  const ll = idsOf(cases, 'live');
  const wind = idsOf(cases, 'wind');
  const rows: CombinationRow[] = [];
  if (has('dead') && has('live')) {
    rows.push({
      id: 'EC-SLS-1', code: 'eurocode-sls', state: 'SLS',
      factors: factorize({ ...mapTo(dl, 1.0), ...mapTo(ll, 1.0) }),
      description: 'Characteristic: DL + LL',
    });
  }
  if (has('dead') && has('wind')) {
    rows.push({
      id: 'EC-SLS-2', code: 'eurocode-sls', state: 'SLS',
      factors: factorize({ ...mapTo(dl, 1.0), ...mapTo(wind, 1.0) }),
      description: 'Characteristic: DL + WIND',
    });
  }
  return rows;
}

function aiscLrfd(cases: BaseLoadCase[]): CombinationRow[] {
  const dl = idsOf(cases, 'dead');
  const ll = idsOf(cases, 'live');
  const wind = idsOf(cases, 'wind');
  const seismic = idsOf(cases, 'seismic');
  const rows: CombinationRow[] = [];
  if (dl.length > 0) {
    rows.push({ id: 'LRFD-1', code: 'aisc-lrfd', state: 'ULS', factors: factorize({ ...mapTo(dl, 1.4) }), description: '1.4·DL' });
  }
  if (dl.length > 0 && ll.length > 0) {
    rows.push({ id: 'LRFD-2', code: 'aisc-lrfd', state: 'ULS', factors: factorize({ ...mapTo(dl, 1.2), ...mapTo(ll, 1.6) }), description: '1.2·DL + 1.6·LL' });
  }
  if (dl.length > 0 && ll.length > 0 && wind.length > 0) {
    rows.push({ id: 'LRFD-3', code: 'aisc-lrfd', state: 'ULS', factors: factorize({ ...mapTo(dl, 1.2), ...mapTo(ll, 1.0), ...mapTo(wind, 1.0) }), description: '1.2·DL + 1.0·LL + 1.0·WIND' });
  }
  if (dl.length > 0 && seismic.length > 0) {
    rows.push({ id: 'LRFD-4', code: 'aisc-lrfd', state: 'ULS', factors: factorize({ ...mapTo(dl, 1.2), ...mapTo(seismic, 1.0) }), description: '1.2·DL + 1.0·E' });
  }
  return rows;
}

function aiscAsd(cases: BaseLoadCase[]): CombinationRow[] {
  const dl = idsOf(cases, 'dead');
  const ll = idsOf(cases, 'live');
  const wind = idsOf(cases, 'wind');
  const rows: CombinationRow[] = [];
  if (dl.length > 0 && ll.length > 0) {
    rows.push({ id: 'ASD-1', code: 'aisc-asd', state: 'allowable', factors: factorize({ ...mapTo(dl, 1.0), ...mapTo(ll, 1.0) }), description: 'DL + LL' });
  }
  if (dl.length > 0 && wind.length > 0) {
    rows.push({ id: 'ASD-2', code: 'aisc-asd', state: 'allowable', factors: factorize({ ...mapTo(dl, 1.0), ...mapTo(wind, 0.6) }), description: 'DL + 0.6·WIND' });
  }
  return rows;
}

function asmeAllowable(cases: BaseLoadCase[]): CombinationRow[] {
  const dl = idsOf(cases, 'dead');
  const press = idsOf(cases, 'pressure');
  const therm = idsOf(cases, 'thermal');
  const rows: CombinationRow[] = [];
  if (dl.length > 0 && press.length > 0) {
    rows.push({ id: 'ASME-1', code: 'asme-allowable', state: 'allowable', factors: factorize({ ...mapTo(dl, 1.0), ...mapTo(press, 1.0) }), description: 'DL + P' });
  }
  if (dl.length > 0 && press.length > 0 && therm.length > 0) {
    rows.push({ id: 'ASME-2', code: 'asme-allowable', state: 'allowable', factors: factorize({ ...mapTo(dl, 1.0), ...mapTo(press, 1.0), ...mapTo(therm, 1.0) }), description: 'DL + P + Thermal' });
  }
  return rows;
}

// ── Helpers ───────────────────────────────────────────────────

function idsOf(cases: BaseLoadCase[], kind: LoadCaseKind): string[] {
  return cases.filter(c => c.kind === kind).map(c => c.id);
}

function mapTo(ids: string[], factor: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = factor;
  return out;
}

function factorize(map: Record<string, number>): Record<string, number> {
  return map;
}

// ── Evaluate combination magnitude ────────────────────────────

export function evaluateCombination(matrix: CombinationMatrix, combinationId: string): number {
  const row = matrix.rows.find(r => r.id === combinationId);
  if (!row) return 0;
  let total = 0;
  for (const c of matrix.baseCases) {
    const factor = row.factors[c.id] ?? 0;
    total += factor * c.magnitude;
  }
  return total;
}

// ── Summary ────────────────────────────────────────────────────

export interface MatrixSummary {
  baseCaseCount: number;
  combinationCount: number;
  ulsCount: number;
  slsCount: number;
}

export function summarize(matrix: CombinationMatrix): MatrixSummary {
  return {
    baseCaseCount: matrix.baseCases.length,
    combinationCount: matrix.rows.length,
    ulsCount: matrix.rows.filter(r => r.state === 'ULS').length,
    slsCount: matrix.rows.filter(r => r.state === 'SLS').length,
  };
}
