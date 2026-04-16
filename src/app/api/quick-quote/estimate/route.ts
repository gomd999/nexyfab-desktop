export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { validateQuoteInput, QuoteValidationError } from '@/lib/quote-validation';

// ─── 재질 고정 데이터 (밀도, 가공성 — 가격은 실시간 API에서 주입) ───────────────

const MATERIAL_META: Record<string, { name: string; density: number; price_per_kg: number; machinability: number }> = {
    steel_s45c:    { name: '일반강철 (S45C)',           density: 7.85, price_per_kg: 1800,  machinability: 0.8 },
    aluminum_6061: { name: '알루미늄합금 (6061)',        density: 2.70, price_per_kg: 4500,  machinability: 0.5 },
    stainless_304: { name: '스테인레스 (SUS304)',        density: 7.93, price_per_kg: 6000,  machinability: 1.2 },
    brass:         { name: '황동 (C3604)',              density: 8.50, price_per_kg: 9000,  machinability: 0.4 },
    abs_plastic:   { name: 'ABS 플라스틱',              density: 1.05, price_per_kg: 3500,  machinability: 0.3 },
    pom:           { name: 'POM (엔지니어링 플라스틱)',  density: 1.42, price_per_kg: 5000,  machinability: 0.35 },
    pc:            { name: 'PC (폴리카보네이트)',        density: 1.20, price_per_kg: 4800,  machinability: 0.4 },
    titanium:      { name: '티타늄 (Ti-6Al-4V)',        density: 4.43, price_per_kg: 85000, machinability: 2.5 },
};

// ─── 실시간 재료 가격 조회 ────────────────────────────────────────────────────
async function fetchLivePrices(): Promise<{ prices: Record<string, number>; usd_krw: number; priceSource: string } | null> {
    try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const res = await fetch(`${baseUrl}/api/material-prices`, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.prices) return null;
        const anyLive = Object.values(data.sources as Record<string, string>).some(s => s.includes('실시간'));
        return {
            prices: data.prices,
            usd_krw: data.usd_krw,
            priceSource: anyLive ? 'live' : 'default',
        };
    } catch {
        return null;
    }
}

// ─── 공정 데이터 ─────────────────────────────────────────────────────────────

const PROCESSES: Record<string, { name: string; base_rate: number; setup: number; complexity_factor: boolean }> = {
    cnc:               { name: 'CNC 가공',       base_rate: 85000,  setup: 150000,  complexity_factor: true },
    injection_molding: { name: '사출 성형',       base_rate: 25000,  setup: 5000000, complexity_factor: false },
    die_casting:       { name: '다이캐스팅',      base_rate: 35000,  setup: 3000000, complexity_factor: false },
    sheet_metal:       { name: '판금 가공',       base_rate: 45000,  setup: 200000,  complexity_factor: true },
    '3d_printing_fdm': { name: '3D프린팅(FDM)',   base_rate: 15000,  setup: 30000,   complexity_factor: false },
    '3d_printing_sla': { name: '3D프린팅(SLA)',   base_rate: 45000,  setup: 50000,   complexity_factor: false },
    '3d_printing_sls': { name: '3D프린팅(SLS)',   base_rate: 80000,  setup: 100000,  complexity_factor: false },
    forging:           { name: '단조',            base_rate: 55000,  setup: 800000,  complexity_factor: true },
};

