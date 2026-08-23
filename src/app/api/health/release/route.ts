import { NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { buildReleaseEvidence, loadReleaseEvidenceFile } from '@/lib/releaseHealthEvidence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const env = process.env;
  const i18nReceipt = await loadReleaseEvidenceFile(env.I18N_RELEASE_RECEIPT_PATH ?? 'docs/evidence/release/commercial-i18n-release-receipt.json');
  const sevenDayReceipt = await loadReleaseEvidenceFile(env.SEVEN_DAY_OPERATIONS_RECEIPT_PATH ?? 'docs/evidence/release/seven-day-operations-receipt.json');
  const result = await buildReleaseEvidence({
    env,
    db: (() => { try { return getDbAdapter(); } catch { return undefined; } })(),
    i18nReceipt,
    sevenDayReceipt,
  });
  return NextResponse.json(result, {
    status: result.status === 'PASS' ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
