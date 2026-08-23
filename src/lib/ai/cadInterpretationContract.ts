import { normalizeMechanicalVocabulary, type MechanicalVocabularyHit } from './mechanicalVocabulary';

/** The only intent classes allowed to cross the CAD planning boundary. */
export type CadRequestIntent = 'new_design' | 'request_only_edit' | 'clarification';
export type CadPlannerPath = 'canonical-parametric' | 'generic-parametric' | 'request-only' | 'clarification';
export type CadToolPath = 'product-planner' | 'scad' | 'assembly' | 'repair-loop' | 'clarification';

export interface CadEditScope {
  kind: 'feature' | 'part' | 'selection' | 'workspace';
  target: string;
  source: 'explicit-text' | 'selected-context';
}

export interface CadCanonicalInterpretationCandidate {
  id: string;
  intent: CadRequestIntent;
  canonicalPart?: string;
  canonicalTerms: string[];
  /** Exact substrings from the request; consumers must not rewrite these values. */
  preservedDimensions: string[];
  scope?: CadEditScope;
  plannerPath: CadPlannerPath;
  tools: CadToolPath[];
  confidence: number;
  reasons: string[];
  ambiguities: string[];
  requiresConfirmation: boolean;
  /** False whenever this candidate could mutate the wrong object or geometry. */
  mutationAllowed: boolean;
}

export const CAD_INTERPRETATION_SCHEMA = 'nexyfab.cad-interpretation.v1' as const;

export interface CadInterpretationContract {
  schema: typeof CAD_INTERPRETATION_SCHEMA;
  input: string;
  normalizedInput: string;
  intent: CadRequestIntent;
  candidates: CadCanonicalInterpretationCandidate[];
  selectedCandidateId?: string;
  preservedDimensions: string[];
  vocabularyHits: MechanicalVocabularyHit[];
  unknownVocabulary: string[];
  requiresConfirmation: boolean;
  /** User-facing question for typo/unknown/ambiguous interpretation turns. */
  confirmationPrompt?: string;
  /** A planner must treat this as a hard execution gate, not a UI hint. */
  mutationAllowed: boolean;
  audit: {
    reasonCodes: string[];
    failClosed: true;
  };
}

export interface CadInterpretationInput {
  message: string;
  /** A selected object is useful context, but textual scope is preferred. */
  selectedFeatureId?: string;
  selectedPartInstanceId?: string;
  existingDesign?: boolean;
}

type Alias = { canonical: string; category: MechanicalVocabularyHit['category']; aliases: string[]; confidence: number };

// The shared vocabulary predates this contract and contains legacy encoded aliases.
// These compact aliases cover ordinary English, Korean, spacing variants and common
// shop-floor typos without changing the shared dictionary or the user's text.
const CONTRACT_ALIASES: readonly Alias[] = [
  { canonical: 'bracket', category: 'part', aliases: ['bracket', 'braket', 'brackett', '\uBE0C\uB77C\uCF13', '\uBE0C\uB798\uCF13', '\uBE0C\uB77C\uCF13\uD2B8'], confidence: 0.96 },
  { canonical: 'plate', category: 'part', aliases: ['plate', '\uD50C\uB808\uC774\uD2B8', '\uD310\uC7AC', '\uD310'], confidence: 0.96 },
  { canonical: 'flange', category: 'part', aliases: ['flange', 'flanj', '\uD50C\uB79C\uC9C0', '\uD50C\uB80C\uC9C0'], confidence: 0.93 },
  { canonical: 'tube', category: 'part', aliases: ['tube', 'pipe', '\uD29C\uBE0C', '\uD30C\uC774\uD504', '\uAD00'], confidence: 0.93 },
  { canonical: 'casing', category: 'part', aliases: ['casing', 'housing', '\uCF00\uC774\uC2F1', '\uD558\uC6B0\uC9D5'], confidence: 0.93 },
  { canonical: 'shaft', category: 'part', aliases: ['shaft', 'shft', '\uC0E4\uD504\uD2B8', '\uCD95'], confidence: 0.95 },
  { canonical: 'blade', category: 'part', aliases: ['blade', '\uBE14\uB808\uC774\uB4DC', '\uB0A0\uAC1C'], confidence: 0.93 },
  { canonical: 'hole', category: 'feature', aliases: ['hole', 'bore', '\uAD6C\uBA4D', '\uD640'], confidence: 0.94 },
  { canonical: 'nozzle', category: 'part', aliases: ['nozzle', '\uB178\uC990'], confidence: 0.94 },
];

