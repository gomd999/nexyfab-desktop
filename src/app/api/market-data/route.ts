export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

// ── 모듈-레벨 캐시 (1시간) ──────────────────────────────────────────────────
interface CachedData {
    rates: { USD_KRW: number; CNY_KRW: number; EUR_KRW: number; VND_KRW: number; JPY_KRW: number };
    materials: {
        steel_hot_rolled: { value: number; unit: string; source: string };
        aluminum:         { value: number; unit: string; source: string };
        copper:           { value: number; unit: string; source: string };
        plastic_abs:      { value: number; unit: string; source: string };
    };
    shipping: {
        SCFI_composite:        { value: number; unit: string; source: string };
        transpacific_westbound: { value: number; unit: string; source: string };
        asia_europe:           { value: number; unit: string; source: string };
    };
    lastUpdated: string;
}

let cache: CachedData | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1시간

// ── 기본값 (실시간 API 실패 시 폴백) ────────────────────────────────────────
const MATERIAL_DEFAULTS = {
    steel_hot_rolled: { value: 650,  unit: 'USD/ton',  source: 'default' },
    aluminum:         { value: 2400, unit: 'USD/ton',  source: 'default' },
    copper:           { value: 9200, unit: 'USD/ton',  source: 'default' },
    plastic_abs:      { value: 1800, unit: 'USD/ton',  source: 'default' },
};

const SHIPPING_DEFAULTS = {
    SCFI_composite:        { value: 1320, unit: 'USD/TEU', source: 'default' },
    transpacific_westbound:{ value: 2150, unit: 'USD/TEU', source: 'default' },
    asia_europe:           { value: 1800, unit: 'USD/TEU', source: 'default' },
};

// ── GET /api/market-data ─────────────────────────────────────────────────────
export async function GET() {
    const now = Date.now();

    // 캐시가 살아있으면 즉시 반환
    if (cache && now - cacheTimestamp < CACHE_TTL) {
        return NextResponse.json(cache);
    }

    // ── 1. 실시간 환율 조회 (open.er-api.com, 키 불필요) ─────────────────────
    let rates = { USD_KRW: 1370, CNY_KRW: 188, EUR_KRW: 1490, VND_KRW: 0.054, JPY_KRW: 9.1 };
    try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD', {
            next: { revalidate: 3600 },
            signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
            const data = await res.json();
            if (data?.rates) {
                const r = data.rates;
                const usdKrw = r.KRW ?? 1370;
                rates = {
                    USD_KRW: Math.round(usdKrw),
                    CNY_KRW: Math.round(usdKrw / (r.CNY ?? 7.27)),
                    EUR_KRW: Math.round(usdKrw / (r.EUR ?? 0.92)),
                    VND_KRW: parseFloat((usdKrw / (r.VND ?? 25400)).toFixed(5)),
                    JPY_KRW: parseFloat((usdKrw / (r.JPY ?? 150)).toFixed(3)),
                };
            }
        }
    } catch (_) {
        // 폴백값 사용
    }

    // ── 2. 원자재 (키 필요 API 대신 기본값 구조 준비) ──────────────────────
    // 추후 metals-api.com 또는 commodity 공개 API 연동 가능
    const materials = { ...MATERIAL_DEFAULTS };

    // ── 3. 해운운임 (구조만 준비, 추후 Freightos/Xeneta 연동 가능) ──────────
    const shipping = { ...SHIPPING_DEFAULTS };

    const result: CachedData = {
        rates,
        materials,
        shipping,
        lastUpdated: new Date().toISOString(),
    };

    cache = result;
    cacheTimestamp = now;

    return NextResponse.json(result);
}