// ─── POST Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const planCheck = await checkPlan(req, 'free');
    if (!planCheck.ok) return planCheck.response;

    try {
        const rawBody = await req.json();

        let validated;
        try {
            validated = validateQuoteInput(rawBody);
        } catch (err) {
            if (err instanceof QuoteValidationError) {
                return NextResponse.json({ error: err.message }, { status: 400 });
            }
            throw err;
        }

        const {
            volume_cm3, surface_area_cm2, bbox,
            material, process: processId,
            quantity, finishType, tolerance, complexity,
        } = validated;
        const aiAnalysis = rawBody?.aiAnalysis;

        // 실시간 가격 주입 시도
        const livePriceData = await fetchLivePrices();
        const MATERIALS = Object.fromEntries(
            Object.entries(MATERIAL_META).map(([key, meta]) => {
                const livePrice = livePriceData?.prices?.[key];
                return [key, { ...meta, price_per_kg: livePrice ?? meta.price_per_kg }];
            })
        );

        const mat = MATERIALS[material];
        const proc = PROCESSES[processId];

        if (!mat || !proc) {
            // Should be unreachable after whitelist validation, but belt-and-braces.
            return NextResponse.json({ error: 'Invalid material or process' }, { status: 400 });
        }

        // ── 원가 계산 ──
        const weight_kg = (volume_cm3 * mat.density) / 1000;
        const material_cost = weight_kg * mat.price_per_kg;

        const complexityFactor = proc.complexity_factor ? (complexity / 5) : 1;
        const machining_cost = surface_area_cm2 * (proc.base_rate / 10000) * mat.machinability * complexityFactor;

        const setup_amortized = proc.setup / quantity;

        // 공차 할증
        const toleranceMultiplier: Record<string, number> = { it7: 1.25, it8: 1.12, it9: 1.0, it11: 0.9 };
        const tolMult = toleranceMultiplier[tolerance] ?? 1.0;

        // 표면처리 할증
        const finishMultiplier: Record<string, number> = { none: 1.0, anodize: 1.15, paint: 1.1, chrome: 1.3, nickel: 1.2, powder_coat: 1.12 };
        const finMult = finishMultiplier[finishType] ?? 1.0;

        const unit_cost_base = (material_cost + machining_cost + setup_amortized) * tolMult * finMult;

        // 수량 할인
        let qty_discount = 1.0;
        if (quantity >= 500) qty_discount = 0.68;
        else if (quantity >= 100) qty_discount = 0.75;
        else if (quantity >= 50) qty_discount = 0.82;
        else if (quantity >= 10) qty_discount = 0.90;

        const unit_cost = Math.round(unit_cost_base * qty_discount);
        const total_cost = Math.round(unit_cost * quantity);

        const mat_pct = Math.round((material_cost / unit_cost_base) * 100);
        const mach_pct = Math.round((machining_cost / unit_cost_base) * 100);
        const setup_pct = Math.max(0, 100 - mat_pct - mach_pct);

        const estimates = {
            unit_cost,
            total_cost,
            breakdown: {
                material: { amount: Math.round(material_cost * tolMult * finMult * qty_discount), pct: mat_pct },
                machining: { amount: Math.round(machining_cost * tolMult * finMult * qty_discount), pct: mach_pct },
                setup: { amount: Math.round(setup_amortized * tolMult * finMult * qty_discount), pct: setup_pct },
            },
            weight_kg: Math.round(weight_kg * 1000) / 1000,
        };

        // ── AI 분석 ──
        let aiReport: Record<string, unknown> | null = null;
        const alternatives: Array<{ material: string; process: string; saving_pct: number; reason: string }> = [];

        try {
            const deepseekKey = process.env.DEEPSEEK_API_KEY;
            if (!deepseekKey) throw new Error('DEEPSEEK_API_KEY not configured');
            const deepseekBase = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

            const prompt = `당신은 제조업 원가 및 DFM(Design for Manufacturability) 전문가입니다.
다음 부품 정보를 분석하고 JSON으로만 답하세요.

부품 정보:
- 볼륨: ${volume_cm3.toFixed(2)} cm³
- 표면적: ${surface_area_cm2.toFixed(2)} cm²
- 크기: ${bbox.w}×${bbox.h}×${bbox.d} mm
- 무게: ${weight_kg.toFixed(3)} kg
- 선택 재질: ${mat.name}
- 선택 공정: ${proc.name}
- 수량: ${quantity}개
- 복잡도: ${complexity}/10
- 표면처리: ${finishType}
- 공차: ${tolerance}
- AI 분석: ${JSON.stringify(aiAnalysis || {})}

다음을 분석해주세요:
1. 예상 가공 난이도 및 주요 가공 챌린지
2. 현재 선택 재질/공정의 적합성 평가
3. 비용 절감 대안 (재질/공정 변경 제안, 최대 3가지)
4. 품질 리스크 포인트
5. 예상 리드타임 (일)
6. 원가 조정 계수 (0.7~1.5, 복잡도 반영)

JSON 형식으로만 답하고 다른 설명은 하지 마세요:
{
  "difficulty": "하/중/상/매우높음 중 하나",
  "challenges": ["challenge1", "challenge2"],
  "suitability": "적합/부적합/대안있음 중 하나",
  "alternatives": [{"material": "재질명", "process": "공정명", "saving_pct": 20, "reason": "이유"}],
  "quality_risks": ["risk1"],
  "lead_time_days": 14,
  "cost_factor": 1.1,
  "dfm_score": 75,
  "summary": "한 줄 종합 의견"
}`;

            const dsRes = await fetch(`${deepseekBase}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${deepseekKey}`,
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 1024,
                    temperature: 0.3,
                }),
            });

            if (dsRes.ok) {
                const dsData = await dsRes.json();
                const content = dsData.choices?.[0]?.message?.content || '';
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    aiReport = JSON.parse(jsonMatch[0]);
                    if (aiReport?.alternatives) {
                        for (const alt of aiReport.alternatives as Array<{ material: string; process: string; saving_pct: number; reason: string }>) {
                            alternatives.push(alt);
                        }
                    }
                }
            }
        } catch (dsErr) {
            console.error('DeepSeek error:', dsErr);
            // fallback: 기본 대안 제안
            if (material !== 'aluminum_6061' && processId !== 'cnc') {
                alternatives.push({ material: 'aluminum_6061', process: 'cnc', saving_pct: 15, reason: '알루미늄 6061은 강도 대비 경량화와 가공성이 우수합니다.' });
            }
        }

        return NextResponse.json({
            estimates,
            aiReport,
            alternatives,
            priceInfo: {
                source: livePriceData?.priceSource ?? 'default',
                usd_krw: livePriceData?.usd_krw ?? 1370,
                material_price_per_kg: mat.price_per_kg,
            },
        });
    } catch (err) {
        console.error('quick-quote estimate error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