const COMPACT = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s_\-]+/gu, '');
const ASCII_WORD = /^[a-z0-9]+$/u;

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return (result >>> 0).toString(16).padStart(8, '0');
}

function contractVocabulary(text: string): MechanicalVocabularyHit[] {
  const compact = COMPACT(text);
  const result: MechanicalVocabularyHit[] = [];
  for (const entry of CONTRACT_ALIASES) {
    const sourceTerms = entry.aliases.filter(alias => {
      const needle = COMPACT(alias);
      if (!needle || !compact.includes(needle)) return false;
      // Single ASCII aliases (for example `hole`) need word boundaries. Compact
      // matching is intentionally used for Korean spacing and typo recovery.
      if (ASCII_WORD.test(alias)) return new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'iu').test(text);
      return true;
    });
    if (sourceTerms.length) result.push({ canonical: entry.canonical, category: entry.category, sourceTerms, confidence: entry.confidence });
  }
  return result;
}

function unique(values: readonly string[]): string[] { return [...new Set(values)]; }

function dimensions(text: string): string[] {
  const patterns = [
    /(?:\d+(?:\.\d+)?\s*(?:mm|cm|m|in|inch|deg|°))/giu,
    /(?:[Ø⌀φ]\s*\d+(?:\.\d+)?\s*(?:mm|cm|m|in|inch)?)/giu,
    /(?:\d+(?:\.\d+)?\s*(?:mm|cm|m|in|inch)?\s*[x×]\s*\d+(?:\.\d+)?\s*(?:mm|cm|m|in|inch)?(?:\s*[x×]\s*\d+(?:\.\d+)?\s*(?:mm|cm|m|in|inch)?)?)/giu,
    /(?:(?:width|depth|height|length|thickness|diameter|radius|\uAC00\uB85C|\uC138\uB85C|\uB450\uAED8|\uAE38\uC774|\uB108\uBE44|\uB192\uC774)\s*[:=]?\s*\d+(?:\.\d+)?\s*(?:mm|cm|m|in|inch)?)/giu,
  ];
  const found: Array<{ index: number; end: number; value: string }> = [];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) if (match.index !== undefined) {
    found.push({ index: match.index, end: match.index + match[0].length, value: match[0] });
  }
  // Prefer a complete expression (`50mm x 20mm`) over its overlapping scalar
  // matches. This keeps an auditable token without inventing or reformatting it.
  const selected: Array<{ index: number; end: number; value: string }> = [];
  for (const item of found.sort((a, b) => a.index - b.index || (b.end - b.index) - (a.end - a.index))) {
    if (selected.some(previous => item.index < previous.end && previous.index < item.end)) continue;
    selected.push(item);
  }
  return unique(selected.sort((a, b) => a.index - b.index).map(item => item.value.trim()));
}

