/**
 * GET /api/nexyfab/ai-history
 *
 * List the current user's recent AI feature outputs (Cost Copilot, Process
 * Router, Supplier Top-3, DFM Explainer). Backs the "📜 AI 이력" panel.
 *
 * Query params:
 *   ?feature=cost_copilot | process_router | ai_supplier_match | dfm_insights  (optional filter)
 *   ?limit=30                                                                   (1-100, default 30)
 *
 * DELETE /api/nexyfab/ai-history?id=...  removes a single record (owned-only).
 */

import { NextRequest, NextResponse } from 'next/server';
import type { AIHistoryFeature } from '@/lib/ai-history';

const VALID_FEATURES = new Set<AIHistoryFeature>([
  'cost_copilot', 'process_router', 'ai_supplier_match', 'dfm_insights',
  'rfq_writer', 'cert_filter', 'rfq_responder', 'quote_negotiator', 'order_priority', 'change_detector', 'capacity_match', 'quote_accuracy',
]);

export async function GET(req: NextRequest) {
  const { checkPlan } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const { searchParams } = new URL(req.url);
  const featureRaw = searchParams.get('feature');
  const feature = featureRaw && VALID_FEATURES.has(featureRaw as AIHistoryFeature)
    ? (featureRaw as AIHistoryFeature)
    : undefined;
  const projectId = searchParams.get('projectId') ?? undefined;
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '30', 10) || 30));

  const { listAIHistory } = await import('@/lib/ai-history');
  const records = await listAIHistory({ userId: planCheck.userId, feature, projectId, limit });
  return NextResponse.json({ records });
}

export async function DELETE(req: NextRequest) {
  const { checkPlan } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { deleteAIHistory } = await import('@/lib/ai-history');
  const removed = await deleteAIHistory(planCheck.userId, id);
  if (!removed) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
