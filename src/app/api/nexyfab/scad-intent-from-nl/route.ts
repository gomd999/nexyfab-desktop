/**
 * POST /api/nexyfab/scad-intent-from-nl
 *
 * Pipeline: NL → AI emits JSON intent → deterministic intentToScad → SCAD source.
 *
 * Why this shape:
 *   - AI never writes raw OpenSCAD code → ~0% syntax-error rate.
 *   - AI only picks shapeId from a fixed whitelist + numeric params + known features.
 *   - Same JSON intent always produces the same SCAD/STL → reproducible & cacheable.
 *
 * Caller flow: send { prompt }, receive { intent, scad, warnings }. Push `scad` into
 * the textarea or directly into POST /api/nexyfab/openscad-render to get an STL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan, consumeMonthlyMetricSlot } from '@/lib/plan-guard';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { chatCompletion, AiNotConfiguredError, AiProviderError, type ChatMessage } from '@/lib/ai';
import { resolveCodegenModel } from '@/lib/ai/codegenModels';
import { visionCompletion, VisionNotConfiguredError, VisionProviderError } from '@/lib/ai/vision';
import { getPromptVariant } from '@/lib/ai/prompts';
import { recordPromptCall, classifyAiError } from '@/lib/ai/telemetry';
import { checkUserBudget } from '@/lib/ai/userBudget';
import {
  intentToScad,
  assemblyToScad,
  SUPPORTED_SHAPES as SUPPORTED_SHAPES_SET,
  SUPPORTED_FEATURES as SUPPORTED_FEATURES_SET,
  type IntentInput,
  type IntentFeature,
  type AssemblyPartInput,
} from '@/lib/openscad-render/intentToScad';
import { detectShapeFromText } from '@/lib/openscad-render/shapeAliases';
import { getCachedIntent, setCachedIntent } from '@/lib/ai/intentCache';
import { captureServerError } from '@/lib/error-capture';

export const dynamic = 'force-dynamic';

// Single-sourced from intentToScad so the runtime whitelist can never reject a
// shape the converter actually supports (nor accept one it doesn't).
const SUPPORTED_SHAPES: readonly string[] = [...SUPPORTED_SHAPES_SET];
const SUPPORTED_FEATURES: readonly string[] = [...SUPPORTED_FEATURES_SET];

function numParams(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
    }
  }
  return out;
}

function parseFeatures(v: unknown): IntentFeature[] {
  const allowed = new Set<string>(SUPPORTED_FEATURES);
  if (!Array.isArray(v)) return [];
  return v.filter((f): f is IntentFeature => {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
    const t = (f as Record<string, unknown>).type;
    return typeof t === 'string' && allowed.has(t);
  });
}

function parseProfile(v: unknown): Array<{ x: number; y: number }> {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p): p is { x: number; y: number } =>
      !!p && typeof p === 'object' &&
      typeof (p as Record<string, unknown>).x === 'number' && Number.isFinite((p as Record<string, unknown>).x as number) &&
      typeof (p as Record<string, unknown>).y === 'number' && Number.isFinite((p as Record<string, unknown>).y as number))
    .map((p) => ({ x: p.x, y: p.y }));
}

function vec3(v: unknown): [number, number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 3) return undefined;
  if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  return [v[0] as number, v[1] as number, v[2] as number];
}

/** Parse + whitelist-validate an assembly's parts list from LLM output. */
function parseAssemblyParts(v: unknown): AssemblyPartInput[] {
  if (!Array.isArray(v)) return [];
  const allowed = new Set<string>([...SUPPORTED_SHAPES, 'sketch']);
  const out: AssemblyPartInput[] = [];
  for (const p of v) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    const o = p as Record<string, unknown>;
    if (typeof o.shapeId !== 'string' || !allowed.has(o.shapeId)) continue;
    const part: AssemblyPartInput = {
      shapeId: o.shapeId,
      params: numParams(o.params),
      features: parseFeatures(o.features),
    };
    if (typeof o.name === 'string') part.name = o.name;
    if (o.shapeId === 'sketch') {
      const pr = parseProfile(o.profile);
      if (pr.length >= 3) part.profile = pr;
    }
    const pos = vec3(o.position);
    if (pos) part.position = pos;
    const rot = vec3(o.rotation);
    if (rot) part.rotation = rot;
    out.push(part);
  }
  return out;
}

