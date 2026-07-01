// Design Review (완제품 평가): take measured geometry metrics + intended
// material/process and return a structured DFM-style evaluation report
// (strengths / issues / improvements / material fit / producibility / scores).
// Composes the existing AI provider chain (chatCompletion) — the geometry
// metrics are computed client-side from the uploaded STEP/STL.

import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion, AiNotConfiguredError, AiProviderError } from '@/lib/ai';
import { estimateCost, compareCost, costCurve, type CostProcess, type CostRegion, type DfmSignals, type Tolerance, type Finish } from '@/lib/costModel';
import { getCalibrationFactor } from '@/lib/quoteHistory';
import { getAuthUser } from '@/lib/auth-middleware';

const PAID_PLANS = new Set(['pro', 'team', 'enterprise']);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LANG_NAME: Record<string, string> = {
  ko: 'Korean', kr: 'Korean', en: 'English', ja: 'Japanese', jp: 'Japanese',
  cn: 'Chinese', zh: 'Chinese', es: 'Spanish', ar: 'Arabic',
};

const SYSTEM = `You are a senior manufacturing / design-for-manufacturing (DFM) engineer reviewing a finished 3D part for production. You are given measured geometry metrics plus the intended material and process. Produce a concise, honest, practical evaluation.
Output ONLY valid minified JSON (no markdown, no prose around it) with EXACTLY this shape:
{
 "summary": string,
 "scores": { "manufacturability": number, "cost": number, "structure": number },
 "strengths": string[],
 "issues": string[],
 "improvements": string[],
 "material": { "fit": string, "note": string },
 "producibility": { "process": string, "difficulty": "low"|"medium"|"high", "note": string },
 "estCostNote": string
}
Rules:
- scores are 0-100 integers.
- 2-4 strengths, 2-5 issues, 2-5 improvements; each a short concrete sentence.
- Base every claim on the numbers given (volume, surface area, bounding box, SA/volume ratio, aspect ratios, triangle count, wall hints). Infer thin-wall / high-aspect / large-volume risks from them.
- When automated DFM findings are provided, treat them as GROUND TRUTH: surface each real issue (esp. thin_wall, undercut, deep_pocket, sharp_corner, draft_angle) in "issues", reflect its fix in "improvements", and let error/warning counts drive the manufacturability and structure scores down accordingly.
- If material/process is "unspecified", recommend a sensible one and say so.
- Be specific and actionable, not generic.
- COST: a deterministic parametric estimate RANGE (in KRW) is provided above. In "estCostNote", present THAT range (per part + total) and its main drivers in {LANG}, note it is a budgeting estimate from geometry (not a binding quote), and end by directing the user to get a real quote (실견적) to confirm. Do NOT invent any OTHER numbers or a different currency — only use the provided range. If no estimate was provided, describe cost drivers qualitatively without inventing figures.
- The "structural estimate" provided (if any) is a crude solid-beam approximation. For a thin/hollow/shelled part its safety factor is wildly overstated — do NOT call a part "overdesigned" or give a high structure score based on it when the geometry is thin-walled or the analyzer flagged thin/zero walls; trust the DFM wall findings over the beam SF.
- Respect the intended process: if the part looks molded/organic (many undercuts, thin shell) but the process is CNC, note the process MISMATCH as the root issue rather than declaring the part broken.
- PROCESS × MATERIAL ECONOMICS: weigh how the chosen material behaves in the chosen process (machinability / moldability / printability, e.g. titanium & stainless are slow/abrasive to machine, aluminum & brass are easy; ABS/PP/nylon mold well, glass-filled grades are abrasive) AND the process cost structure vs the given quantity:
  • CNC / 3D printing: no tooling cost; per-part cost dominated by time & material — fine at low quantity, expensive per-part at high quantity.
  • Injection molding / casting: high one-time tooling (mold) cost amortized over volume — only economical above a break-even quantity (often ~1,000+ for injection).
  Use the quantity to recommend the MOST economical process for that volume; if the chosen process is uneconomical at that quantity, say so in "producibility" and suggest the better one. Reflect this in the "cost" score (low quantity + injection tooling = poor cost score; high quantity + CNC = poor cost score).
- Write ALL string values in {LANG}.`;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    metrics?: Record<string, unknown>;
    material?: string;
    process?: string;
    filename?: string;
    lang?: string;
    dfmIssues?: Array<{ type: string; severity: string; description: string; suggestion?: string }>;
    structural?: { stressMPa: number; safetyFactor: number; loadN: number; assumption: string; reliable?: boolean } | null;
    quantity?: number;
    materialProps?: { density?: number; yieldStrength?: number; youngsModulus?: number } | null;
    meshReliable?: boolean;
    unit?: string;
    pullAxis?: string;
    region?: string; // 'kr' | 'cn' — for the cost estimate
    dfmSignals?: DfmSignals;
    tolerance?: Tolerance;
    finish?: Finish;
  } | null;
  if (!body?.metrics) {
    return NextResponse.json({ error: 'metrics required' }, { status: 400 });
  }
  const langName = LANG_NAME[body.lang ?? 'ko'] ?? 'English';
  // Real DFM findings (computed client-side by analyzeDFM) are GROUND TRUTH —
  // thin_wall / undercut / aspect_ratio / sharp_corner are the structural &
  // manufacturability risk signals the AI must base its scores and issues on.
  const dfm = Array.isArray(body.dfmIssues) && body.dfmIssues.length > 0
    ? body.dfmIssues.slice(0, 25).map(i => `- [${i.severity}] ${i.type}: ${i.description}${i.suggestion ? ` → ${i.suggestion}` : ''}`).join('\n')
    : '(no automated DFM issues detected by the geometry analyzer)';
  // Deterministic parametric cost estimate (calibrated by real quotes when
  // available) — the AI narrates THIS range instead of inventing prices.
  const COST_PROCS = new Set(['cnc', 'injection', 'sheet_metal', '3d_print', 'casting']);
  const proc = (body.process && COST_PROCS.has(body.process) ? body.process : 'cnc') as CostProcess;
  const region = (body.region === 'cn' ? 'cn' : 'kr') as CostRegion;
  const material = body.material ?? 'aluminum';
  const qty = body.quantity && body.quantity > 0 ? body.quantity : 1;
  const mtr = (body.metrics ?? {}) as { volume_mm3?: number; surface_area_mm2?: number; bbox_mm?: { w: number; h: number; d: number } };
  // Plan gate: the DFM/scores report is a free preview; the monetized cost
  // outputs (estimate range, quantity curve, process×region comparison) are
  // PRO+ only. Guests/free get the report but a locked cost section.
  const auth = await getAuthUser(req).catch(() => null);
  const isPro = PAID_PLANS.has(auth?.plan ?? 'free');

  let costEstimate: ReturnType<typeof estimateCost> | null = null;
  let costComparison: ReturnType<typeof compareCost> | null = null;
  let costCurvePoints: ReturnType<typeof costCurve> | null = null;
  if (isPro) {
    try {
      const cal = await getCalibrationFactor(proc, material, region);
      const geom = {
        volume_mm3: Number(mtr.volume_mm3) || 0,
        surface_area_mm2: Number(mtr.surface_area_mm2) || 0,
        bbox_mm: mtr.bbox_mm ?? { w: 0, h: 0, d: 0 },
        material, quantity: qty,
        dfm: body.dfmSignals, tolerance: body.tolerance, finish: body.finish,
      };
      costEstimate = estimateCost({ ...geom, process: proc, region, calibrationFactor: cal });
      // "AI 비교견적": rank viable processes × KR/CN so the report shows alternatives.
      costComparison = compareCost(geom);
      // Volume breakpoints for the chosen process/region.
      costCurvePoints = costCurve({ ...geom, process: proc, region, calibrationFactor: cal });
    } catch { /* estimate is best-effort */ }
  }
  const costLine = costEstimate
    ? `Parametric cost estimate (${region.toUpperCase()}, ${costEstimate.calibrated ? 'calibrated by real quotes' : 'uncalibrated seed rates'} — a budgeting RANGE, not a binding quote): per part ${costEstimate.perPart.min.toLocaleString()}-${costEstimate.perPart.max.toLocaleString()} KRW, total for ${qty} pcs ${costEstimate.total.min.toLocaleString()}-${costEstimate.total.max.toLocaleString()} KRW, lead ${costEstimate.leadDays.min}-${costEstimate.leadDays.max} days. Drivers: ${costEstimate.drivers.join('; ')}.`
    : '(no cost estimate)';
  const compareLine = costComparison
    ? `Process/region comparison at qty ${qty} (cheapest first, mid per-part KRW): ${costComparison.options.slice(0, 5).map(o => `${o.process}/${o.region} ~${Math.round((o.perPart.min + o.perPart.max) / 2).toLocaleString()}`).join(', ')}. Cheapest: ${costComparison.cheapest.process}/${costComparison.cheapest.region}. ${costComparison.notes.join(' ')}`
    : '';

  const mp = body.materialProps;
  const user = `Part file: ${body.filename ?? 'part'}
Intended material: ${body.material ?? 'unspecified'}${mp ? ` (density ${mp.density ?? '?'} g/cm³, yield ${mp.yieldStrength ?? '?'} MPa)` : ''}
Intended process: ${body.process ?? 'unspecified'}
Target quantity: ${body.quantity && body.quantity > 0 ? `${body.quantity} pcs` : 'unspecified'}
Measured metrics (mm / mm² / mm³ unless noted): ${JSON.stringify(body.metrics)}

Mesh quality: ${body.meshReliable === false ? 'LOW — non-watertight/degenerate mesh. DFM findings below (esp. thin/zero walls, undercut counts) are UNRELIABLE and likely contain FALSE POSITIVES. Caveat them explicitly, do not tank scores on them alone, and recommend uploading a solid STEP.' : 'OK'}
${body.pullAxis ? `Injection pull direction: ${body.pullAxis}` : ''}

Automated DFM analysis findings (real geometry analysis${body.meshReliable === false ? ' — TREAT AS INDICATIVE ONLY due to low mesh quality' : ' — treat as ground truth'}):
${dfm}

Load-based structural estimate (transparent cantilever beam approximation, NOT full FEA): ${body.structural ? `applied load ${body.structural.loadN} N → max bending stress ${body.structural.stressMPa} MPa, safety factor ${body.structural.safetyFactor}× (${body.structural.assumption}). Factor this into the "structure" score: SF<1 is a failure risk, 1-2 marginal, >2 comfortable. Mention it in issues/improvements if marginal.` : '(not provided)'}

${costLine}
${compareLine}`;

  try {
    const { text } = await chatCompletion({
      messages: [
        { role: 'system', content: SYSTEM.replace('{LANG}', langName) },
        { role: 'user', content: user },
      ],
      maxTokens: 1200,
      temperature: 0.3,
    });
    let raw = (text || '').trim();
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) raw = m[0];
    let report: unknown;
    try {
      report = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'AI returned non-JSON', raw: (text || '').slice(0, 300) }, { status: 502 });
    }
    return NextResponse.json({ report, costEstimate, costComparison, costCurve: costCurvePoints, costLocked: !isPro });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: 'AI not configured' }, { status: 500 });
    if (e instanceof AiProviderError) return NextResponse.json({ error: 'AI provider error' }, { status: 502 });
    return NextResponse.json({ error: 'evaluate failed' }, { status: 500 });
  }
}
