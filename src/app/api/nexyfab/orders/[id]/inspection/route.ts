export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';
import {
  resolveStoredManufacturingLineage,
  type StoredManufacturingLineageColumns,
} from '@/lib/manufacturingLineageDb';
import {
  parseTrustedManufacturingInspectorKeys,
  validateManufacturingInspectionReceipt,
} from '@/lib/manufacturingInspectionReceipt';
import { resolveRequestOrgContext } from '@/lib/org-context';
import { canManageOrderInActiveWorkspace, isOrderBuyerInActiveWorkspace } from '@/lib/nfOrderAccess';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const INSPECTION_RECEIPT_JSON_BYTES = 256 * 1024;

interface OrderRow extends StoredManufacturingLineageColumns {
  id: string;
  user_id: string;
  org_id: string | null;
  manufacturer_id: string | null;
  status: string;
  created_at: number;
}

async function ensureInspectionTable(db: DbAdapter) {
  await db.execute(`CREATE TABLE IF NOT EXISTS nf_manufacturing_inspection_receipts (
    receipt_id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    lineage_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    artifact_sha256 TEXT NOT NULL,
    document_version_id TEXT NOT NULL,
    release_package_sha256 TEXT NOT NULL,
    inspection_report_sha256 TEXT NOT NULL,
    receipt_sha256 TEXT NOT NULL UNIQUE,
    result TEXT NOT NULL,
    inspector_id TEXT NOT NULL,
    inspected_at BIGINT NOT NULL,
    submitted_by TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    UNIQUE(order_id, inspection_report_sha256)
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_mfg_inspection_order ON nf_manufacturing_inspection_receipts(order_id, created_at DESC)');
}

async function readOrder(db: DbAdapter, orderId: string) {
  await db.execute('ALTER TABLE nf_orders ADD COLUMN org_id TEXT').catch(() => {});
  return db.queryOne<OrderRow>(
    `SELECT id, user_id, org_id, manufacturer_id, status, created_at,
            lineage_id, artifact_id, artifact_sha256, document_version_id
       FROM nf_orders WHERE id = ?`,
    orderId,
  );
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const workspace = resolveRequestOrgContext(authUser);
  if (!workspace.ok) return NextResponse.json({ error: 'Select a valid workspace', code: workspace.code }, { status: 409 });
  const { id: orderId } = await params;
  const db = getDbAdapter();
  const order = await readOrder(db, orderId);
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const buyerAccess = isOrderBuyerInActiveWorkspace(authUser, order);
  const manufacturerAccess = order.manufacturer_id === authUser.userId;
  if (!buyerAccess && !manufacturerAccess && authUser.globalRole !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await ensureInspectionTable(db);
  const receipts = await db.queryAll<Record<string, unknown>>(
    `SELECT receipt_id, lineage_id, artifact_id, artifact_sha256, document_version_id,
            release_package_sha256, inspection_report_sha256, receipt_sha256,
            result, inspector_id, inspected_at, created_at
       FROM nf_manufacturing_inspection_receipts WHERE order_id = ? ORDER BY created_at DESC`,
    orderId,
  );
  return NextResponse.json({ receipts }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: orderId } = await params;
  let raw: unknown = null;
  try {
    raw = await readBoundedJson(req, INSPECTION_RECEIPT_JSON_BYTES);
  } catch (error) {
    const bodyError = boundedJsonError(error);
    if (bodyError?.code === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'Request body too large' }, { status: bodyError.status });
    }
  }
  const validation = validateManufacturingInspectionReceipt(raw, parseTrustedManufacturingInspectorKeys());
  if (!validation.ok || !validation.receipt || !validation.receiptSha256) {
    return NextResponse.json({ error: 'Inspection receipt rejected', errors: validation.errors }, { status: 422 });
  }
  const receipt = validation.receipt;
  if (receipt.orderId !== orderId) {
    return NextResponse.json({ error: 'Inspection order binding mismatch' }, { status: 409 });
  }

  const db = getDbAdapter();
  const order = await readOrder(db, orderId);
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const uploaderAuthorized = canManageOrderInActiveWorkspace(authUser, order)
    || order.manufacturer_id === authUser.userId
    || authUser.globalRole === 'super_admin';
  if (!uploaderAuthorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!['qc', 'delivered'].includes(order.status)) {
    return NextResponse.json({ error: 'Order must be in QC or delivered state', code: 'INSPECTION_STAGE_INVALID' }, { status: 409 });
  }
  const lineage = await resolveStoredManufacturingLineage(db, order.user_id, order);
  if (!lineage.ok) {
    return NextResponse.json({ error: 'Manufacturing release is stale or revoked.', code: lineage.code }, { status: 409 });
  }
  if (receipt.lineageId !== lineage.ref.lineageId
    || receipt.artifactId !== lineage.ref.artifactId
    || receipt.artifactSha256 !== lineage.ref.artifactSha256
    || receipt.documentVersionId !== lineage.ref.documentVersionId) {
    return NextResponse.json({ error: 'Inspection receipt does not match the released order artifact', code: 'INSPECTION_ARTIFACT_MISMATCH' }, { status: 409 });
  }
  const inspectedAt = Date.parse(receipt.inspectedAt);
  if (inspectedAt < Number(order.created_at) || inspectedAt > Date.now() + 5 * 60_000) {
    return NextResponse.json({ error: 'Inspection timestamp is outside the order lifecycle', code: 'INSPECTION_TIME_INVALID' }, { status: 409 });
  }

  await ensureInspectionTable(db);
  const inserted = await db.execute(
    `INSERT INTO nf_manufacturing_inspection_receipts
      (receipt_id, order_id, lineage_id, artifact_id, artifact_sha256, document_version_id,
       release_package_sha256, inspection_report_sha256, receipt_sha256, result,
       inspector_id, inspected_at, submitted_by, raw_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(receipt_id) DO NOTHING`,
    receipt.receiptId, orderId, receipt.lineageId, receipt.artifactId, receipt.artifactSha256,
    receipt.documentVersionId, receipt.releasePackageSha256, receipt.inspectionReportSha256,
    validation.receiptSha256, receipt.result, receipt.inspectorId, inspectedAt,
    authUser.userId, JSON.stringify(receipt), Date.now(),
  );
  if (inserted.changes !== 1) {
    const existing = await db.queryOne<{ receipt_sha256: string }>(
      'SELECT receipt_sha256 FROM nf_manufacturing_inspection_receipts WHERE receipt_id = ?',
      receipt.receiptId,
    );
    if (existing?.receipt_sha256 !== validation.receiptSha256) {
      return NextResponse.json({ error: 'Inspection receipt ID conflict', code: 'INSPECTION_RECEIPT_CONFLICT' }, { status: 409 });
    }
    return NextResponse.json({ ok: true, idempotent: true, receiptSha256: validation.receiptSha256, result: receipt.result });
  }
  return NextResponse.json({
    ok: true,
    idempotent: false,
    receiptSha256: validation.receiptSha256,
    result: receipt.result,
    qualityReleaseEligible: receipt.result === 'pass',
  }, { status: 201 });
}