const CREATE = /\b(?:create|design|make|generate|build|model|new)\b|\uC124\uACC4|\uB9CC\uB4E4|\uC0DD\uC131|\uC81C\uC791|\uBAA8\uB378\uB9C1|\uADF8\uB824/iu;
const EDIT = /\b(?:change|edit|modify|move|resize|replace|add|remove|delete|fix|update|fillet|chamfer)\b|\uBCC0\uACBD|\uC218\uC815|\uBC14\uAFB8|\uACE0\uCCD0|\uC774\uB3D9|\uB298\uB824|\uC904\uC5EC|\uCD94\uAC00|\uC0AD\uC81C|\uC81C\uAC70|\uC218\uC815\uD574/iu;
const VAGUE = /\b(?:something|anything|whatever|somehow|improve|better|refine)\b|\uC54C\uC544\uC11C|\uC801\uB2F9\uD788|\uB354\s*\uC88B\uAC8C|\uC544\uBB34\uAC70\uB098/iu;
const ALTERNATIVE = /\b(?:or|either|maybe)\b|\uB610\uB294|\uD639\uC740|\uC544\uB2C8\uBA74|\uC544\uB9C8|[/]/iu;
const ASSEMBLY = /\b(?:assembly|system|multi[- ]?part)\b|\uC870\uB9BD\uCCB4|\uC870\uB9BD|\uC2DC\uC2A4\uD15C/iu;
const EXPLICIT_SCOPE = /\b(?:feature|part|component|body|hole|face|edge)\s*(?:#|id|number|no\.?|named)?\s*[#:]?\s*[a-z0-9_-]+\b|\b(?:selected|this|the)\s+(?:feature|part|component|body|hole|face|edge)\b|\uC120\uD0DD\uD55C\s*(?:\uD53C\uCC98|\uD2B9\uC815\s*\uBD80\uD488|\uD640)|\uD53C\uCC98\s*[#:]?\s*[a-z0-9_-]+/iu;
const DEICTIC_FEATURE_SCOPE = /\b(?:selected|this|the)\s+(?:feature|hole|face|edge)\b|\uC120\uD0DD\uD55C\s*(?:\uD53C\uCC98|\uD640)/iu;
const DEICTIC_PART_SCOPE = /\b(?:selected|this|the)\s+(?:part|component|body)\b|\uC120\uD0DD\uD55C\s*\uD2B9\uC815\s*\uBD80\uD488/iu;
const TYPOS = new Set(['braket', 'brackett', 'flanj', 'shft']);

function scopeFor(input: CadInterpretationInput, text: string, vocabulary: MechanicalVocabularyHit[]): CadEditScope | undefined {
  if (DEICTIC_FEATURE_SCOPE.test(text) && input.selectedFeatureId?.trim()) {
    return { kind: 'feature', target: input.selectedFeatureId.trim(), source: 'selected-context' };
  }
  if (DEICTIC_PART_SCOPE.test(text) && input.selectedPartInstanceId?.trim()) {
    return { kind: 'part', target: input.selectedPartInstanceId.trim(), source: 'selected-context' };
  }
  const explicit = text.match(EXPLICIT_SCOPE)?.[0]?.trim();
  if (explicit && !DEICTIC_FEATURE_SCOPE.test(explicit) && !DEICTIC_PART_SCOPE.test(explicit)) {
    const target = explicit.match(/[#:]\s*([a-z0-9_-]+)\b/iu)?.[1];
    if (target) return { kind: /\b(?:part|component|body)\b/iu.test(explicit) ? 'part' : 'feature', target, source: 'explicit-text' };
  }
  const namedPart = vocabulary.find(hit => hit.category === 'part');
  if (namedPart && EDIT.test(text) && input.selectedPartInstanceId?.trim()) {
    return { kind: 'part', target: input.selectedPartInstanceId.trim(), source: 'selected-context' };
  }
  if (input.selectedFeatureId?.trim()) return { kind: 'feature', target: input.selectedFeatureId.trim(), source: 'selected-context' };
  if (input.selectedPartInstanceId?.trim()) return { kind: 'part', target: input.selectedPartInstanceId.trim(), source: 'selected-context' };
  return undefined;
}

function baseIntent(input: CadInterpretationInput, text: string): CadRequestIntent {
  if (EDIT.test(text)) return 'request_only_edit';
  if (CREATE.test(text)) return 'new_design';
  return 'clarification';
}

function candidate(input: CadInterpretationInput, intent: CadRequestIntent, part: MechanicalVocabularyHit | undefined, allVocabulary: MechanicalVocabularyHit[], preserved: string[], extraAmbiguities: string[] = []): CadCanonicalInterpretationCandidate {
  const text = input.message;
  // Existing edits are identified by exact selected scope, not by guessing a
  // product template from the noun vocabulary.
  const unknown = intent === 'new_design' && !part;
  const scope = intent === 'request_only_edit' ? scopeFor(input, text, allVocabulary) : undefined;
  const ambiguities = [...extraAmbiguities];
  const reasons: string[] = [];
  if (part) reasons.push(`recognized canonical ${part.canonical} vocabulary`);
  else if (intent === 'new_design') { reasons.push('no known template or vocabulary; use generic parametric planner'); ambiguities.push('unknown_product_or_vocabulary'); }
  if (preserved.length) reasons.push(`preserved ${preserved.length} dimension token${preserved.length === 1 ? '' : 's'}`);
  if (intent === 'request_only_edit' && !scope) { reasons.push('edit target is not explicit'); ambiguities.push('missing_explicit_edit_scope'); }
  if (intent === 'clarification') reasons.push('no unambiguous create or edit command');
  const lowConfidence = intent === 'clarification' || unknown || ambiguities.length > 0 || (intent === 'request_only_edit' && !scope);
  const confidence = intent === 'clarification' ? 0.2 : unknown ? 0.42 : ambiguities.length ? 0.58 : intent === 'request_only_edit' ? 0.84 : (part?.confidence ?? 0.8);
  return {
    id: `interpretation-${hash(`${intent}:${part?.canonical ?? 'unknown'}:${text}`)}`,
    intent,
    ...(part ? { canonicalPart: part.canonical } : {}),
    canonicalTerms: unique(allVocabulary.map(hit => hit.canonical)),
    preservedDimensions: [...preserved],
    ...(scope ? { scope } : {}),
    plannerPath: intent === 'clarification' ? 'clarification' : intent === 'request_only_edit' ? 'request-only' : unknown ? 'generic-parametric' : 'canonical-parametric',
    tools: intent === 'clarification' ? ['clarification'] : intent === 'request_only_edit' ? ['repair-loop'] : unknown ? ['product-planner', ASSEMBLY.test(text) ? 'assembly' : 'scad'] : [ASSEMBLY.test(text) ? 'assembly' : 'scad'],
    confidence,
    reasons,
    ambiguities: unique(ambiguities),
    requiresConfirmation: lowConfidence,
    mutationAllowed: !lowConfidence,
  };
}

/**
 * Deterministic, auditable pre-action contract for natural-language CAD input.
 * It never rewrites dimensions or chooses between multiple part types. A
 * caller must check `mutationAllowed` before dispatching any mutating action.
 */
export function interpretCadRequest(input: CadInterpretationInput | string): CadInterpretationContract {
  const request = typeof input === 'string' ? { message: input } : input;
  const text = request.message.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const shared = normalizeMechanicalVocabulary(request.message).hits;
  const vocabulary = [...contractVocabulary(request.message), ...shared].reduce<MechanicalVocabularyHit[]>((all, hit) => {
    const prior = all.find(item => item.canonical === hit.canonical);
    if (prior) prior.sourceTerms = unique([...prior.sourceTerms, ...hit.sourceTerms]);
    else all.push({ ...hit });
    return all;
  }, []);
  const preserved = dimensions(request.message);
  const intent = baseIntent(request, text);
  const parts = vocabulary.filter(hit => hit.category === 'part');
  const recoveredTypo = vocabulary.some(hit => hit.sourceTerms.some(term => TYPOS.has(term.toLocaleLowerCase())));
  const ambiguity = [
    ...(ALTERNATIVE.test(text) ? ['alternative_or_uncertain_language'] : []),
    ...(recoveredTypo ? ['recovered_typo_or_noncanonical_term'] : []),
  ];
  const assemblyRequest = ASSEMBLY.test(text);
  const candidates = parts.length > 1 && !assemblyRequest
    ? parts.map(part => candidate(request, intent, part, vocabulary, preserved, [...ambiguity, 'multiple_possible_part_types']))
    : [candidate(request, intent, parts[0], vocabulary, preserved, ambiguity)];
  // An explicit multi-part/assembly request is one composition, not permission
  // to relabel it as whichever part happened to sort first.
  if (assemblyRequest && parts.length > 1 && candidates[0]) {
    candidates[0].canonicalPart = undefined;
    candidates[0].reasons = unique([...candidates[0].reasons, 'multiple canonical parts retained as an assembly composition']);
  }
  if (intent === 'clarification' && VAGUE.test(text)) candidates[0]!.ambiguities.push('vague_request');
  const selected = candidates.length === 1 && candidates[0]!.mutationAllowed ? candidates[0] : undefined;
  const reasons = unique(candidates.flatMap(item => item.ambiguities));
  const unknownVocabulary = vocabulary.length ? [] : (intent === 'new_design' ? ['no-known-canonical-vocabulary'] : []);
  const proposedTerms = unique(candidates.flatMap(item => item.canonicalPart ? [item.canonicalPart] : item.canonicalTerms));
  const confirmationPrompt = !selected
    ? `Is this what you mean${proposedTerms.length ? `: ${proposedTerms.join(' or ')}` : ''}?`
    : undefined;
  return {
    schema: CAD_INTERPRETATION_SCHEMA,
    input: request.message,
    normalizedInput: text,
    intent,
    candidates,
    ...(selected ? { selectedCandidateId: selected.id } : {}),
    preservedDimensions: preserved,
    vocabularyHits: vocabulary,
    unknownVocabulary,
    requiresConfirmation: !selected,
    ...(confirmationPrompt ? { confirmationPrompt } : {}),
    mutationAllowed: Boolean(selected),
    audit: { reasonCodes: reasons.length ? reasons : ['deterministic_high_confidence_interpretation'], failClosed: true },
  };
}

/** Named alias for callers that prefer the contract terminology. */
export const buildCadInterpretationContract = interpretCadRequest;
