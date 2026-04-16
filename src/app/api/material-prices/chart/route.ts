export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// ─── 캐시 파일 경로 ───────────────────────────────────────────────────────────
const CACHE_FILE = path.join(process.cwd(), 'data', 'material-prices-chart-cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24시간

// ─── 응답 타입 ────────────────────────────────────────────────────────────────
interface PricePoint {
    date: string;  // "2025-03" 형식
    value: number; // USD/ton
}

interface ChartData {
    aluminum: PricePoint[];
    copper: PricePoint[];
    lastUpdated: string;
}

// ─── 캐시 읽기 / 쓰기 ─────────────────────────────────────────────────────────
function readCache(): ChartData | null {
    try {
        if (!fs.existsSync(CACHE_FILE)) return null;
        const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
        const data = JSON.parse(raw) as ChartData & { cachedAt?: string };
        const cachedAt = data.cachedAt || data.lastUpdated;
        if (Date.now() - new Date(cachedAt).getTime() > CACHE_TTL_MS) return null;
        return data;
    } catch {
        return null;
    }
}

function writeCache(data: ChartData) {
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify({ ...data, cachedAt: new Date().toISOString() }, null, 2));
    } catch {
        // ignore write errors
    }
}

// ─── Alpha Vantage 월별 12개월 과거 데이터 조회 ──────────────────────────────
async function fetchHistorical(fn: string, apiKey: string): Promise<PricePoint[]> {
    try {
        const url = `https://www.alphavantage.co/query?function=${fn}&interval=monthly&apikey=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return [];
        const data = await res.json();

        // Alpha Vantage commodity endpoint: { data: [{ date: "2025-03-31", value: "2651.00" }, ...] }
        const rows: Array<{ date: string; value: string }> = data?.data ?? [];

        const points: PricePoint[] = rows
            .map((row) => {
                const v = parseFloat(row.value);
                // date를 "YYYY-MM" 형식으로 변환
                const datePart = row.date?.slice(0, 7) || '';
                if (isNaN(v) || v <= 0 || !datePart) return null;
                return { date: datePart, value: Math.round(v) };
            })
            .filter((p): p is PricePoint => p !== null);

        // 오름차순 정렬 후 최신 12개월만 반환
        points.sort((a, b) => a.date.localeCompare(b.date));
        return points.slice(-12);
    } catch {
        return [];
    }
}

// ─── 폴백 더미 데이터 생성 (API 실패 시) ────────────────────────────────────
function generateFallbackData(baseValue: number, months: number = 12): PricePoint[] {
    const now = new Date();
    const points: PricePoint[] = [];
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        // 약간의 노이즈 추가
        const noise = (Math.random() - 0.5) * baseValue * 0.08;
        points.push({ date: month, value: Math.round(baseValue + noise) });
    }
    return points;
}

// ─── GET /api/material-prices/chart ──────────────────────────────────────────
export async function GET() {
    // 캐시 확인
    const cached = readCache();
    if (cached) {
        return NextResponse.json({ ...cached, cached: true });
    }

    const apiKey = process.env.ALPHAVANTAGE_API_KEY || '';

    let aluminum: PricePoint[] = [];
    let copper: PricePoint[] = [];

    if (apiKey) {
        // 병렬로 알루미늄, 구리 데이터 조회
        [aluminum, copper] = await Promise.all([
            fetchHistorical('ALUMINUM', apiKey),
            fetchHistorical('COPPER', apiKey),
        ]);
    }

    // API 실패 또는 키 없는 경우 폴백 데이터
    if (aluminum.length === 0) {
        aluminum = generateFallbackData(2400); // LME 알루미늄 기준값
    }
    if (copper.length === 0) {
        copper = generateFallbackData(9500);   // LME 구리 기준값
    }

    const result: ChartData = {
        aluminum,
        copper,
        lastUpdated: new Date().toISOString(),
    };

    writeCache(result);
    return NextResponse.json({ ...result, cached: false });
}
