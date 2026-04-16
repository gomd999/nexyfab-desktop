import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { getAuthUser } from '@/lib/auth-middleware';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const CACHE_FILE = path.join(process.cwd(), 'data', 'material-prices-cache.json');

// Machine hourly rates (KRW/hour) — industry averages Korea
const MACHINE_RATES: Record<string, number> = {
  cnc:               85_000,
  cnc_milling:       85_000,
  cnc_turning:       70_000,
  injection_molding: 60_000,
  die_casting:       90_000,
  sheet_metal:       55_000,
  '3d_printing':     45_000,
  forging:          120_000,
};

// Setup fees (KRW per order)
const SETUP_FEES: Record<string, number> = {
  cnc:               150_000,
  cnc_milling:       150_000,
  cnc_turning:       100_000,
  injection_molding: 800_000, // mold setup
  die_casting:     1_200_000,
  sheet_metal:       200_000,
  '3d_printing':      50_000,
  forging:           500_000,
};

// Material density (g/cm³)
const DENSITIES: Record<string, number> = {
  aluminum_6061: 2.70,
  steel_s45c:    7.85,
  stainless_304: 7.93,
  brass:         8.50,
  titanium:      4.51,
  abs_plastic:   1.05,
  pom:           1.41,
  pc:            1.20,
};

// Material waste factor (material purchased vs used)
const WASTE_FACTORS: Record<string, number> = {
  aluminum_6061: 1.4,
  steel_s45c:    1.35,
  stainless_304: 1.4,
  brass:         1.3,
  titanium:      1.5,
  abs_plastic:   1.1,
  pom:           1.1,
  pc:            1.1,
};

// Estimated machining time (hours) based on complexity and volume
function estimateMachiningHours(volume_cm3: number, complexity: number, process: string): number {
  const baseTime = Math.pow(volume_cm3, 0.4) * 0.05; // empirical: larger = more time, diminishing
  const complexityFactor = 0.5 + (complexity / 10) * 1.5; // 0.5x at complexity=0, 2.0x at complexity=10
  const processFactor = process === 'cnc' || process === 'cnc_milling' ? 1.0
    : process === 'injection_molding' ? 0.3 // fast cycle once mold ready
    : process === '3d_printing' ? 2.5
    : process === 'forging' ? 0.5
    : 1.0;
  return Math.max(0.5, baseTime * complexityFactor * processFactor);
}

const estimateSchema = z.object({
  materialId: z.string().min(1).max(50),
  volume_cm3: z.number().min(0.001).max(100_000),
  surface_area_cm2: z.number().min(0).optional(),
  complexity: z.number().min(1).max(10).default(5),
  quantity: z.number().int().min(1).max(100_000).default(1),
  processes: z.array(z.string()).min(1).max(5).optional(),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = rateLimit(`estimate:${ip}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const parsed = estimateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const { materialId, volume_cm3, complexity, quantity, processes: requestedProcesses } = parsed.data;

  // Load material prices from cache
  let materialPriceKrwPerKg = 5_000; // fallback
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      materialPriceKrwPerKg = cache?.prices?.[materialId] ?? 5_000;
    }
  } catch { /* use fallback */ }

  const density = DENSITIES[materialId] ?? 2.7;
  const wasteFactor = WASTE_FACTORS[materialId] ?? 1.3;
  const weightKg = (volume_cm3 / 1000) * density; // cm³ → L → kg (density in g/cm³)
  const materialCost = weightKg * materialPriceKrwPerKg * wasteFactor;

  // Determine applicable processes for this material
  const isPlastic = ['abs_plastic', 'pom', 'pc'].includes(materialId);
  const defaultProcesses = isPlastic ? ['injection_molding', '3d_printing', 'cnc'] : ['cnc', 'sheet_metal', 'die_casting'];
  const targetProcesses = requestedProcesses ?? defaultProcesses;

  const estimates = targetProcesses.map(process => {
    const processKey = process as string;
    const machineRate = MACHINE_RATES[processKey] ?? 80_000;
    const setupFee = SETUP_FEES[processKey] ?? 200_000;
    const machineHours = estimateMachiningHours(volume_cm3, complexity, processKey);

    // Per-unit calculations
    const machiningCostPerUnit = machineRate * machineHours;
    const setupCostPerUnit = setupFee / quantity; // amortized over quantity
    const unitCostBase = materialCost + machiningCostPerUnit + setupCostPerUnit;

    // Quantity breaks
    const qtyFactor = quantity >= 1000 ? 0.65
      : quantity >= 100 ? 0.78
      : quantity >= 10 ? 0.90
      : 1.0;

    const unitCost = Math.round(unitCostBase * qtyFactor);
    const totalCost = Math.round(unitCost * quantity);

    // Lead time estimate (working days)
    const leadTimeDays = process === 'injection_molding' ? '15-30일'
      : process === 'die_casting' ? '20-40일'
      : process === 'forging' ? '20-35일'
      : process === '3d_printing' ? '3-7일'
      : `${Math.ceil(5 + complexity * 1.5 + Math.log(quantity + 1) * 2)}-${Math.ceil(8 + complexity * 2 + Math.log(quantity + 1) * 3)}일`;

    const confidence = complexity <= 3 ? 'high' : complexity <= 7 ? 'medium' : 'low';

    return {
      process: processKey,
      unitCost,
      totalCost,
      leadTime: leadTimeDays,
      confidence,
      breakdown: {
        materialCost: Math.round(materialCost),
        machiningCost: Math.round(machiningCostPerUnit),
        setupCost: Math.round(setupCostPerUnit),
        qtyDiscount: `${Math.round((1 - qtyFactor) * 100)}%`,
      },
    };
  });

  // Sort by unitCost ascending
  estimates.sort((a, b) => a.unitCost - b.unitCost);

  return NextResponse.json({
    materialId,
    volume_cm3,
    weightKg: Math.round(weightKg * 1000) / 1000,
    quantity,
    complexity,
    estimates,
    currency: 'KRW',
    disclaimer: '이 견적은 참고용입니다. 실제 가격은 파트너 견적을 통해 확인하세요.',
    generatedAt: new Date().toISOString(),
  });
}
