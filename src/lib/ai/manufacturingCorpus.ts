import type { ManufacturingReadinessLevel } from './manufacturingReadiness';

export type CorpusSource =
  | 'customer_failure'
  | 'internal_dogfood'
  | 'manual_derived'
  | 'synthetic'
  | 'standard_corpus';

export type CorpusInputKind =
  | 'text'
  | 'drawing_image'
  | 'dxf'
  | 'photo_sketch'
  | 'step';

export type CorpusProductFamily =
  | 'plate'
  | 'bracket'
  | 'cover'
  | 'housing'
  | 'shaft_bushing'
  | 'pipe_flange'
  | 'sheet_metal'
  | 'simple_assembly'
  | 'freeform';

export type CorpusExpectedOutcome = ManufacturingReadinessLevel | 'refuse';

export type ManufacturingGate =
  | 'intent_complete'
  | 'dimensions_resolved'
  | 'analytic_brep'
  | 'closed_solid'
  | 'feature_fidelity'
  | 'step_roundtrip'
  | 'dfm_review'
  | 'assembly_clearance';

export interface ManufacturingCorpusCase {
  id: string;
  title: string;
  source: CorpusSource;
  sourceReference: string;
  inputKind: CorpusInputKind;
  productFamily: CorpusProductFamily;
  /** Redacted test input or an internal/synthetic prompt. Never put customer design IP here. */
  testInput?: string;
  inputHash?: string;
  rawInputRetained: boolean;
  consentReference?: string;
  expectedOutcome: CorpusExpectedOutcome;
  requiredGates: ManufacturingGate[];
  repeatCount: number;
  tags: string[];
}

export interface CorpusValidationIssue {
  caseId: string;
  field: keyof ManufacturingCorpusCase | 'case';
  message: string;
}

const HASH_PATTERN = /^[a-f0-9]{16,64}$/i;

export function validateManufacturingCorpusCase(
  corpusCase: ManufacturingCorpusCase,
): CorpusValidationIssue[] {
  const issues: CorpusValidationIssue[] = [];
  const add = (field: CorpusValidationIssue['field'], message: string) => {
    issues.push({ caseId: corpusCase.id || '(missing)', field, message });
  };

  if (!corpusCase.id.trim()) add('id', 'A stable case id is required.');
  if (!corpusCase.sourceReference.trim()) {
    add('sourceReference', 'A traceable source reference is required.');
  }
  if (corpusCase.repeatCount < 5) {
    add('repeatCount', 'AI-dependent cases must run at least five times.');
  }
  if (corpusCase.requiredGates.length === 0) {
    add('requiredGates', 'At least one objective gate is required.');
  }
  if (new Set(corpusCase.requiredGates).size !== corpusCase.requiredGates.length) {
    add('requiredGates', 'Required gates must not contain duplicates.');
  }

  if (corpusCase.source === 'customer_failure') {
    if (!corpusCase.inputHash || !HASH_PATTERN.test(corpusCase.inputHash)) {
      add('inputHash', 'Customer failures require a non-reversible input hash.');
    }
    if (corpusCase.rawInputRetained && !corpusCase.consentReference?.trim()) {
      add('consentReference', 'Retaining customer input requires an explicit consent reference.');
    }
    if (corpusCase.testInput && corpusCase.rawInputRetained === false) {
      add('testInput', 'A customer case without retention consent may not contain raw test input.');
    }
  }

  if (corpusCase.expectedOutcome === 'verified') {
    for (const gate of ['analytic_brep', 'closed_solid', 'feature_fidelity', 'step_roundtrip'] as const) {
      if (!corpusCase.requiredGates.includes(gate)) {
        add('requiredGates', `Verified cases must require ${gate}.`);
      }
    }
  }

  if (corpusCase.productFamily === 'freeform' && corpusCase.expectedOutcome === 'verified') {
    add('expectedOutcome', 'Free-form generation is not in the verified manufacturing scope.');
  }

  return issues;
}

export function validateManufacturingCorpus(
  cases: ManufacturingCorpusCase[],
): CorpusValidationIssue[] {
  const issues = cases.flatMap(validateManufacturingCorpusCase);
  const seen = new Set<string>();
  for (const corpusCase of cases) {
    if (seen.has(corpusCase.id)) {
      issues.push({ caseId: corpusCase.id, field: 'id', message: 'Case ids must be unique.' });
    }
    seen.add(corpusCase.id);
  }
  return issues;
}

export function summarizeCorpusSources(cases: ManufacturingCorpusCase[]): Record<CorpusSource, number> {
  const summary: Record<CorpusSource, number> = {
    customer_failure: 0,
    internal_dogfood: 0,
    manual_derived: 0,
    synthetic: 0,
    standard_corpus: 0,
  };
  for (const corpusCase of cases) summary[corpusCase.source]++;
  return summary;
}

