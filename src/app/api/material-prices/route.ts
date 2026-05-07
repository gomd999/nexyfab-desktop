export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// ─── 캐시 파일 경로 ───────────────────────────────────────────────────────────
const CACHE_FILE = path.join(process.cwd(), 'data', 'material-prices-cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24시간

// ─── LME 기준 USD/ton 기본값 (API 실패 시 폴백) ──────────────────────────────
// 2025년 1분기 LME 시세 기준
const LME_DEFAULTS: Record<string, number> = {
    aluminum: 2400,   // USD/ton
    copper:   9500,   // USD/ton
    steel:    580,    // USD/ton (HRC)
    nickel:   15500,  // USD/ton
    crude:    75,     // USD/barrel (WTI)
};

// ─── 환율 기본값 ──────────────────────────────────────────────────────────────
const KRW_DEFAULT = 1370; // USD/KRW

// ─── Alpha Vantage 조회 ───────────────────────────────────────────────────────
async function fetchAlphaVantage(fn: string, apiKey: string): Promise<number | null> {
    try {
        const url = `https://www.alphavantage.co/query?function=${fn}&interval=monthly&apikey=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const data = await res.json();

        // Alpha Vantage commodity endpoint: { data: [{ date, value }, ...] }
        const rows: Array<{ date: string; value: string }> = data?.data ?? [];
        // 가장 최근 유효 값
        for (const row of rows) {
            const v = parseFloat(row.value);
            if (!isNaN(v) && v > 0) return v;
        }
        return null;
    } catch {
        return null;
    }
}

// ─── 환율 조회 (open.er-api.com, 키 불필요) ───────────────────────────────────
async function fetchKrwRate(): Promise<number> {
    try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD', {
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return KRW_DEFAULT;
        const data = await res.json();
        return data?.rates?.KRW ?? KRW_DEFAULT;
    } catch {
        return KRW_DEFAULT;
    }
}

// ─── 8가지 재료 가격 계산 (KRW/kg) ──────────────────────────────────────────
function computePrices(lme: Record<string, number>, krwRate: number): Record<string, number> {
    const { aluminum, copper, steel, nickel, crude } = lme;

    // 각 재료 = LME 원자재 × 합금 프리미엄 × KRW 환율 / 1000 (ton→kg)
    return {
        // 금속류
        aluminum_6061: Math.round((aluminum / 1000) * 1.45 * krwRate),   // 6061 합금 프리미엄 +45%
        steel_s45c:    Math.round((steel    / 1000) * 1.35 * krwRate),   // S45C 중탄소강 프리미엄 +35%
        stainless_304: Math.round(
            // SUS304 ≈ 철 70% + 니켈 10% + 크롬 18% (크롬은 LME 없으므로 니켈 연동 추정)
            ((steel / 1000 * 0.68 + nickel / 1000 * 0.12) * 2.5 * krwRate)
        ),
        brass:         Math.round((copper   / 1000) * 0.65 * 1.25 * krwRate), // 구리 65% + 아연
        titanium:      Math.round(80000 * (1 + (krwRate - 1370) / 1370)),      // 환율 연동만 (LME 없음)

        // 플라스틱류 (원유가 연동 근사)
        // 나프타 = 원유 × 0.85, ABS 마진 = 나프타 × 1.6~2.2
        abs_plastic: Math.round((crude * 0.85 * 1.9) / 0.159 * krwRate / 1000000 * 1000),
        // POM = 메탄올 기반, 원유 연동 +20%
        pom: Math.round((crude * 0.85 * 2.3) / 0.159 * krwRate / 1000000 * 1000),
        // PC = BPA+포스겐, 원유 연동 +30%
        pc:  Math.round((crude * 0.85 * 2.6) / 0.159 * krwRate / 1000000 * 1000),
    };
}

// ─── 캐시 읽기 / 쓰기 ─────────────────────────────────────────────────────────
function readCache(): { prices: Record<string, number>; sources: Record<string, string>; usd_krw: number; lastUpdated: string } | null {
    try {
        if (!fs.existsSync(CACHE_FILE)) return null;
        const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
        const data = JSON.parse(raw);
        if (Date.now() - new Date(data.lastUpdated).getTime() > CACHE_TTL_MS) return null;
        return data;
    } catch {
        return null;
    }
}

function writeCache(data: object) {
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
    } catch {
        // ignore write errors
    }
}

// ─── GET /api/material-prices ─────────────────────────────────────────────────
export async function GET() {
    // 캐시 확인
    const cached = readCache();
    if (cached) {
        const response = NextResponse.json({ ...cached, cached: true });
        response.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        return response;
    }

    const apiKey = process.env.ALPHAVANTAGE_API_KEY || '';
    const sources: Record<string, string> = {};

    // ── 1. 환율 조회 ──────────────────────────────────────────────────────────
    const krwRate = await fetchKrwRate();
    sources.usd_krw = 'open.er-api.com (실시간)';

    // ── 2. LME 원자재 시세 ────────────────────────────────────────────────────
    const lme = { ...LME_DEFAULTS };

    if (apiKey) {
        // Alpha Vantage 무료 키: ALUMINUM, COPPER만 지원 (나머지는 기준값 + 환율 연동)
        const [alu, cop] = await Promise.all([
            fetchAlphaVantage('ALUMINUM', apiKey),
            fetchAlphaVantage('COPPER', apiKey),
        ]);

        if (alu !== null) { lme.aluminum = alu; sources.aluminum = `Alpha Vantage LME 실시간 (${new Date().toLocaleDateString('ko-KR')})`; }
        else               sources.aluminum = 'LME 기준값';

        if (cop !== null) { lme.copper = cop; sources.copper = `Alpha Vantage LME 실시간 (${new Date().toLocaleDateString('ko-KR')})`; }
        else               sources.copper = 'LME 기준값';

        // 철강/니켈/원유: 무료 키 미지원 → 기준값 + 환율 반영
        sources.steel  = 'HRC 기준값 + 환율 연동';
        sources.nickel = 'LME 기준값 + 환율 연동';
        sources.crude  = 'WTI 기준값 + 환율 연동';
    } else {
        sources.aluminum = 'LME 기준값 + 환율 연동 (ALPHAVANTAGE_API_KEY 미설정)';
        sources.copper   = 'LME 기준값 + 환율 연동';
        sources.steel    = 'HRC 기준값 + 환율 연동';
        sources.nickel   = 'LME 기준값 + 환율 연동';
        sources.crude    = 'WTI 기준값 + 환율 연동';
    }

    // ── 3. 재료 가격 계산 ─────────────────────────────────────────────────────
    const prices = computePrices(lme, krwRate);

    // 최솟값 가드 (계산 오류 방지)
    const MIN_PRICES: Record<string, number> = {
        aluminum_6061: 3000,  steel_s45c: 1000,  stainless_304: 4000,
        brass: 6000,           titanium: 60000,   abs_plastic: 2000,
        pom: 3000,             pc: 3000,
    };
    for (const key of Object.keys(prices)) {
        if (prices[key] < MIN_PRICES[key]) prices[key] = MIN_PRICES[key];
    }

    const result = {
        prices,
        lme_usd_per_ton: lme,
        usd_krw: Math.round(krwRate),
        sources,
        lastUpdated: new Date().toISOString(),
        cached: false,
    };

    writeCache(result);
    const response = NextResponse.json(result);
    response.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return response;
}
