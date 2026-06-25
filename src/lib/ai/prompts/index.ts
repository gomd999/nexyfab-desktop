/**
 * Versioned prompt registry for NexyFab AI features.
 *
 * Why a registry instead of inline strings:
 *   - Single source of truth for all SYSTEM_PROMPT content.
 *   - Versioning lets us A/B test new prompts without code churn.
 *   - Telemetry can record which prompt id+version served a request.
 *   - Tests can assert prompt content without grepping route files.
 *
 * Adding a prompt:
 *   1. Drop a {id}.ts file under prompts/ exporting `default: PromptDefinition`.
 *   2. Register it in PROMPTS below.
 *   3. Call site uses `getPrompt('id')` — never inline strings.
 *
 * A/B variants:
 *   Register experimental versions with id like `{base}:variantName`.
 *   `getPromptVariant(baseId, userId?)` deterministically picks default or
 *   variant based on stable hash of userId — same user always sees same
 *   variant unless rollout fraction changes. See pickVariant() below.
 *
 *   Configure rollout per env var:
 *     AI_PROMPT_VARIANTS=shape-chat:exp-v2@0.1,scad-intent-from-nl:tighter@0.5
 *   means "10% of users see shape-chat:exp-v2, 50% see scad-intent-from-nl:tighter".
 */

import shapeChat from './shape-chat';
import scadIntentFromNl from './scad-intent-from-nl';
import scadIntentFromNlTighter from './scad-intent-from-nl.tighter';
import scadFreeform from './scad-freeform';
import cadFeatureProgram from './cad-feature-program';
import openscadGen, {
  openscadGenGenerate,
  openscadGenRefine,
  openscadGenFix,
  openscadGenFaceOp,
} from './openscad-gen';
import compose from './compose';
import intakeFromText from './intake-from-text';
import shapeToJscad from './shape-to-jscad';
import aiAdvisor from './ai-advisor';
import costCopilot from './cost-copilot';
import costCopilotTighter from './cost-copilot.tighter';
import dfmExplainer from './dfm-explainer';
import processRouter from './process-router';
import orderPriority from './order-priority';
import quoteAccuracy from './quote-accuracy';
import quoteNegotiator from './quote-negotiator';
import rfqResponder from './rfq-responder';
import capacityMatch from './capacity-match';
import certFilter from './cert-filter';
import changeDetector from './change-detector';
import imageIntentFromSketchV1 from './imageIntentFromSketch.v1';

export interface PromptDefaults {
  temperature?: number;
  maxTokens?: number;
  /** Wall-clock timeout in ms before AbortError. */
  timeoutMs?: number;
}

export interface PromptDefinition {
  id: string;
  /** Semver-ish (no enforcement). Bump when changing template content. */
  version: string;
  description: string;
  /** System prompt text — passed as a `system` ChatMessage. */
  template: string;
  /** Recommended provider knobs; callers may override. */
  defaults: PromptDefaults;
}

const PROMPTS: Record<string, PromptDefinition> = {
  [shapeChat.id]: shapeChat,
  [scadIntentFromNl.id]: scadIntentFromNl,
  [scadIntentFromNlTighter.id]: scadIntentFromNlTighter,
  [scadFreeform.id]: scadFreeform,
  [cadFeatureProgram.id]: cadFeatureProgram,
  [openscadGen.id]: openscadGen,
  [openscadGenGenerate.id]: openscadGenGenerate,
  [openscadGenRefine.id]: openscadGenRefine,
  [openscadGenFix.id]: openscadGenFix,
  [openscadGenFaceOp.id]: openscadGenFaceOp,
  [compose.id]: compose,
  [intakeFromText.id]: intakeFromText,
  [shapeToJscad.id]: shapeToJscad,
  [aiAdvisor.id]: aiAdvisor,
  [costCopilot.id]: costCopilot,
  [costCopilotTighter.id]: costCopilotTighter,
  [dfmExplainer.id]: dfmExplainer,
  [processRouter.id]: processRouter,
  [orderPriority.id]: orderPriority,
  [quoteAccuracy.id]: quoteAccuracy,
  [quoteNegotiator.id]: quoteNegotiator,
  [rfqResponder.id]: rfqResponder,
  [capacityMatch.id]: capacityMatch,
  [certFilter.id]: certFilter,
  [changeDetector.id]: changeDetector,
  [imageIntentFromSketchV1.id]: imageIntentFromSketchV1,
};