const VERIFIED_GATES: ManufacturingGate[] = [
  'intent_complete',
  'dimensions_resolved',
  'analytic_brep',
  'closed_solid',
  'feature_fidelity',
  'step_roundtrip',
  'dfm_review',
];

/** Initial baseline only. These are not represented as customer data. */
export const MANUFACTURING_CORPUS_V1: ManufacturingCorpusCase[] = [
  {
    id: 'text-l-bracket-001', title: 'Dimensioned L bracket', source: 'synthetic',
    sourceReference: 'src/lib/ai/scad-agent/evalIntentAccuracy.ts#lbracket-shelf',
    inputKind: 'text', productFamily: 'bracket',
    testInput: 'An L-bracket 50x50x30mm, 4mm thick', rawInputRetained: true,
    expectedOutcome: 'verified', requiredGates: VERIFIED_GATES, repeatCount: 5,
    tags: ['ko-en', 'extrude', 'dimensions'],
  },
  {
    id: 'text-flange-001', title: 'Flange with bolt pattern', source: 'synthetic',
    sourceReference: 'src/lib/ai/scad-agent/evalIntentAccuracy.ts#flange-bolt-pattern',
    inputKind: 'text', productFamily: 'pipe_flange',
    testInput: 'A 100mm OD flange with 4 bolt holes on a 70mm pitch circle', rawInputRetained: true,
    expectedOutcome: 'verified', requiredGates: VERIFIED_GATES, repeatCount: 5,
    tags: ['bolt-pattern', 'pcd', 'holes'],
  },
  {
    id: 'text-plate-holes-001', title: 'Plate with corner mounting holes', source: 'synthetic',
    sourceReference: 'src/lib/ai/__evals__/scad-intent-evalset.ts#en_box_pattern_holes',
    inputKind: 'text', productFamily: 'plate',
    testInput: '60x60x10 plate with 4 mounting holes 4mm dia at corners', rawInputRetained: true,
    expectedOutcome: 'verified', requiredGates: VERIFIED_GATES, repeatCount: 5,
    tags: ['pattern', 'holes', 'position'],
  },
  {
    id: 'text-enclosure-001', title: 'Thin-wall electronics enclosure', source: 'synthetic',
    sourceReference: 'src/lib/ai/__evals__/scad-intent-evalset.ts#ko_enclosure',
    inputKind: 'text', productFamily: 'housing',
    testInput: '120x80x40 electronics enclosure, 2mm wall thickness', rawInputRetained: true,
    expectedOutcome: 'review_required',
    requiredGates: ['intent_complete', 'dimensions_resolved', 'analytic_brep', 'closed_solid', 'dfm_review'],
    repeatCount: 5, tags: ['shell', 'wall-thickness'],
  },
  {
    id: 'drawing-dxf-001', title: 'DXF profile feature capture', source: 'internal_dogfood',
    sourceReference: 'scripts/drawing-to-3d/golden', inputKind: 'dxf', productFamily: 'plate',
    rawInputRetained: true, expectedOutcome: 'review_required',
    requiredGates: ['dimensions_resolved', 'analytic_brep', 'closed_solid', 'feature_fidelity', 'step_roundtrip'],
    repeatCount: 5, tags: ['dxf', 'profile', 'capture-coverage'],
  },
  {
    id: 'photo-no-scale-001', title: 'Single photo without scale', source: 'internal_dogfood',
    sourceReference: 'docs/ai-path-measurement-260731.md#photo-sketch',
    inputKind: 'photo_sketch', productFamily: 'freeform', rawInputRetained: true,
    expectedOutcome: 'concept_only', requiredGates: ['intent_complete', 'dimensions_resolved'],
    repeatCount: 5, tags: ['missing-scale', 'ambiguity'],
  },
  {
    id: 'text-organic-shape-001', title: 'Organic free-form request', source: 'synthetic',
    sourceReference: 'sales-scope negative-control v1', inputKind: 'text', productFamily: 'freeform',
    testInput: 'Create an ergonomic sculpted handle from this description only', rawInputRetained: true,
    expectedOutcome: 'concept_only', requiredGates: ['intent_complete'], repeatCount: 5,
    tags: ['negative-control', 'freeform'],
  },
  {
    id: 'text-missing-dimensions-001', title: 'Manufacturing request with no dimensions', source: 'synthetic',
    sourceReference: 'sales-scope negative-control v1', inputKind: 'text', productFamily: 'bracket',
    testInput: 'Make a strong mounting bracket for a motor', rawInputRetained: true,
    expectedOutcome: 'review_required', requiredGates: ['intent_complete', 'dimensions_resolved'],
    repeatCount: 5, tags: ['negative-control', 'clarification-required'],
  },
];
