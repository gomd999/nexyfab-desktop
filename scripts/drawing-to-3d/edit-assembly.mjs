/**
 * Stateful assembly placement repair.
 *
 * The existing assembly is the source of truth. Dimensions, part types and IDs
 * are immutable here; only `at` placement fields may change. Every candidate is
 * rebuilt by the deterministic assembly engine and is adopted only when the
 * interference count decreases without increasing the floating-part count.
 */
import { autoPlaceCorrect, buildAssembly, placedAabb } from './assembly.mjs';
import { callAiJson } from './from-text.mjs';
import { buildTurbojetConceptAssembly, legacyJetEnvelope, looksLikeLegacyJetProxy } from './jet-engine-template.mjs';

const AT_KEYS = new Set(['tx', 'ty', 'tz', 'rx', 'ry', 'rz']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function floatingCount(built) {
  return Array.isArray(built?.support?.floating) ? built.support.floating.length : 0;
}

function scoreOf(built) {
  return {
    interferences: Array.isArray(built?.interferences) ? built.interferences.length : Number.POSITIVE_INFINITY,
    floating: floatingCount(built),
  };
}

function betterThan(candidate, baseline) {
  const next = scoreOf(candidate);
  const prev = scoreOf(baseline);
  return candidate?.ok === true
    && next.interferences < prev.interferences
    && next.floating <= prev.floating;
}

function responseOf(assembly, built, before, corrections, method) {
  const remaining = built.interferences ?? [];
  return {
    ok: true,
    assembly,
    openscad: built.openscad,
    parts: built.parts ?? assembly.parts,
    contacts: built.contacts ?? [],
    interferences: remaining,
    welds: built.welds ?? [],
    weldTotalMm: built.weldTotalMm ?? 0,
    composeIntent: built.composeIntent ?? null,
    structural: built.structural ?? null,
    support: built.support ?? null,
    designOk: built.designOk ?? null,
    beforeInterferences: before,
    remainingInterferences: remaining.length,
    resolvedInterferences: Math.max(0, before - remaining.length),
    fullyResolved: remaining.length === 0,
    corrections,
    method,
  };
}

/** Strictly applies AI-proposed placement fields; geometry and identity stay immutable. */
export function applyAssemblyPlacements(assembly, placements, note = 'assembly placement repair') {
  if (!assembly || !Array.isArray(assembly.parts) || !Array.isArray(placements)) {
    return { ok: false, error: 'assembly.parts and placements[] are required' };
  }
  const byId = new Map(assembly.parts.map((part) => [String(part.id ?? ''), part]));
  const patches = new Map();
  for (const item of placements.slice(0, 240)) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id ?? '');
    if (!id || !byId.has(id) || !item.at || typeof item.at !== 'object' || Array.isArray(item.at)) continue;
    const at = {};
    for (const [key, raw] of Object.entries(item.at)) {
      if (!AT_KEYS.has(key)) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) continue;
      at[key] = value;
    }
    if (Object.keys(at).length) patches.set(id, at);
  }
  if (!patches.size) return { ok: false, error: 'no valid placement patches' };

  const next = clone(assembly);
  next.parts = next.parts.map((part) => {
    const at = patches.get(String(part.id ?? ''));
    return at ? { ...part, at: { ...(part.at ?? {}), ...at } } : part;
  });
  next.revisions = [
    ...(Array.isArray(next.revisions) ? next.revisions : []),
    { at: Date.now(), kind: 'assembly-placement-repair', target: [...patches.keys()].join(','), note: String(note).slice(0, 140) },
  ].slice(-50);
  delete next._placeCorrected;
  const built = buildAssembly(next);
  if (!built.ok) return { ok: false, error: 'gate', gateErrors: built.gateErrors ?? [], assembly: next };
  return { ok: true, assembly: next, built, applied: [...patches.keys()] };
}

/** Re-run the deterministic placement solver while it makes measurable progress. */
export function repairAssemblyDeterministic(assembly, { maxPasses = 3 } = {}) {
  let current = clone(assembly);
  let built = buildAssembly(current);
  if (!built.ok) return { ok: false, error: 'gate', gateErrors: built.gateErrors ?? [] };
  const before = scoreOf(built).interferences;
  const corrections = [];

  for (let pass = 0; pass < Math.max(1, Math.min(5, maxPasses)); pass++) {
    const source = clone(current);
    delete source._placeCorrected;
    const corrected = autoPlaceCorrect(source);
    const candidate = buildAssembly(corrected.assembly);
    if (!betterThan(candidate, built)) break;
    current = corrected.assembly;
    built = candidate;
    corrections.push(...(corrected.corrections ?? []).map((item) => ({ ...item, pass: pass + 1 })));
    if ((built.interferences ?? []).length === 0) break;
  }

  return responseOf(current, built, before, corrections, 'deterministic');
}

