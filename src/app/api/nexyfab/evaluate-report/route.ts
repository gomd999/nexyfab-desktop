// Design Review (완제품 평가): take measured geometry metrics + intended
// material/process and return a structured DFM-style evaluation report
// (strengths / issues / improvements / material fit / producibility / scores).
// Composes the existing AI provider chain (chatCompletion) — the geometry
// metrics are computed client-side from the uploaded STEP/STL.

import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion, AiNotConfiguredError, AiProviderError } from '@/lib/ai';

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
- COST: do NOT invent absolute prices or currency amounts — you cannot know real shop rates, and fabricated figures are often off by an order of magnitude. "estCostNote" must describe cost DRIVERS qualitatively (setup complexity, cycle time, material usage, scrap risk, axis count) and end by directing the user to the quote tool for an actual price. Never write a $ / ₩ number.
- The "structural estimate" provided (if any) is a crude solid-beam approximation. For a thin/hollow/shelled part its safety factor is wildly overstated — do NOT call a part "overdesigned" or give a high structure score based on it when the geometry is thin-walled or the analyzer flagged thin/zero walls; trust the DFM wall findings over the beam SF.
- Respect the intended process: if the part looks molded/organic (many undercuts, thin shell) but the process is CNC, note the process MISMATCH as the root issue rather than declaring the part broken.
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
  const user = `Part file: ${body.filename ?? 'part'}
Intended material: ${body.material ?? 'unspecified'}
Intended process: ${body.process ?? 'unspecified'}
Measured metrics (mm / mm² / mm³ unless noted): ${JSON.stringify(body.metrics)}

Automated DFM analysis findings (real geometry analysis — treat as ground truth):
${dfm}

Load-based structural estimate (transparent cantilever beam approximation, NOT full FEA): ${body.structural ? `applied load ${body.structural.loadN} N → max bending stress ${body.structural.stressMPa} MPa, safety factor ${body.structural.safetyFactor}× (${body.structural.assumption}). Factor this into the "structure" score: SF<1 is a failure risk, 1-2 marginal, >2 comfortable. Mention it in issues/improvements if marginal.` : '(not provided)'}`;

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
    return NextResponse.json({ report });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: 'AI not configured' }, { status: 500 });
    if (e instanceof AiProviderError) return NextResponse.json({ error: 'AI provider error' }, { status: 502 });
    return NextResponse.json({ error: 'evaluate failed' }, { status: 500 });
  }
}