export function getPrompt(id: string): PromptDefinition {
  const found = PROMPTS[id];
  if (!found) {
    throw new Error(
      `Unknown prompt id: "${id}". Available: ${Object.keys(PROMPTS).join(', ')}`,
    );
  }
  return found;
}

export function listPromptIds(): string[] {
  return Object.keys(PROMPTS);
}

/** Test/admin helper: dump every registered prompt + version pair. */
export function dumpRegistry(): Array<{ id: string; version: string; description: string }> {
  return Object.values(PROMPTS).map((p) => ({
    id: p.id,
    version: p.version,
    description: p.description,
  }));
}

// ─── A/B variant selection ──────────────────────────────────────────────────

interface VariantRollout {
  baseId: string;
  variantId: string;
  fraction: number;  // 0..1
}

/**
 * Parse the AI_PROMPT_VARIANTS env var into rollout entries.
 * Format: `baseId:variantSuffix@fraction,...`
 *   baseId      — e.g. "shape-chat" (must exist in registry)
 *   variantSuffix — appended to baseId with ":" separator (e.g. "exp-v2"
 *                   means full id is "shape-chat:exp-v2")
 *   fraction    — number in [0,1]
 */
function parseRollouts(raw: string | undefined): VariantRollout[] {
  if (!raw) return [];
  const out: VariantRollout[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^([a-z0-9-]+):([a-zA-Z0-9_-]+)@(-?\d*\.?\d+)$/);
    if (!m) continue;
    const baseId = m[1];
    const variantSuffix = m[2];
    const fraction = Math.max(0, Math.min(1, parseFloat(m[3])));
    const variantId = `${baseId}:${variantSuffix}`;
    if (!PROMPTS[baseId] || !PROMPTS[variantId]) continue;
    out.push({ baseId, variantId, fraction });
  }
  return out;
}

/**
 * FNV-1a hash — uniform enough for A/B bucketing across small string spaces
 * (djb2 clusters badly on sequential strings like "user-1", "user-2").
 */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Resolve the prompt for a base id, possibly routing to an experimental variant
 * based on rollout config and the caller's stable identifier (userId, IP, etc).
 *
 * Order:
 *   1. If a variant is administratively disabled (`nf_disabled_variants`),
 *      always return the baseline — this is the kill switch for regressions.
 *   2. If no rollout is configured for `baseId`, return the default.
 *   3. If `stableKey` is undefined, return the default (no anonymous A/B).
 *   4. Otherwise hash the user into a bucket and return variant or baseline.
 *
 * The disabled-variants check uses a synchronous cache; if the cache is cold
 * we kick off an async refresh and route to baseline for this single call.
 * Worst-case behavior is "fall back to baseline" which is always safe.
 */
export function getPromptVariant(baseId: string, stableKey?: string): PromptDefinition {
  // Lazy import to avoid a circular dep through the AI lib barrel.
  const disabledMod = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('../disabledVariants') as typeof import('../disabledVariants');
    } catch { return null; }
  })();
  const disabled = disabledMod?.disabledVariantsCached() ?? new Set<string>();
  if (disabledMod) disabledMod.scheduleDisabledVariantsRefresh();

  const rollouts = parseRollouts(process.env.AI_PROMPT_VARIANTS);
  const candidate = rollouts.find(r => r.baseId === baseId);
  if (!candidate || !stableKey) return getPrompt(baseId);
  if (disabled.has(candidate.variantId)) return getPrompt(baseId);

  const bucket = hash(`${baseId}:${stableKey}`) / 0xffffffff;
  return bucket < candidate.fraction
    ? getPrompt(candidate.variantId)
    : getPrompt(baseId);
}

/** Test-only: parse a rollout config string without consulting env. */
export function _parseRolloutsForTests(raw: string | undefined): VariantRollout[] {
  return parseRollouts(raw);
}

/** Test-only: stable hash export. */
export function _hashForTests(input: string): number {
  return hash(input);
}
