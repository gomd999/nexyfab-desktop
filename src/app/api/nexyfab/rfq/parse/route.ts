/**
 * POST /api/nexyfab/rfq/parse
 * 자연어 텍스트에서 RFQ 구조화 데이터를 추출합니다. (LLM 기반)
 *
 * Body: { text: string, lang?: string }
 * Returns: { parsed: ParsedRFQ, confidence: number, rawText: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// 유효한 materialId 목록 (RFQ form과 동일)
const MATERIAL_IDS = [
  'aluminum_6061', 'aluminum_7075', 'steel_mild', 'steel_stainless',
  'titanium', 'abs', 'pla', 'nylon', 'other',
] as const;

type MaterialId = typeof MATERIAL_IDS[number];

interface ParsedRFQ {
  shapeName?: string;
  materialId?: MaterialId;
  quantity?: number;
  deadline?: string;    // ISO date string YYYY-MM-DD
  note?: string;
  dfmProcess?: string;  // cnc_milling | cnc_turning | injection_molding | sheet_metal | casting | 3d_printing
}

// 정규식 fallback (LLM 없을 때)
function regexParse(text: string): ParsedRFQ {
  const result: ParsedRFQ = {};

  // 수량
  const qtyMatch = text.match(/(\d[\d,]*)\s*(?:개|pcs?|pieces?|units?|ea\.?)/i);
  if (qtyMatch) result.quantity = parseInt(qtyMatch[1].replace(/,/g, ''), 10);

  // 재질 키워드 매핑
  const matMap: Array<[RegExp, MaterialId]> = [
    [/알루미늄\s*7075|aluminum\s*7075/i, 'aluminum_7075'],
    [/알루미늄|aluminum|알루|aluminium/i, 'aluminum_6061'],
    [/스테인리스|stainless|sus|stainless\s*steel/i, 'steel_stainless'],
    [/스틸|강재|steel|mild\s*steel/i, 'steel_mild'],
    [/티타늄|titanium/i, 'titanium'],
    [/abs/i, 'abs'],
    [/pla/i, 'pla'],
    [/나일론|nylon/i, 'nylon'],
  ];
  for (const [re, id] of matMap) {
    if (re.test(text)) { result.materialId = id; break; }
  }

  // 공정
  const procMap: Array<[RegExp, string]> = [
    [/cnc\s*밀링|cnc\s*milling/i, 'cnc_milling'],
    [/cnc\s*선반|cnc\s*turning/i, 'cnc_turning'],
    [/사출|injection/i, 'injection_molding'],
    [/판금|sheet\s*metal/i, 'sheet_metal'],
    [/주조|casting/i, 'casting'],
    [/3d\s*프린팅|3d\s*printing|additive/i, '3d_printing'],
  ];
  for (const [re, proc] of procMap) {
    if (re.test(text)) { result.dfmProcess = proc; break; }
  }

  return result;
}

function buildSystemPrompt(): string {
  return `You are a manufacturing RFQ (Request for Quote) parser. Extract structured data from the user's message.

Return ONLY a JSON object with these fields (omit missing ones):
{
  "shapeName": "part name string",
  "materialId": one of: "aluminum_6061" | "aluminum_7075" | "steel_mild" | "steel_stainless" | "titanium" | "abs" | "pla" | "nylon" | "other",
  "quantity": integer,
  "deadline": "YYYY-MM-DD",
  "dfmProcess": one of: "cnc_milling" | "cnc_turning" | "injection_molding" | "sheet_metal" | "casting" | "3d_printing",
  "note": "any relevant notes, tolerances, surface finish requirements, etc.",
  "confidence": 0-100
}

Rules:
- deadline: convert relative dates (e.g. "3주 후", "next month", "by March") to absolute YYYY-MM-DD based on today: ${new Date().toISOString().slice(0, 10)}
- materialId: map common names (알루미늄→aluminum_6061, 스테인리스→steel_stainless, etc.)
- note: capture tolerances, surface finish, special requirements
- confidence: 0-100 based on how much was extractable
- Do NOT wrap in markdown. Return raw JSON only.`;
}

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rate limit: 20 parses per hour per user
  const rl = rateLimit(`rfq-parse:${authUser.userId}`, 20, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  }

  let body: { text?: string; lang?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const text = (body.text ?? '').trim();
  if (!text) return NextResponse.json({ error: 'text는 필수입니다.' }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ error: '텍스트가 너무 깁니다. (최대 2000자)' }, { status: 400 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';

  // LLM 없으면 정규식 fallback
  if (!apiKey) {
    const parsed = regexParse(text);
    return NextResponse.json({ parsed, confidence: 40, rawText: text, fallback: true });
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: text },
        ],
        temperature: 0.1,
        max_tokens: 512,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) throw new Error(`LLM API error: ${response.status}`);

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const llmResult = JSON.parse(raw) as ParsedRFQ & { confidence?: number };

    // 유효성 검증
    const parsed: ParsedRFQ = {};
    if (typeof llmResult.shapeName === 'string' && llmResult.shapeName.trim()) {
      parsed.shapeName = llmResult.shapeName.trim().slice(0, 200);
    }
    if (MATERIAL_IDS.includes(llmResult.materialId as MaterialId)) {
      parsed.materialId = llmResult.materialId as MaterialId;
    }
    if (typeof llmResult.quantity === 'number' && llmResult.quantity >= 1 && llmResult.quantity <= 100_000) {
      parsed.quantity = Math.round(llmResult.quantity);
    }
    if (typeof llmResult.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(llmResult.deadline)) {
      const d = new Date(llmResult.deadline);
      if (!isNaN(d.getTime()) && d > new Date()) parsed.deadline = llmResult.deadline;
    }
    if (typeof llmResult.note === 'string' && llmResult.note.trim()) {
      parsed.note = llmResult.note.trim().slice(0, 2000);
    }
    const validProcesses = ['cnc_milling', 'cnc_turning', 'injection_molding', 'sheet_metal', 'casting', '3d_printing'];
    if (validProcesses.includes(llmResult.dfmProcess as string)) {
      parsed.dfmProcess = llmResult.dfmProcess;
    }

    const confidence = typeof llmResult.confidence === 'number'
      ? Math.max(0, Math.min(100, llmResult.confidence))
      : 70;

    return NextResponse.json({ parsed, confidence, rawText: text });

  } catch (err) {
    // LLM 실패 시 정규식 fallback
    console.error('[rfq/parse] LLM error, falling back to regex:', err);
    const parsed = regexParse(text);
    return NextResponse.json({ parsed, confidence: 35, rawText: text, fallback: true });
  }
}
