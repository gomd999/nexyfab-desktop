/**
 * brief-expander/expandBrief — clarify to structured PRE-PASS.
 *
 * A rough one-liner in, a `StructuredBrief` out. The LLM proposes STRUCTURE
 * (components + params) and a source PROPOSAL; this module is the deterministic
 * SECURITY BOUNDARY that decides every final `source` label, so the model can
 * never smuggle a fabricated number through as fact (mirrors the coerce+
 * preflight discipline of design-driver/llmPlanner).
 *
 * Grounding rules (code is the arbiter — never trusts the model's label):
 *   - proposed "given":       kept ONLY if the exact value is found in the raw
 *                             user text (digit-boundary match / substring).
 *                             Otherwise DOWNGRADED to needs_input (value null) —
 *                             확신 없는 필드는 null, never a fabricated fact.
 *   - proposed "assumption":  must carry a `note` (basis) AND a value, else
 *                             downgraded to needs_input. If its value turns out
 *                             to be present in the text, PROMOTED to given.
 *   - proposed "needs_input": value forced to null.
 *
 * The only external dependency is an injected `complete(messages)` so tests run
 * deterministically (no live LLM, no cost). The production binding uses the
 * shared provider chain via chatCompletion.
 */

import { chatCompletion, type ChatMessage } from '@/lib/ai';
import briefExpanderPrompt from '@/lib/ai/prompts/brief-expander';
import {
  BRIEF_DOMAINS,
  type BriefComponent,
  type BriefDomain,
  type BriefParam,
  type ParamSource,
  type PlannerBrief,
  type StructuredBrief,
} from './types';

export class BriefExpanderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BriefExpanderError';
  }
}

// primitives

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asDomain(v: unknown): BriefDomain | null {
  return typeof v === 'string' && (BRIEF_DOMAINS as readonly string[]).includes(v)
    ? (v as BriefDomain)
    : null;
}

/** Markdown-fence-tolerant JSON extraction (mirrors scad-intent-from-nl). */
function extractJson(raw: string): unknown {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new BriefExpanderError('brief expander returned an empty response');
  }
  const stripped = raw.replace(/```json?\s*/gi, '').replace(/```/g, '');
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first === -1 || last <= first) {
    throw new BriefExpanderError('brief expander response contains no JSON object');
  }
  try {
    return JSON.parse(stripped.slice(first, last + 1).trim());
  } catch {
    throw new BriefExpanderError('brief expander response is not valid JSON');
  }
}

// grounding: is a value traceable to the user's own text?

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True iff `value` can be traced to the raw user text.
 *   - number: the digit string appears NOT embedded in a larger number
 *     (so 5 does not match inside 500, and 3 does not match inside 3.5).
 *   - string: a non-empty case-insensitive substring match.
 */
export function textHasValue(rawText: string, value: number | string): boolean {
  const rawLower = rawText.toLowerCase();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false;
    const rawNum = rawLower.replace(/,/g, '');
    const s = String(value);
    const re = new RegExp(`(?<![0-9.])${escapeRegex(s)}(?![0-9.])`);
    return re.test(rawNum);
  }
  const v = value.trim().toLowerCase();
  return v.length > 0 && rawLower.includes(v);
}

// coerce a single proposed param, then re-label its source

function coerceParam(v: unknown, rawText: string): BriefParam | null {
  if (!isObj(v)) return null;
  const key = typeof v.key === 'string' ? v.key.trim() : '';
  if (!key) return null; // drop hallucinated / keyless fields

  const unit = typeof v.unit === 'string' && v.unit.trim().length > 0 ? v.unit.trim() : null;
  const note = typeof v.note === 'string' && v.note.trim().length > 0 ? v.note.trim() : undefined;
  const rawValue: number | string | null =
    typeof v.value === 'number' && Number.isFinite(v.value) ? v.value
    : typeof v.value === 'string' && v.value.trim().length > 0 ? v.value.trim()
    : null;
  const proposed: ParamSource =
    v.source === 'given' || v.source === 'assumption' || v.source === 'needs_input'
      ? v.source
      : 'needs_input';

  const needsInput = (n?: string): BriefParam => ({
    key, value: null, unit, source: 'needs_input',
    ...((n ?? note) ? { note: n ?? note } : {}),
  });

  // needs_input: value is always null.
  if (proposed === 'needs_input' || rawValue === null) {
    return needsInput();
  }

  const grounded = textHasValue(rawText, rawValue);

  if (proposed === 'given') {
    // A "given" that is NOT in the text is an unverifiable claim, so refuse the
    // number rather than present a fabricated fact.
    if (grounded) return { key, value: rawValue, unit, source: 'given', ...(note ? { note } : {}) };
    return needsInput(note ?? '사용자가 입력한 값인지 확인이 필요합니다.');
  }

  // proposed === 'assumption'
  // An assumption with no stated basis is an unlabeled guess -> needs_input.
  if (!note) return needsInput('근거가 없는 값입니다 — 사용자 확인이 필요합니다.');
  // If the "assumption" value is actually present in the text, it was really
  // given; promote it so it becomes an authoritative planner param.
  if (grounded) return { key, value: rawValue, unit, source: 'given', note };
  return { key, value: rawValue, unit, source: 'assumption', note };
}

function coerceComponent(v: unknown, rawText: string): BriefComponent | null {
  if (!isObj(v)) return null;
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!name) return null;
  const paramsRaw = Array.isArray(v.params) ? v.params : [];
  const params = paramsRaw
    .map((p) => coerceParam(p, rawText))
    .filter((p): p is BriefParam => p !== null);
  return { name, params };
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const t = s.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// ground the whole model output into a StructuredBrief

