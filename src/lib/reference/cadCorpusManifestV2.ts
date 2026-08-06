/**
 * Versioned, metadata-only manifest for externally stored CAD evaluation files.
 *
 * This module deliberately contains neither CAD bytes nor machine-specific absolute
 * paths. A runner must resolve `locator.fragments` under an explicitly configured
 * corpus root and verify the optional digest before opening a fixture.
 */

export const CAD_CORPUS_MANIFEST_V2_SCHEMA = 'nexyfab.cad-corpus-manifest.v2' as const;

export type CadCorpusTierV2 = 'core-a' | 'challenge-b';
export type CadCorpusGradeV2 = 'A' | 'B';
export type CadCorpusSplitV2 = 'training' | 'example' | 'evaluation';
export type CadCorpusFormatV2 = 'step' | 'stp';

export interface CadCorpusLocatorV2 {
  /** Ordered, case-insensitive substrings used to discover one file below a caller-owned root. */
  kind: 'path-fragments';
  fragments: string[];
}

export interface CadCorpusUsagePolicyV2 {
  storage: 'local-only';
  redistribution: 'forbidden-until-proven';
  promptExample: false;
}

export interface CadCorpusFixtureV2 {
  fixtureId: string;
  locator: CadCorpusLocatorV2;
  /** Lower-case SHA-256. Optional only while the manifest lifecycle is `draft`. */
  sha256?: string;
  format: CadCorpusFormatV2;
  grade: CadCorpusGradeV2;
  tier: CadCorpusTierV2;
  split: CadCorpusSplitV2;
  assertions: string[];
  usage: CadCorpusUsagePolicyV2;
  /** Similar or byte-identical files share a group so aggregate scoring can de-duplicate them. */
  duplicateGroup?: string;
  /** Product-level isolation boundary. A group may belong to exactly one split. */
  holdoutGroup: string;
  /** Observed bytes once frozen. */
  bytes?: number;
  /** Per-fixture hard read limit, independent of the run-wide budget. */
  byteBudget: number;
}

export interface CadCorpusManifestV2 {
  schema: typeof CAD_CORPUS_MANIFEST_V2_SCHEMA;
  lifecycle: 'draft' | 'frozen';
  byteBudget: {
    maxFixtureBytes: number;
    maxRunBytes: number;
  };
  fixtures: CadCorpusFixtureV2[];
}

