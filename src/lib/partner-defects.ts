/**
 * partner-defects.ts — 불량·RMA 제기 스키마 + 도메인 로직 (Phase 7-5d).
 *
 * Design note (2026-04-23):
 *   리뷰는 "별점" 차원. 불량은 "사건" 차원. 두 개를 섞으면 심각한 불량 1건이
 *   별점 평균에 묻히거나, 반대로 사소한 민원이 별점을 과도하게 깎을 수 있어
 *   차원을 분리해서 저장·집계한다.
 *
 *   상태 전이:
 *     reported  → under_review (공급사 확인 시작)
 *     under_review → approved  (공급사가 불량 인정, RMA 번호 발급)
 *     under_review → rejected  (공급사 반박)
 *     approved  → resolved     (교환·환불 완료 후 구매자 확인)
 *     rejected  → disputed     (구매자 이의 제기 — 관리자 개입)
 *
 *   metric 이벤트:
 *     defect_reported  (POST 시점)   — 부정 신호
 *     defect_resolved  (resolved 전이) — 해결률 차원
 */
import { getDbAdapter } from './db-adapter';

export type DefectStatus =
  | 'reported'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'resolved'
  | 'disputed';

export type DefectSeverity = 'minor' | 'major' | 'critical';

export type DefectKind =
  | 'wrong_part'
  | 'damaged'
  | 'out_of_spec'
  | 'missing_quantity'
  | 'late_delivery'
  | 'other';

export interface DefectRow {
  id: string;
  order_id: string;
  reporter_email: string;
  partner_email: string | null;
  status: DefectStatus;
  severity: DefectSeverity;
  kind: DefectKind;
  description: string;
  photo_keys: string | null;        // JSON array of R2 object keys
  rma_number: string | null;
  rma_instructions: string | null;
  partner_response: string | null;
  resolution_note: string | null;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface Defect {
  id: string;
  orderId: string;
  reporterEmail: string;
  partnerEmail: string | null;
  status: DefectStatus;
  severity: DefectSeverity;
  kind: DefectKind;
  description: string;
  photoKeys: string[];
  rmaNumber: string | null;
  rmaInstructions: string | null;
  partnerResponse: string | null;
  resolutionNote: string | null;
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function rowToDefect(r: DefectRow): Defect {
  let photos: string[] = [];
  try { photos = r.photo_keys ? JSON.parse(r.photo_keys) as string[] : []; } catch { /* ignore */ }
  return {
    id: r.id,
    orderId: r.order_id,
    reporterEmail: r.reporter_email,
    partnerEmail: r.partner_email,
    status: r.status,
    severity: r.severity,
    kind: r.kind,
    description: r.description,
    photoKeys: photos,
    rmaNumber: r.rma_number,
    rmaInstructions: r.rma_instructions,
    partnerResponse: r.partner_response,
    resolutionNote: r.resolution_note,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

let ensured = false;

export async function ensureDefectsTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (ensured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_defects (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      reporter_email TEXT NOT NULL,
      partner_email TEXT,
      status TEXT NOT NULL,
      severity TEXT NOT NULL,
      kind TEXT NOT NULL,
      description TEXT NOT NULL,
      photo_keys TEXT,
      rma_number TEXT,
      rma_instructions TEXT,
      partner_response TEXT,
      resolution_note TEXT,
      resolved_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_defects_order   ON nf_defects(order_id, created_at DESC)').catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_defects_partner ON nf_defects(partner_email, status)').catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_defects_reporter ON nf_defects(reporter_email, created_at DESC)').catch(() => {});
  ensured = true;
}

/** 전이 가능 여부 — 불법 상태 조합 사전 차단 */
export function isValidTransition(from: DefectStatus, to: DefectStatus): boolean {
  const allowed: Record<DefectStatus, DefectStatus[]> = {
    reported:     ['under_review', 'rejected'],
    under_review: ['approved', 'rejected'],
    approved:     ['resolved'],
    rejected:     ['disputed'],
    resolved:     [],
    disputed:     ['approved', 'rejected'],
  };
  return allowed[from]?.includes(to) ?? false;
}

export const VALID_SEVERITIES: DefectSeverity[] = ['minor', 'major', 'critical'];
export const VALID_KINDS: DefectKind[] = [
  'wrong_part', 'damaged', 'out_of_spec', 'missing_quantity', 'late_delivery', 'other',
];

/** RMA 번호 생성 — 고유 + 인쇄·메일 친화적 포맷 */
export function generateRmaNumber(): string {
  const yyyy = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RMA-${yyyy}-${rand}`;
}
