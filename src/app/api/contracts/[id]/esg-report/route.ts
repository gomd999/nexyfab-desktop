import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';
import {
  calculateCO2, SUPPORTED_PROCESSES, SUPPORTED_MATERIALS,
  getProcessLabel, getMaterialLabel,
  type ManufacturingProcess, type MaterialType,
} from '@/lib/esg-calculator';

export const dynamic = 'force-dynamic';

async function ensureTable() {
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_esg_reports (
      id          TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      inputs      TEXT NOT NULL,
      results     TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_esg_contract ON nf_esg_reports(contract_id, user_id);
  `).catch(() => {});
}

// GET — fetch latest ESG report for contract
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { meetsPlan } = await import('@/lib/plan-guard');
  if (!meetsPlan(authUser.plan, 'team')) return NextResponse.json({ error: 'Team plan required for ESG reports.' }, { status: 403 });
  const { id: contractId } = await params;

  await ensureTable();
  const db = getDbAdapter();
  const report = await db.queryOne<{ id: string; inputs: string; results: string; created_at: number }>(
    'SELECT id, inputs, results, created_at FROM nf_esg_reports WHERE contract_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1',
    contractId, authUser.userId,
  );

  if (!report) {
    return NextResponse.json({
      report: null,
      supportedProcesses: SUPPORTED_PROCESSES.map(p => ({ value: p, label: getProcessLabel(p) })),
      supportedMaterials: SUPPORTED_MATERIALS.map(m => ({ value: m, label: getMaterialLabel(m) })),
    });
  }

  return NextResponse.json({
    report: {
      id: report.id,
      contractId,
      inputs: JSON.parse(report.inputs),
      results: JSON.parse(report.results),
      createdAt: new Date(report.created_at).toISOString(),
    },
    supportedProcesses: SUPPORTED_PROCESSES.map(p => ({ value: p, label: getProcessLabel(p) })),
    supportedMaterials: SUPPORTED_MATERIALS.map(m => ({ value: m, label: getMaterialLabel(m) })),
  });
}

// POST — calculate and save ESG report
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: contractId } = await params;

  const schema = z.object({
    process: z.enum([
      'cnc_milling', 'cnc_turning', 'sheet_metal', 'injection_molding',
      'die_casting', 'sand_casting', 'welding', 'laser_cutting',
      'wire_edm', 'fdm_3dprint', 'sla_3dprint', 'surface_treatment', 'assembly',
    ]),
    material: z.enum([
      'aluminum_6061', 'aluminum_7075', 'stainless_steel_304', 'stainless_steel_316',
      'carbon_steel', 'titanium', 'copper', 'brass',
      'abs_plastic', 'pc_plastic', 'nylon', 'peek', 'pom',
    ]),
    weightKg: z.number().positive().max(10_000),
    materialUtilizationPct: z.number().min(1).max(100).default(70),
    quantity: z.number().int().min(1).max(100_000).default(1),
    transportKm: z.number().min(0).max(50_000).default(0),
    transportMode: z.enum(['truck', 'air', 'sea']).default('truck'),
    electricityKwhPerKg: z.number().positive().optional(),
  });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const result = calculateCO2({
    process: parsed.data.process as ManufacturingProcess,
    material: parsed.data.material as MaterialType,
    weightKg: parsed.data.weightKg,
    materialUtilizationPct: parsed.data.materialUtilizationPct,
    quantity: parsed.data.quantity,
    transportKm: parsed.data.transportKm,
    transportMode: parsed.data.transportMode,
    electricityKwhPerKg: parsed.data.electricityKwhPerKg,
  });

  await ensureTable();
  const db = getDbAdapter();
  const id = `esg-${crypto.randomUUID()}`;
  const now = Date.now();

  await db.execute(
    `INSERT INTO nf_esg_reports (id, contract_id, user_id, inputs, results, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id, contractId, authUser.userId,
    JSON.stringify(parsed.data),
    JSON.stringify(result),
    now,
  );

  // Enrich result with human-readable labels
  return NextResponse.json({
    report: {
      id,
      contractId,
      inputs: {
        ...parsed.data,
        processLabel: getProcessLabel(parsed.data.process as ManufacturingProcess),
        materialLabel: getMaterialLabel(parsed.data.material as MaterialType),
      },
      results: result,
      createdAt: new Date(now).toISOString(),
    },
    summary: {
      totalCO2eKg: result.totalCO2e,
      equivalent: {
        carKm: Math.round(result.totalCO2e / 0.21),    // 0.21 kg CO₂/km avg car
        treeDays: Math.round(result.totalCO2e / 0.022), // tree absorbs ~8kg/year = 0.022/day
        flightMinutes: Math.round(result.totalCO2e / 0.255), // short-haul ~0.255 kg CO₂/min
      },
    },
  }, { status: 201 });
}
