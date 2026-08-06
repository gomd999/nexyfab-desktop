import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { CadLengthUnit, DeclaredSourceTolerance } from '../../src/lib/reference/cadTolerancePolicy';

export const REFERENCE_BASELINE_LOCAL_CAPABILITY = Object.freeze({
  id: 'reference-baseline-v2',
  command: 'npm run corpus:baseline:v2 --',
  localOnly: true,
  api: null,
  mcp: null,
  acceptsLocalPaths: true,
  quoteOrRfqSideEffects: false,
});

export interface ReferenceBaselineCliOptions {
  corpusRoot: string;
  outputDir: string;
  lengthUnit: CadLengthUnit;
  declaredSourceTolerance?: DeclaredSourceTolerance;
  tier?: 'core-a' | 'challenge-b';
  fixtureIds?: string[];
  shard?: { index: number; count: number };
  resume: boolean;
}

export type ReferenceBaselineCliParseResult =
  | { ok: true; value: ReferenceBaselineCliOptions }
  | { ok: false; error: string };

function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

export function parseReferenceBaselineArgs(args: readonly string[], cwd = process.cwd()): ReferenceBaselineCliParseResult {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < args.length; index++) {
    const token = args[index]!;
    if (!token.startsWith('--')) return { ok: false, error: `Unexpected positional argument: ${token}` };
    const equals = token.indexOf('=');
    if (equals > 2) { flags.set(token.slice(2, equals), token.slice(equals + 1)); continue; }
    const name = token.slice(2);
    if (name === 'resume') { flags.set(name, true); continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) return { ok: false, error: `--${name} requires a value.` };
    flags.set(name, value);
  }
  const allowed = new Set(['root', 'output', 'unit', 'scale-to-mm', 'tolerance', 'tier', 'fixture', 'shard-index', 'shard-count', 'resume']);
  const unknown = [...flags.keys()].find(key => !allowed.has(key));
  if (unknown) return { ok: false, error: `Unknown option: --${unknown}` };
  const root = flags.get('root'); const output = flags.get('output');
  if (typeof root !== 'string' || typeof output !== 'string') return { ok: false, error: '--root and --output are required.' };
  const corpusRoot = resolve(cwd, root); const outputDir = resolve(cwd, output);
  if (within(corpusRoot, outputDir) || within(outputDir, corpusRoot)) {
    return { ok: false, error: 'Corpus root and output directory must not overlap.' };
  }

  const scaleFlag = flags.get('scale-to-mm');
  const unitFlag = flags.get('unit');
  let lengthUnit: CadLengthUnit;
  if (typeof scaleFlag === 'string') {
    const scaleToMm = Number(scaleFlag);
    if (!Number.isFinite(scaleToMm) || scaleToMm <= 0) return { ok: false, error: '--scale-to-mm must be finite and positive.' };
    lengthUnit = { kind: 'scale-to-mm', scaleToMm, ...(typeof unitFlag === 'string' ? { label: unitFlag } : {}) };
  } else {
    const scales: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
    if (typeof unitFlag !== 'string' || scales[unitFlag] === undefined) return { ok: false, error: '--unit is required (mm|cm|m|in|ft), or use --scale-to-mm.' };
    lengthUnit = unitFlag === 'mm' ? { kind: 'mm' } : { kind: 'scale-to-mm', scaleToMm: scales[unitFlag]!, label: unitFlag };
  }

  const toleranceFlag = flags.get('tolerance');
  let declaredSourceTolerance: DeclaredSourceTolerance | undefined;
  if (typeof toleranceFlag === 'string') {
    const value = Number(toleranceFlag);
    if (!Number.isFinite(value) || value <= 0) return { ok: false, error: '--tolerance must be finite and positive.' };
    declaredSourceTolerance = { value };
  }
  const tierFlag = flags.get('tier');
  if (tierFlag !== undefined && tierFlag !== 'core-a' && tierFlag !== 'challenge-b') return { ok: false, error: '--tier must be core-a or challenge-b.' };
  const fixtureFlag = flags.get('fixture');
  let fixtureIds: string[] | undefined;
  if (typeof fixtureFlag === 'string') {
    fixtureIds = fixtureFlag.split(',').map(value => value.trim()).filter(Boolean);
    if (fixtureIds.length === 0 || fixtureIds.some(value => !/^(?:A(?:0[1-9]|1[0-8])|B0[1-7])$/.test(value)) || new Set(fixtureIds).size !== fixtureIds.length) {
      return { ok: false, error: '--fixture must be a unique comma-separated list of A01-A18 or B01-B07 ids.' };
    }
  }
  const shardIndexFlag = flags.get('shard-index'); const shardCountFlag = flags.get('shard-count');
  if ((shardIndexFlag === undefined) !== (shardCountFlag === undefined)) return { ok: false, error: '--shard-index and --shard-count must be provided together.' };
  let shard: { index: number; count: number } | undefined;
  if (typeof shardIndexFlag === 'string' && typeof shardCountFlag === 'string') {
    const index = Number(shardIndexFlag); const count = Number(shardCountFlag);
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 1 || count < 1 || index > count) {
      return { ok: false, error: 'Shard values must be integers satisfying 1 <= index <= count.' };
    }
    shard = { index, count };
  }
  return {
    ok: true,
    value: {
      corpusRoot, outputDir, lengthUnit,
      ...(declaredSourceTolerance ? { declaredSourceTolerance } : {}),
      ...(tierFlag ? { tier: tierFlag } : {}), ...(fixtureIds ? { fixtureIds } : {}), ...(shard ? { shard } : {}),
      resume: flags.get('resume') === true,
    },
  };
}