export async function POST(req: NextRequest) {
  const planCheck = await checkPlan(req, 'free');
  const userPlan = planCheck.ok ? planCheck.plan : 'free';

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const hasImageInput = typeof body.image === 'string' && body.image.length > 0;
  if (!prompt && !hasImageInput) {
    return NextResponse.json({ error: 'prompt or image is required' }, { status: 400 });
  }
  if (prompt.length > 4000) {
    return NextResponse.json({ error: 'prompt too long (max 4000 chars)' }, { status: 413 });
  }

  // Refine mode: the client passes the previously-generated intent so the
  // prompt is treated as a MODIFICATION ("make it taller", "add a hole",
  // "remove a leg"). Contextual → not cacheable by prompt alone.
  const previousIntent = body.previousIntent && typeof body.previousIntent === 'object' && !Array.isArray(body.previousIntent)
    ? body.previousIntent as Record<string, unknown>
    : undefined;
  const refining = !!previousIntent;

  // Image-to-3D: a reference image (base64, optional data-URL prefix). When
  // present we read it with a vision model and write parametric OpenSCAD from
  // it — image GUIDES code generation (clean, truly parametric), NOT image→
  // B-rep. An image always implies free-form.
  const imageB64 = typeof body.image === 'string' && body.image.length > 0
    ? body.image.replace(/^data:image\/\w+;base64,/, '')
    : null;
  const hasImage = !!imageB64;

  // Free-form mode (CADAM-style): the model writes a COMPLETE OpenSCAD program
  // (arbitrary modules/CSG/BOSL2) instead of a whitelist intent — so organic
  // models like a car work. Returns raw .scad; the client parses Customizer
  // annotations for sliders. Not cached (large, iterated).
  const freeform = body.freeform === true || hasImage;
  // User-selected codegen model (Studio model picker) → preferred provider +
  // model, validated against the allowlist (never trust raw provider/model).
  const codegen = resolveCodegenModel(typeof body.modelId === 'string' ? body.modelId : undefined);
  // Free-form chat iteration: the prior OpenSCAD program to modify in place
  // ("make it taller", "add a hole") instead of starting fresh.
  const previousScad = typeof body.previousScad === 'string' && body.previousScad.trim().length > 0
    ? body.previousScad
    : null;
  // Self-repair: the client is feeding a render error back to fix an already-
  // generated design. This is not a NEW design, so it must not burn the guest
  // freebie (it carries previousScad and is rate-limited by the general gate).
  const isRepair = body.repair === true && !!previousScad;

  // Cache lookup — same prompt → same intent → same SCAD. A hit avoids the
  // paid AI round-trip AND does NOT consume a monthly quota slot, which is
  // intentional: we're only metering work that actually costs us money.
  const cached = (refining || freeform) ? null : await getCachedIntent(prompt);
  if (cached) {
    return NextResponse.json({
      intent: cached.intent,
      scad: cached.scad,
      warnings: cached.warnings,
      summary: cached.summary,
      cached: true,
    });
  }

  // Per-user $ budget gate fires first — same as shape-chat.
  // Surfaced to the client so the lay AI front door can show a gentle
  // "N free generations left this month" nudge before the hard cap.
  let usage: { used: number; limit: number; remaining: number } | undefined;
  if (planCheck.ok) {
    const budget = await checkUserBudget(planCheck.userId);
    if (!budget.ok) {
      return NextResponse.json(
        {
          error: `Daily AI spend limit reached ($${budget.limitUsd}). Try again later.`,
          code: 'COST_BUDGET',
          usedCents: budget.usedCents,
          limitUsd: budget.limitUsd,
          resetAtMs: budget.resetAtMs,
        },
        { status: 402 },
      );
    }
    const slot = await consumeMonthlyMetricSlot(planCheck.userId, userPlan, 'shape_chat');
    if (!slot.ok) {
      return NextResponse.json(
        { error: `Free plan limit reached (${slot.limit}/month).`, code: 'MONTHLY_LIMIT', limit: slot.limit },
        { status: 429 },
      );
    }
    // limit === -1 means unlimited (paid plans) — leave usage undefined there.
    if (slot.limit > 0) {
      usage = { used: slot.used, limit: slot.limit, remaining: Math.max(0, slot.limit - slot.used) };
    }
  }

  const promptDef = getPromptVariant(freeform ? 'scad-freeform' : 'scad-intent-from-nl', planCheck.ok ? planCheck.userId : undefined);

  // Deterministic shape detection from the multilingual glossary. The LLM is
  // unreliable at picking the shapeId for non-English shape words (DeepSeek
  // returns different answers by request region even at temperature 0), but it
  // extracts params correctly once the shape is known. So when the glossary
  // identifies the shape unambiguously, we pin it in the prompt (and enforce it
  // post-parse) — origin-independent and deterministic.
  const detectedShape = (refining || freeform) ? null : detectShapeFromText(prompt);
  const userContent = freeform
    ? (previousScad
      ? `Here is the current OpenSCAD program:\n\`\`\`\n${previousScad}\n\`\`\`\n\nApply this change and return the COMPLETE updated program, following ALL the rules above (keep the Customizer parameter annotations and groups; keep parts not mentioned unchanged): ${prompt}`
      : prompt)
    : refining
    ? `Modify this existing design and return the COMPLETE updated intent in the SAME JSON format (catalog shape, "sketch", or assembly "parts"). Keep everything not mentioned unchanged.\n\nCurrent design:\n${JSON.stringify(previousIntent)}\n\nChange requested: ${prompt}`
    : (detectedShape
      ? `${prompt}\n\n[The shape is "${detectedShape}". Set shapeId to exactly "${detectedShape}" and extract that shape's params from the request.]`
      : prompt);
  const messages: ChatMessage[] = [
    { role: 'system', content: promptDef.template },
    { role: 'user', content: userContent },
  ];

  // Guest funnel: anonymous users get 1 free design/day. After that they must
  // log in (free). Logged-in users are metered by their plan budget/quota
  // above. Placed after the cache return so a cache hit doesn't burn the freebie.
  if (!planCheck.ok && !isRepair) {
    const guestIp = getTrustedClientIp(req.headers);
    const guestRl = rateLimit(`scad-gen-guest:${guestIp}`, 3, 24 * 3_600_000);
    if (!guestRl.allowed) {
      return NextResponse.json(
        { error: 'Free design used — log in (free) to keep designing.', code: 'GUEST_LIMIT' },
        { status: 401 },
      );
    }
  }

  let raw = '';
  const used: { provider?: string; model?: string } = {};
  try {
    let meta: { provider: string; model: string; latencyMs: number; promptTokens?: number; completionTokens?: number };
    if (hasImage && imageB64) {
      // Image-to-3D HYBRID: the vision model PERCEIVES the object (describe
      // only), then DeepSeek writes the parametric OpenSCAD from that
      // description — the same proven free-form code path as text-to-3D. This
      // yields richer, more consistent parametric output than asking the vision
      // model to also write the code (it's better at seeing than at coding).
      const bytes = Uint8Array.from(Buffer.from(imageB64, 'base64'));
      const describePrompt = `You are analysing a photo or sketch of a physical object for CAD modelling. Describe ONLY what you see — structured and concise, NO code:
- Object category / overall shape
- Distinct parts and how they connect
- Approximate proportions and real-world dimensions in millimetres (estimate)
- Notable features: holes, fillets/rounded edges, ribs, symmetry, embossed text
${prompt ? 'User note: ' + prompt : ''}`;
      const v = await visionCompletion({
        prompt: describePrompt,
        images: [{ bytes }],
        maxTokens: 700,
        timeoutMs: 40_000,
      });
      const description = v.text.trim();
      const codeResult = await chatCompletion({
        messages: [
          { role: 'system', content: promptDef.template },
          { role: 'user', content: `${prompt ? prompt + '\n\n' : ''}Model the object described below as a parametric OpenSCAD program following ALL the rules above. The description came from a photo — estimate sensible millimetre dimensions.\n\nObject description:\n${description}` },
        ],
        // Free-form geometry quality is much better from a strong spatial model.
        // Route to the user-picked model (default Gemini), with the normal chain
        // as fallback when that provider isn't configured/healthy.
        preferProvider: codegen.preferProvider,
        model: codegen.model,
        maxTokens: 8000,
        temperature: promptDef.defaults.temperature,
        timeoutMs: 180_000,
        task: promptDef.id,
      });
      raw = codeResult.text;
      meta = {
        provider: `${v.provider}+${codeResult.provider}`,
        model: `${v.model}+${codeResult.model}`,
        latencyMs: v.latencyMs + codeResult.latencyMs,
        promptTokens: (v.promptTokens ?? 0) + (codeResult.promptTokens ?? 0),
        completionTokens: (v.completionTokens ?? 0) + (codeResult.completionTokens ?? 0),
      };
    } else {
      const result = await chatCompletion({
        messages,
        // Free-form geometry: route to the user-picked model (default Gemini),
        // fall back via the normal chain. Whitelist path keeps the cheap chat model.
        ...(freeform ? { preferProvider: codegen.preferProvider, model: codegen.model } : {}),
        maxTokens: freeform ? 8000 : promptDef.defaults.maxTokens,
        temperature: promptDef.defaults.temperature,
        timeoutMs: freeform ? 180_000 : promptDef.defaults.timeoutMs,
        task: promptDef.id,
      });
      raw = result.text;
      meta = { provider: result.provider, model: result.model, latencyMs: result.latencyMs, promptTokens: result.promptTokens, completionTokens: result.completionTokens };
    }
    recordPromptCall({
      userId: planCheck.ok ? planCheck.userId : undefined,
      promptId: promptDef.id,
      promptVersion: promptDef.version,
      provider: meta.provider,
      model: meta.model,
      latencyMs: meta.latencyMs,
      promptTokens: meta.promptTokens,
      completionTokens: meta.completionTokens,
      success: true,
    });
    used.provider = meta.provider;
    used.model = meta.model;
  } catch (e) {
    if (e instanceof VisionNotConfiguredError) {
      return NextResponse.json({ error: 'No vision provider configured for image input' }, { status: 500 });
    }
    if (e instanceof VisionProviderError) {
      console.error('scad-intent-from-nl vision error:', e.message);
      const busy = e.status === 429 || e.status === 503 || /high demand|overload|unavailable|try again|temporarily|rate.?limit/i.test(e.message);
      return NextResponse.json(
        { error: busy ? 'Image analysis is busy right now — please try again in a moment.' : 'Image understanding failed', code: busy ? 'VISION_BUSY' : 'VISION_FAILED' },
        { status: busy ? 503 : 502 },
      );
    }
    recordPromptCall({
      userId: planCheck.ok ? planCheck.userId : undefined,
      promptId: promptDef.id,
      promptVersion: promptDef.version,
      provider: e instanceof AiProviderError ? e.provider : 'unknown',
      model: 'unknown',
      latencyMs: 0,
      success: false,
      errorClass: classifyAiError(e),
    });
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: 'AI provider not configured' }, { status: 500 });
    }
    const detail = e instanceof AiProviderError
      ? `${e.provider}${e.status ? ` (${e.status})` : ''}: ${e.message}`
      : (e instanceof Error ? e.message : String(e));
    console.error('scad-intent-from-nl provider error:', detail);
    captureServerError(e, {
      route: '/api/nexyfab/scad-intent-from-nl',
      method: 'POST',
      errorClass: e instanceof AiProviderError ? 'AiProviderError' : 'aiIntentHandler',
      userId: planCheck.ok ? planCheck.userId : undefined,
      tags: e instanceof AiProviderError ? { provider: e.provider } : {},
    });
    return NextResponse.json({ error: 'AI request failed' }, { status: 502 });
  }

  // Free-form mode: the model returned a complete .scad program. Strip any
  // markdown fences and hand the raw source back — the client parses its
  // Customizer annotations into sliders. No whitelist, no intent.
  if (freeform) {
    let scad = raw.replace(/^```(?:openscad|scad|c)?\s*/i, '').replace(/```\s*$/i, '').trim();
    // Some models still wrap mid-text; if fences remain, take the fenced block.
    const fence = scad.match(/```(?:openscad|scad|c)?\s*([\s\S]*?)```/i);
    if (fence) scad = fence[1]!.trim();
    // Normalise line endings: some models (e.g. Gemini) emit CRLF, and a stray
    // \r after `include <...>` makes OpenSCAD's parser throw "syntax error
    // line 1" — the render then fails entirely.
    scad = scad.replace(/\r\n?/g, '\n');
    // Accept any plausible OpenSCAD program. The BOSL2 include is a definitive
    // signal; otherwise look for any primitive/operation (broad — BOSL2 uses
    // cyl/tube/prismoid/rotate_extrude that a narrow list would wrongly reject).
    const looksLikeScad = /include\s*<BOSL2|\b(module|function|cube|cylinder|cyl|cuboid|sphere|spheroid|polyhedron|polygon|linear_extrude|rotate_extrude|hull|minkowski|union|difference|intersection|translate|rotate|scale|mirror|prismoid|tube|torus|wedge|text)\b/i.test(scad);
    if (!looksLikeScad) {
      return NextResponse.json({ error: 'AI did not return OpenSCAD code', raw: raw.slice(0, 400) }, { status: 502 });
    }
    return NextResponse.json({ scad, freeform: true, summary: 'Free-form OpenSCAD', usedProvider: used.provider, usedModel: used.model });
  }

  // Extract JSON from response — strip markdown fences and find first/last brace.
  let parsedRaw: unknown;
  try {
    let s = raw.replace(/```json?\s*/gi, '').replace(/```/g, '');
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) s = s.slice(first, last + 1);
    parsedRaw = JSON.parse(s.trim());
  } catch {
    return NextResponse.json({ error: 'AI returned non-JSON response', raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!parsedRaw || typeof parsedRaw !== 'object' || Array.isArray(parsedRaw)) {
    return NextResponse.json({ error: 'AI returned invalid JSON object', raw: raw.slice(0, 400) }, { status: 502 });
  }

  const parsed = parsedRaw as Record<string, unknown>;

  if (parsed.error === 'unsupported') {
    return NextResponse.json(
      { error: 'unsupported', reason: parsed.reason ?? 'AI declined to express this as a supported shape', code: 'UNSUPPORTED' },
      { status: 422 },
    );
  }

  let intent: IntentInput | { kind: 'assembly'; parts: AssemblyPartInput[] };
  let conv: ReturnType<typeof intentToScad>;

  if (Array.isArray(parsed.parts)) {
    // ── Assembly: heterogeneous parts → union() of placed parts ───────────
    const parts = parseAssemblyParts(parsed.parts);
    if (parts.length < 2) {
      return NextResponse.json({ error: 'assembly needs ≥2 valid parts', raw: raw.slice(0, 400) }, { status: 502 });
    }
    intent = { kind: 'assembly', parts };
    conv = assemblyToScad(parts);
  } else if (parsed.shapeId === 'sketch') {
    // ── Free-form sketch → linear_extrude(polygon) ────────────────────────
    const profile = parseProfile(parsed.profile);
    if (profile.length < 3) {
      return NextResponse.json({ error: 'sketch needs a profile of ≥3 points', raw: raw.slice(0, 400) }, { status: 502 });
    }
    intent = { shapeId: 'sketch', params: numParams(parsed.params), features: parseFeatures(parsed.features), profile };
    conv = intentToScad(intent);
  } else {
    // ── Single catalog shape (the whitelist path) ─────────────────────────
    // Glossary override: trust deterministic detection over the model's pick.
    if (detectedShape && parsed.shapeId !== detectedShape) parsed.shapeId = detectedShape;
    if (typeof parsed.shapeId !== 'string' || !(SUPPORTED_SHAPES as readonly string[]).includes(parsed.shapeId)) {
      return NextResponse.json(
        { error: `AI picked an unsupported shapeId: ${parsed.shapeId}`, raw: raw.slice(0, 400) },
        { status: 502 },
      );
    }
    intent = {
      shapeId: parsed.shapeId,
      params: numParams(parsed.params),
      features: parseFeatures(parsed.features),
      facets: typeof parsed.facets === 'number' ? parsed.facets : undefined,
    };
    conv = intentToScad(intent);
  }

  if (!conv.ok) {
    return NextResponse.json({ error: conv.reason, code: 'CONVERTER_REJECT', intent }, { status: 422 });
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 200) : undefined;

  // Persist to cache so subsequent identical prompts skip the AI call. Refine
  // results are contextual (depend on previousIntent) → not cached by prompt.
  // Fire-and-forget — a cache write failure must not break the response.
  if (!refining) {
    setCachedIntent(prompt, {
      intent,
      scad: conv.scad,
      warnings: conv.warnings,
      summary,
    }).catch(e => console.warn('[scad-intent-from-nl] cache write failed:', e));
  }

  let budgetWarning: { usedCents: number; limitUsd: number | null; fraction: number } | undefined;
  if (planCheck.ok) {
    try {
      const post = await checkUserBudget(planCheck.userId);
      if (post.approaching) {
        budgetWarning = { usedCents: post.usedCents, limitUsd: post.limitUsd, fraction: post.fraction };
      }
    } catch { /* never block on telemetry */ }
  }

  return NextResponse.json({
    intent,
    scad: conv.scad,
    warnings: conv.warnings,
    summary,
    cached: false,
    ...(usage ? { usage } : {}),
    ...(budgetWarning ? { budgetWarning } : {}),
  });
}
