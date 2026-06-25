import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/ai';
import { visionCompletion } from '@/lib/ai/vision';
import { getPromptVariant } from '@/lib/ai/prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Visual self-critique for free-form Studio models. The client sends a
 * screenshot of the rendered model + the original prompt + the SCAD source.
 * Gemini (vision) judges whether it actually LOOKS like the requested object
 * and lists concrete geometry problems; if it doesn't, DeepSeek rewrites the
 * geometry to fix them. Returns the corrected SCAD (or null if already faithful
 * / vision unavailable). This improves an already-generated design, so it is
 * not metered as a new design (guest-friendly, like the render self-repair).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { image?: string; prompt?: string; scad?: string };
  const prompt = (body.prompt ?? '').trim();
  const scad = (body.scad ?? '').trim();
  const image = body.image ?? '';
  if (!scad || !image || !prompt) {
    return NextResponse.json({ faithful: true, scad: null });
  }

  // dataURL → PNG bytes
  const b64 = image.includes(',') ? image.split(',')[1]! : image;
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(Buffer.from(b64, 'base64')); }
  catch { return NextResponse.json({ faithful: true, scad: null }); }

  // 1. Vision judges the render against the request.
  let critique: { faithful: boolean; issues: string[] };
  try {
    const v = await visionCompletion({
      prompt: `This is a screenshot of a 3D model meant to represent: "${prompt}". Judge it AS that object.
Reply with STRICT JSON ONLY: {"faithful": true|false, "issues": ["short specific geometry problem", ...]}
Faithful = a person clearly recognizes it as "${prompt}", with every part correctly shaped, oriented, positioned, proportioned and connected. Flag problems like: missing parts, wrong orientation (e.g. wheels lying flat / sideways instead of rolling), misplaced or floating/detached parts, wrong count, bad proportions. Max 5 issues. If it already looks right, return faithful=true and issues=[].`,
      images: [{ bytes }],
      maxTokens: 400,
      timeoutMs: 40_000,
    });
    const m = v.text.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : { faithful: true, issues: [] };
    critique = {
      faithful: parsed.faithful !== false,
      issues: Array.isArray(parsed.issues) ? parsed.issues.filter((s: unknown) => typeof s === 'string').slice(0, 5) : [],
    };
  } catch {
    return NextResponse.json({ faithful: true, scad: null }); // vision down → no-op
  }

  if (critique.faithful || critique.issues.length === 0) {
    return NextResponse.json({ faithful: true, scad: null, issues: [] });
  }

  // 2. DeepSeek rewrites the geometry to fix the flagged problems.
  const promptDef = getPromptVariant('scad-freeform', undefined);
  try {
    const fix = await chatCompletion({
      messages: [
        { role: 'system', content: promptDef.template },
        { role: 'user', content: `Here is the current OpenSCAD program:\n\`\`\`\n${scad}\n\`\`\`\n\nA reviewer looked at the 3D render and found these problems that stop it from looking like "${prompt}":\n${critique.issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nFix the GEOMETRY so it faithfully looks like "${prompt}": correct the orientation, position, proportion and connection of every part, and remove any floating/detached pieces. Return the COMPLETE corrected program, keeping the same Customizer parameter variables, comments and groups so the sliders still work.` },
      ],
      maxTokens: promptDef.defaults.maxTokens,
      temperature: 0.4,
      timeoutMs: promptDef.defaults.timeoutMs,
      task: 'scad-freeform',
    });
    let fixed = fix.text.replace(/^```(?:openscad|scad|c)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const fence = fixed.match(/```(?:openscad|scad|c)?\s*([\s\S]*?)```/i);
    if (fence) fixed = fence[1]!.trim();
    return NextResponse.json({ faithful: false, issues: critique.issues, scad: fixed && fixed !== scad ? fixed : null });
  } catch {
    return NextResponse.json({ faithful: false, issues: critique.issues, scad: null });
  }
}
