import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/ai';
import { visionCompletion } from '@/lib/ai/vision';
import { getPromptVariant } from '@/lib/ai/prompts';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { guardStudioAi } from '@/lib/studio-ai-guard';

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
  // 감사 2026-07-16: 완전 무가드였던 그물⑤(요청당 vision+chat 2회 유료 호출) — studio AI 정책 이식
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`scad-vision:${ip}`, 6, 60_000);
  if (!rl.allowed) return NextResponse.json({ faithful: true, scad: null, error: '요청이 너무 많습니다.' }, { status: 429 });
  const planGuard = await guardStudioAi(req);
  if (planGuard) return planGuard;
  try {
    const { getActiveBreaker } = await import('@/lib/cost-breaker');
    if (await getActiveBreaker()) return NextResponse.json({ faithful: true, scad: null });
  } catch { /* ignore */ }
  const body = (await req.json().catch(() => ({}))) as { image?: string; prompt?: string; scad?: string; multiview?: boolean; refImage?: string };
  const multiview = body.multiview === true;
  const prompt = (body.prompt ?? '').trim();
  const scad = (body.scad ?? '').trim();
  const image = body.image ?? '';
  if (!scad || !image || !prompt) {
    return NextResponse.json({ faithful: true, scad: null });
  }

  const toBytes = (s: string): Uint8Array | null => {
    try { return Uint8Array.from(Buffer.from(s.includes(',') ? s.split(',')[1]! : s, 'base64')); }
    catch { return null; }
  };
  const bytes = toBytes(image);
  if (!bytes) return NextResponse.json({ faithful: true, scad: null });
  // Optional reference photo (image-to-3D): the reviewer compares the render
  // against the real object the user uploaded.
  const refBytes = body.refImage ? toBytes(body.refImage) : null;

  // 1. Vision judges the render against the request.
  let critique: { faithful: boolean; issues: string[] };
  try {
    const sheetDesc = multiview
      ? `a 2×2 multi-view sheet (top-left ISO, top-right FRONT, bottom-left SIDE, bottom-right TOP) of ONE 3D model`
      : `a screenshot of a 3D model`;
    const visionPrompt = refBytes
      ? `IMAGE 1 is a reference photo of the real object the user wants. IMAGE 2 is ${sheetDesc} that is supposed to reproduce it. Judge IMAGE 2 against IMAGE 1.
Reply with STRICT JSON ONLY: {"faithful": true|false, "issues": ["short specific geometry problem", ...]}
Faithful = IMAGE 2 clearly reads as the SAME kind of object as IMAGE 1, as ONE connected solid, with every part correctly shaped, oriented, positioned, proportioned and connected. Cross-check the model's views. The most common failure is parts SCATTERED / EXPLODED / floating away from the body — flag every detached or mis-positioned part and where it should go. Also flag: missing parts, wrong orientation (wheels lying flat instead of rolling), wrong count, bad proportions. Max 5 issues. If it already looks right, return faithful=true and issues=[].`
      : `This is ${sheetDesc} meant to represent: "${prompt}". Judge it AS that object, using ALL the views together.
Reply with STRICT JSON ONLY: {"faithful": true|false, "issues": ["short specific geometry problem", ...]}
Faithful = a person clearly recognizes it as "${prompt}", as ONE connected solid, with every part correctly shaped, oriented, positioned, proportioned and connected.${multiview ? ' Cross-check the views: a part can look fine in ISO but be wrong in TOP/SIDE (e.g. wheels lying flat, a hollow/missing back, parts floating off the body).' : ''} Flag problems like: scattered/floating/detached parts, missing parts, wrong orientation, wrong count, bad proportions. Max 5 issues. If it already looks right, return faithful=true and issues=[].`;
    const v = await visionCompletion({
      prompt: visionPrompt,
      images: refBytes ? [{ bytes: refBytes, label: 'reference photo' }, { bytes, label: 'model render' }] : [{ bytes }],
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