export function groundBrief(
  parsed: unknown,
  rawText: string,
  domainOverride?: BriefDomain,
): StructuredBrief {
  if (!isObj(parsed)) {
    throw new BriefExpanderError('brief expander output is not a JSON object');
  }

  const componentsRaw = Array.isArray(parsed.components) ? parsed.components : [];
  const components = componentsRaw
    .map((c) => coerceComponent(c, rawText))
    .filter((c): c is BriefComponent => c !== null);

  const title =
    typeof parsed.title === 'string' && parsed.title.trim().length > 0
      ? parsed.title.trim()
      : rawText.trim().slice(0, 60) || 'Untitled brief';

  const domain = domainOverride ?? asDomain(parsed.domain) ?? 'generic';

  // Questions: model-provided + one per needs_input param (its note is the
  // question, or a synthesised fallback).
  const modelQuestions = Array.isArray(parsed.questions)
    ? parsed.questions.filter((q): q is string => typeof q === 'string')
    : [];
  const paramQuestions: string[] = [];
  const assumptionLines: string[] = [];
  for (const c of components) {
    for (const p of c.params) {
      if (p.source === 'needs_input') {
        paramQuestions.push(p.note ?? `${c.name} — '${p.key}' 값이 필요합니다.`);
      } else if (p.source === 'assumption') {
        const val = `${p.value}${p.unit ?? ''}`;
        assumptionLines.push(`${c.name}.${p.key} = ${val} (가정: ${p.note ?? '기본값'})`);
      }
    }
  }
  const questions = uniq([...modelQuestions, ...paramQuestions]);

  const modelAssumptions = Array.isArray(parsed.assumptions)
    ? parsed.assumptions.filter((a): a is string => typeof a === 'string')
    : [];
  const assumptions = uniq([...assumptionLines, ...modelAssumptions]);

  return { title, domain, components, questions, assumptions, raw: rawText };
}

// planner adapter — the new FRONT of the existing pipeline

/**
 * Reshape a `StructuredBrief` into the { id, text, params } form every
 * downstream planner already consumes (design-driver `DesignBrief`, civil/
 * interior/... briefs). Only `given` params become authoritative `params`;
 * assumptions ride along in `text` with a 가정 label so a downstream planner
 * never mistakes a default for a hard fact, and open questions are listed so a
 * planner that requires them REFUSES honestly instead of inventing them.
 */
export function toPlannerBrief(brief: StructuredBrief, id = 'brief'): PlannerBrief {
  const params: Record<string, number | string> = {};
  const lines: string[] = [brief.title];

  for (const c of brief.components) {
    const given = c.params.filter((p) => p.source === 'given' && p.value !== null);
    const assumed = c.params.filter((p) => p.source === 'assumption' && p.value !== null);
    const asks = c.params.filter((p) => p.source === 'needs_input');

    const givenStr = given.map((p) => `${p.key}=${p.value}${p.unit ?? ''}`).join(', ');
    lines.push(`- ${c.name}${givenStr ? `: ${givenStr}` : ''}`);
    if (assumed.length) {
      lines.push(`  (가정/assumption: ${assumed.map((p) => `${p.key}=${p.value}${p.unit ?? ''}`).join(', ')})`);
    }
    if (asks.length) {
      lines.push(`  (미정/needs input: ${asks.map((p) => p.key).join(', ')})`);
    }
    for (const p of given) {
      if (p.value !== null) params[`${c.name}.${p.key}`] = p.value;
    }
  }

  return { id, text: lines.join('\n'), params };
}

// message construction

function buildMessages(rawText: string, systemPrompt: string, domain?: BriefDomain): ChatMessage[] {
  const hint = domain && domain !== 'generic' ? `\n\n[The user is working in the "${domain}" domain.]` : '';
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: rawText.trim() + hint },
  ];
}

// the expander

export interface ExpandBriefOptions {
  /** Domain override — wins over the model's own classification. */
  domain?: BriefDomain;
  /** Injected completion (brief messages in, raw model text out). Tests pass a
   *  deterministic mock; omit in production to use the shared provider chain. */
  complete?: (messages: ChatMessage[]) => Promise<string>;
  /** Override the system prompt (default = the registered brief-expander prompt). */
  systemPrompt?: string;
}

/**
 * Expand a rough one-liner into a grounded `StructuredBrief`.
 * Throws `BriefExpanderError` for empty/non-JSON model output.
 */
export async function expandBrief(rawText: string, opts: ExpandBriefOptions = {}): Promise<StructuredBrief> {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text) throw new BriefExpanderError('rawText is required');

  const systemPrompt = opts.systemPrompt ?? briefExpanderPrompt.template;
  const complete =
    opts.complete ??
    (async (messages: ChatMessage[]) => {
      const res = await chatCompletion({
        messages,
        temperature: briefExpanderPrompt.defaults.temperature ?? 0.1,
        maxTokens: briefExpanderPrompt.defaults.maxTokens ?? 1500,
        timeoutMs: briefExpanderPrompt.defaults.timeoutMs ?? 30_000,
        task: 'brief-expander',
      });
      return res.text;
    });

  const raw = await complete(buildMessages(text, systemPrompt, opts.domain));
  const parsed = extractJson(raw);
  return groundBrief(parsed, text, opts.domain);
}