function compactPart(part) {
  const box = placedAabb(part);
  return {
    id: part.id,
    type: part.type,
    params: part.params,
    at: part.at ?? {},
    role: part.role ?? null,
    system: part.system ?? null,
    aabb: { min: box.min.map((v) => +v.toFixed(3)), max: box.max.map((v) => +v.toFixed(3)) },
  };
}

function compactInterference(item) {
  return {
    a: item?.a,
    b: item?.b,
    depthMm: item?.depthMm ?? item?.depth,
    overlapMm3: item?.overlapMm3,
  };
}

/**
 * AI proposes bounded placement patches, but deterministic gates decide whether
 * a proposal is safe enough to adopt. Partial improvements are returned openly.
 */
export async function repairAssemblyWithAi(assembly, instruction, { models, maxAttempts = 2 } = {}) {
  // The former free-form jet fallback has the wrong topology (primitive
  // cylinders/boxes). Placement-only repair can never turn it into blade rows
  // and an annular combustor, so upgrade it deterministically before repair.
  if (looksLikeLegacyJetProxy(assembly)) {
    const originalBuilt = buildAssembly(assembly);
    const before = Array.isArray(originalBuilt?.interferences) ? originalBuilt.interferences.length : 0;
    const upgraded = buildTurbojetConceptAssembly(legacyJetEnvelope(assembly));
    const built = buildAssembly(upgraded);
    if (!built.ok) return { ok: false, code: 'JET_TEMPLATE_UPGRADE_FAILED', error: 'Jet-engine concept geometry upgrade failed deterministic validation.', gateErrors: built.gateErrors ?? [] };
    return {
      ...responseOf(upgraded, built, before, [{ id: 'assembly', fix: 'jet-template-upgrade', pass: 1 }], 'template-upgrade'),
      code: 'LEGACY_JET_PROXY_REBUILT',
      legacyProxyRebuilt: true,
      jetEngineMeta: upgraded.jetEngineMeta,
    };
  }
  const deterministic = repairAssemblyDeterministic(assembly);
  if (!deterministic.ok) return deterministic;
  if (deterministic.fullyResolved) return deterministic;

  let current = deterministic.assembly;
  let built = buildAssembly(current);
  const originalCount = buildAssembly(assembly).interferences?.length ?? built.interferences?.length ?? 0;
  const allCorrections = [...(deterministic.corrections ?? [])];
  if (current.parts.length > 180) {
    return {
      ...responseOf(current, built, originalCount, allCorrections, 'deterministic'),
      warning: 'AI placement repair is limited to 180 parts; deterministic repair was applied.',
    };
  }

  for (let attempt = 0; attempt < Math.max(1, Math.min(3, maxAttempts)); attempt++) {
    const clashes = (built.interferences ?? []).slice(0, 320).map(compactInterference);
    const prompt = `You are repairing placement in an existing mechanical CAD assembly.
Keep every part id, type, params, material and dimensions unchanged. Change only at.tx/ty/tz/rx/ry/rz.
Return JSON only: {"placements":[{"id":"existing-id","at":{"tx":0,"ty":0,"tz":0,"rx":0,"ry":0,"rz":0}}],"note":"short reason"}.
Move the fewest parts necessary. Preserve the product's axial order, intended contacts, supports and recognizable architecture.
Do not delete, duplicate, resize, rename, or invent parts. The deterministic engine will reject any proposal that does not reduce interferences or that increases floating parts.
User instruction: ${String(instruction || 'resolve assembly interferences').slice(0, 500)}
Current confirmed interference count: ${(built.interferences ?? []).length}
Interference pairs: ${JSON.stringify(clashes)}
Parts: ${JSON.stringify(current.parts.map(compactPart))}
${attempt ? 'The previous proposal did not pass the deterministic improvement gate. Propose a different, more conservative placement set.' : ''}`;
    const out = await callAiJson(prompt, null, { models, thinkingBudget: 0, maxOutputTokens: 8192 });
    const body = out?.data ?? out;
    const placements = Array.isArray(body?.placements) ? body.placements : [];
    const applied = applyAssemblyPlacements(current, placements, body?.note ?? instruction);
    if (!applied.ok || !betterThan(applied.built, built)) continue;
    current = applied.assembly;
    built = applied.built;
    allCorrections.push(...applied.applied.map((id) => ({ id, fix: 'ai-placement', attempt: attempt + 1 })));
    if ((built.interferences ?? []).length === 0) break;
  }

  const result = responseOf(current, built, originalCount, allCorrections, allCorrections.some((c) => c.fix === 'ai-placement') ? 'deterministic+ai' : 'deterministic');
  if (result.resolvedInterferences === 0) {
    return {
      ok: false,
      code: 'NO_PLACEMENT_IMPROVEMENT',
      error: 'Automatic placement candidates did not reduce the verified interference count. Select an interfering part in 3D and specify its target position or clearance.',
      beforeInterferences: originalCount,
      remainingInterferences: result.remainingInterferences,
      interferences: result.interferences,
    };
  }
  return result;
}
