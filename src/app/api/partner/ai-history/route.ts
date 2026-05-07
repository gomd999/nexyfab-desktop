/**
 * GET  /api/partner/ai-history   — 파트너 AI 이력 조회 (partner Bearer 토큰 인증)
 * DELETE /api/partner/ai-history?id=  — 단건 삭제 (본인 소유만)
 *
 * 파트너 전용 엔드포인트. getPartnerAuth로 인증 후 nf_ai_history에서 user_id 기반 조회.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import { listAIHistory, deleteAIHistory } from '@/lib/ai-history';
import type { AIHistoryFeature } from '@/lib/ai-history';

export const dynamic = 'force-dynamic';

const PARTNER_FEATURES = new Set<AIHistoryFeature>([
  'rfq_responder', 'order_priority', 'capacity_match', 'quote_accuracy',
]);

export async function GET(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const featureRaw = searchParams.get('feature');
  const feature = featureRaw && PARTNER_FEATURES.has(featureRaw as AIHistoryFeature)
    ? (featureRaw as AIHistoryFeature)
    : undefined;
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20));

  const records = await listAIHistory({ userId: partner.userId, feature, limit });
  // 파트너 관련 feature만 필터링
  const filtered = feature ? records : records.filter(r => PARTNER_FEATURES.has(r.feature));
  return NextResponse.json({ records: filtered });
}

export async function DELETE(req: NextRequest) {
  const partner = await getPartnerAuth(req);
  if (!partner) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const removed = await deleteAIHistory(partner.userId, id);
  if (!removed) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
