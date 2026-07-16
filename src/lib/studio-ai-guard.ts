/**
 * 스튜디오 AI 공용 가드 (2026-07-16 구독 정합) — drawing 계열 AI 라우트
 * (compose·assemble·edit-intent·extract·extract-preset)에 eng-chat과 동일 정책 적용.
 *
 * - 로그인: 일일 비용예산 + shape_chat 월 슬롯 소모(Free 30/월 — 챗·스튜디오 통합
 *   카운트, Pro=무제한 가치 성립)
 * - 익명: 슬롯 없음(게스트 데모 정책 유지) 대신 스튜디오 AI 합산 레이트리밋으로
 *   비용 방어(개별 라우트 리밋과 별도)
 *
 * 반환: 차단 시 NextResponse, 통과 시 null.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan, consumeMonthlyMetricSlot } from '@/lib/plan-guard';
import { checkUserBudget } from '@/lib/ai/userBudget';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export async function guardStudioAi(req: NextRequest): Promise<NextResponse | null> {
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) {
    // 익명 — 스튜디오 AI 전체 합산 10/min (개별 라우트 리밋은 그대로 추가 적용)
    const ip = getTrustedClientIp(req.headers);
    const rl = rateLimit(`studio-ai-anon:${ip}`, 10, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: '게스트 AI 사용량을 잠시 초과했습니다. 가입(무료)하면 더 여유있게 쓸 수 있어요.' },
        { status: 429 },
      );
    }
    return null;
  }
  const budget = await checkUserBudget(planCheck.userId);
  if (!budget.ok) {
    return NextResponse.json(
      { ok: false, error: `일일 AI 사용 한도($${budget.limitUsd})에 도달했습니다. 내일 다시 시도하세요.`, code: 'COST_BUDGET', resetAtMs: budget.resetAtMs },
      { status: 402 },
    );
  }
  const slot = await consumeMonthlyMetricSlot(planCheck.userId, planCheck.plan, 'shape_chat');
  if (!slot.ok) {
    return NextResponse.json(
      { ok: false, error: `무료 플랜 월 한도(${slot.limit}회)에 도달했습니다. Pro로 업그레이드하면 무제한입니다.`, code: 'PLAN_LIMIT' },
      { status: 429 },
    );
  }
  return null;
}