export interface CadCorpusManifestV2Issue {
  code:
    | 'invalid_manifest'
    | 'invalid_fixture'
    | 'duplicate_fixture_id'
    | 'invalid_hash'
    | 'unsafe_locator'
    | 'invalid_assertions'
    | 'invalid_byte_budget'
    | 'holdout_leakage'
    | 'freeze_incomplete';
  path: string;
  message: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const FIXTURE_ID = /^(?:A(?:0[1-9]|1[0-8])|B0[1-7])$/;
const VALID_FORMATS = new Set<CadCorpusFormatV2>(['step', 'stp']);
const VALID_GRADES = new Set<CadCorpusGradeV2>(['A', 'B']);
const VALID_TIERS = new Set<CadCorpusTierV2>(['core-a', 'challenge-b']);
const VALID_SPLITS = new Set<CadCorpusSplitV2>(['training', 'example', 'evaluation']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function locatorFragmentIsSafe(fragment: string): boolean {
  return fragment.length > 0 &&
    fragment !== '.' && fragment !== '..' &&
    !fragment.includes('/') && !fragment.includes('\\') &&
    !fragment.includes(':') && fragment.indexOf('\0') === -1;
}

/** Validate untrusted JSON without resolving or reading any external file. */
export function validateCadCorpusManifestV2(input: unknown): CadCorpusManifestV2Issue[] {
  const issues: CadCorpusManifestV2Issue[] = [];
  const add = (code: CadCorpusManifestV2Issue['code'], path: string, message: string) => {
    issues.push({ code, path, message });
  };

  if (!isRecord(input)) {
    add('invalid_manifest', '$', 'Manifest must be an object.');
    return issues;
  }
  if (input.schema !== CAD_CORPUS_MANIFEST_V2_SCHEMA) {
    add('invalid_manifest', '$.schema', `Schema must be ${CAD_CORPUS_MANIFEST_V2_SCHEMA}.`);
  }
  if (input.lifecycle !== 'draft' && input.lifecycle !== 'frozen') {
    add('invalid_manifest', '$.lifecycle', 'Lifecycle must be draft or frozen.');
  }

  const budget = input.byteBudget;
  if (!isRecord(budget) || !positiveSafeInteger(budget.maxFixtureBytes) ||
      !positiveSafeInteger(budget.maxRunBytes) || budget.maxRunBytes < budget.maxFixtureBytes) {
    add('invalid_byte_budget', '$.byteBudget', 'Byte budgets must be positive safe integers and run >= fixture.');
  }

  if (!Array.isArray(input.fixtures)) {
    add('invalid_manifest', '$.fixtures', 'Fixtures must be an array.');
    return issues;
  }

  const ids = new Set<string>();
  const splitByHoldout = new Map<string, string>();
  input.fixtures.forEach((raw, index) => {
    const path = `$.fixtures[${index}]`;
    if (!isRecord(raw)) {
      add('invalid_fixture', path, 'Fixture must be an object.');
      return;
    }
    const id = typeof raw.fixtureId === 'string' ? raw.fixtureId : '';
    if (!FIXTURE_ID.test(id)) add('invalid_fixture', `${path}.fixtureId`, 'Fixture id must be A01-A18 or B01-B07.');
    if (ids.has(id)) add('duplicate_fixture_id', `${path}.fixtureId`, `Duplicate fixture id: ${id}.`);
    ids.add(id);

    if (raw.sha256 !== undefined && (typeof raw.sha256 !== 'string' || !SHA256.test(raw.sha256))) {
      add('invalid_hash', `${path}.sha256`, 'SHA-256 must contain exactly 64 lower-case hexadecimal characters.');
    }
    if (input.lifecycle === 'frozen' && (typeof raw.sha256 !== 'string' || !SHA256.test(raw.sha256))) {
      add('freeze_incomplete', `${path}.sha256`, 'Frozen fixtures require a verified SHA-256.');
    }

    const locator = raw.locator;
    if (!isRecord(locator) || locator.kind !== 'path-fragments' || !Array.isArray(locator.fragments) ||
        locator.fragments.length < 2 || locator.fragments.some(value => typeof value !== 'string' || !locatorFragmentIsSafe(value))) {
      add('unsafe_locator', `${path}.locator`, 'Locator requires at least two safe relative path fragments.');
    }

    if (!VALID_FORMATS.has(raw.format as CadCorpusFormatV2) ||
        !VALID_GRADES.has(raw.grade as CadCorpusGradeV2) ||
        !VALID_TIERS.has(raw.tier as CadCorpusTierV2) ||
        !VALID_SPLITS.has(raw.split as CadCorpusSplitV2)) {
      add('invalid_fixture', path, 'Fixture format, grade, tier, or split is invalid.');
    }
    if ((raw.grade === 'A') !== (raw.tier === 'core-a')) {
      add('invalid_fixture', path, 'Grade A maps to core-a and grade B maps to challenge-b.');
    }

    if (!Array.isArray(raw.assertions) || raw.assertions.length === 0 ||
        raw.assertions.some(value => typeof value !== 'string' || !SAFE_TOKEN.test(value)) ||
        new Set(raw.assertions).size !== raw.assertions.length) {
      add('invalid_assertions', `${path}.assertions`, 'Assertions must be a non-empty unique list of stable tokens.');
    }

    const usage = raw.usage;
    if (!isRecord(usage) || usage.storage !== 'local-only' ||
        usage.redistribution !== 'forbidden-until-proven' || usage.promptExample !== false) {
      add('invalid_fixture', `${path}.usage`, 'External fixtures must remain local-only, non-redistributable, and excluded from prompts.');
    }
    if (raw.duplicateGroup !== undefined &&
        (typeof raw.duplicateGroup !== 'string' || !SAFE_TOKEN.test(raw.duplicateGroup))) {
      add('invalid_fixture', `${path}.duplicateGroup`, 'Duplicate group must be a stable token.');
    }

    const holdout = typeof raw.holdoutGroup === 'string' ? raw.holdoutGroup : '';
    if (!SAFE_TOKEN.test(holdout)) {
      add('invalid_fixture', `${path}.holdoutGroup`, 'A stable product-level holdout group is required.');
    } else if (typeof raw.split === 'string') {
      const priorSplit = splitByHoldout.get(holdout);
      if (priorSplit && priorSplit !== raw.split) {
        add('holdout_leakage', `${path}.holdoutGroup`, `Holdout group ${holdout} appears in both ${priorSplit} and ${raw.split}.`);
      } else {
        splitByHoldout.set(holdout, raw.split);
      }
    }

    if (!positiveSafeInteger(raw.byteBudget) ||
        (isRecord(budget) && positiveSafeInteger(budget.maxFixtureBytes) && raw.byteBudget > budget.maxFixtureBytes) ||
        (raw.bytes !== undefined && (!positiveSafeInteger(raw.bytes) || raw.bytes > raw.byteBudget))) {
      add('invalid_byte_budget', `${path}.byteBudget`, 'Fixture bytes must be positive and fit both fixture budgets.');
    }
    if (input.lifecycle === 'frozen' && !positiveSafeInteger(raw.bytes)) {
      add('freeze_incomplete', `${path}.bytes`, 'Frozen fixtures require an observed byte count.');
    }
  });

  return issues;
}

const USAGE: CadCorpusUsagePolicyV2 = {
  storage: 'local-only',
  redistribution: 'forbidden-until-proven',
  promptExample: false,
};

type FixtureSeed = Pick<CadCorpusFixtureV2, 'fixtureId' | 'grade' | 'tier' | 'holdoutGroup'> & {
  fragments: string[];
  assertions: string[];
  duplicateGroup?: string;
};

function fixture(seed: FixtureSeed): CadCorpusFixtureV2 {
  return {
    fixtureId: seed.fixtureId,
    locator: { kind: 'path-fragments', fragments: seed.fragments },
    format: seed.fragments.at(-1)?.toLowerCase().endsWith('.stp') ? 'stp' : 'step',
    grade: seed.grade,
    tier: seed.tier,
    split: 'evaluation',
    assertions: seed.assertions,
    usage: { ...USAGE },
    duplicateGroup: seed.duplicateGroup,
    holdoutGroup: seed.holdoutGroup,
    byteBudget: 128 * 1024 * 1024,
  };
}

const A = (fixtureId: string, fragments: string[], assertions: string[], holdoutGroup: string, duplicateGroup?: string) =>
  fixture({ fixtureId, fragments, assertions, holdoutGroup, duplicateGroup, grade: 'A', tier: 'core-a' });
const B = (fixtureId: string, fragments: string[], assertions: string[], holdoutGroup: string) =>
  fixture({ fixtureId, fragments, assertions, holdoutGroup, grade: 'B', tier: 'challenge-b' });

/** Draft declarations: hashes and observed sizes are populated only by an explicit local freeze operation. */
export const CAD_CORPUS_MANIFEST_V2: CadCorpusManifestV2 = {
  schema: CAD_CORPUS_MANIFEST_V2_SCHEMA,
  lifecycle: 'draft',
  byteBudget: { maxFixtureBytes: 128 * 1024 * 1024, maxRunBytes: 1024 * 1024 * 1024 },
  fixtures: [
    A('A01', ['NIST-PMI', 'nist_stc_10_asme1_ap242-e2.stp'], ['analytic_feature', 'ap242_semantics'], 'nist-stc-10'),
    A('A02', ['single-pass-tema-ael-shell-and-tube-heat-exchanger', 'Front Head Nozzle.step'], ['revolve', 'nozzle_pattern'], 'tema-front-head'),
    A('A03', ['single-pass-tema-ael-shell-and-tube-heat-exchanger', 'Front Head.step'], ['revolve', 'flange'], 'tema-front-head'),
    A('A04', ['3d-models-of-flanged-elbows', 'Pipe Elbow 90º.step'], ['torus', 'elbow', 'flange'], 'pipe-elbow-90'),
    A('A05', ['NIST-PMI', 'nist_ftc_07_asme1_rd.stp'], ['geometry_baseline', 'pattern'], 'nist-ftc-07'),
    A('A06', ['NIST-PMI', 'nist_ftc_10_asme1_rb.stp'], ['geometry_baseline', 'pattern'], 'nist-ftc-10'),
    A('A07', ['surpass-hobby-c5055', 'Motor mount.STEP'], ['motor_interface', 'bolt_pattern'], 'c5055-motor'),
    A('A08', ['arduino-uno-sensor-shield', 'Arduino Sensor Board V1.stp'], ['plate', 'hole_pattern'], 'robot-sensor-board'),
    A('A09', ['NIST-PMI', 'nist_ftc_11_asme1_rb.stp'], ['geometry_baseline'], 'nist-ftc-11'),
    A('A10', ['NIST-PMI', 'nist_ftc_08_asme1_ap242-e2.stp'], ['ap242_semantics'], 'nist-ftc-08'),
    A('A11', ['3d-models-of-flanged-elbows', 'Pipe Elbow 180º.step'], ['sweep', 'torus'], 'pipe-elbow-180'),
    A('A12', ['18650-lipo-battery-and-holder', '18650 Lipo Battery.step'], ['analytic_enclosure'], 'robot-battery'),
    A('A13', ['NIST-PMI', 'nist_ctc_04_asme1_rd.stp'], ['geometry_baseline'], 'nist-ctc-04'),
    A('A14', ['NIST-PMI', 'nist_ftc_08_asme1_rc.stp'], ['geometry_baseline', 'ap242_pair'], 'nist-ftc-08'),
    A('A15', ['NIST-PMI', 'nist_ctc_01_asme1_ap242-e1.stp'], ['datum', 'gdt'], 'nist-ctc-01'),
    A('A16', ['semi-circular-shaft-elevator', 'st1.stp'], ['shaft', 'analytic_part'], 'elevator-st1', 'elevator-st1-similar'),
    A('A17', ['twin-panoramic-glass-elevator', 'st1.stp'], ['duplicate_geometry'], 'elevator-st1', 'elevator-st1-similar'),
    A('A18', ['surpass-hobby-c5055', 'Stator base.STEP'], ['concentricity', 'circular_pattern'], 'c5055-motor'),
    B('B01', ['NIST-PMI', 'nist_ftc_06_asme1_rd.stp'], ['complex_feature', 'geometry_baseline'], 'nist-ftc-06'),
    B('B02', ['NIST-PMI', 'nist_stc_06_asme1_ap242-e3.stp'], ['complex_feature', 'ap242_semantics'], 'nist-stc-06'),
    B('B03', ['single-pass-tema-ael-shell-and-tube-heat-exchanger', 'Shell.step'], ['shell', 'nozzle_pattern'], 'tema-shell'),
    B('B04', ['3d-models-of-flanged-elbows', 'Elbow Flange Cast 60º.step'], ['cast_boundary', 'freeform_boundary'], 'cast-elbow-60'),
    B('B05', ['asme-coded-horizontal-pressure-vessel', 'Pressure Vessel Assembly.STEP'], ['assembly_detection', 'part_boundary'], 'pressure-vessel'),
    B('B06', ['escada-caracol-spiral-staircase', 'Escada Caracol.STEP'], ['large_pattern', 'helical_placement'], 'spiral-staircase'),
    B('B07', ['single-pass-tema-ael-shell-and-tube-heat-exchanger', 'Baffle and Tube.step'], ['multi_body', 'large_pattern'], 'tema-baffle-tube'),
  ],
};
