import { useMemo, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { getPlanLimits, mergePlanLimitsWithBmStage, type PlanLimits } from '../freemium/planLimits';
import { dfmAnalysisAllowed } from '../freemium/freeDfmAllowance';
import type { Stage } from '@/lib/stage-engine';

export function useFreemiumGate() {
  const authUser = useAuthStore(s => s.user);
  const stage = (authUser?.nexyfabStage ?? 'A') as Stage;
  const planLimits: PlanLimits = useMemo(
    () => mergePlanLimitsWithBmStage(getPlanLimits(authUser?.plan), stage),
    [authUser?.plan, stage],
  );
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState('');

  const requirePro = (feature: string, fn: () => void) => {
    if (feature === 'dfm' && !dfmAnalysisAllowed(authUser?.plan)) {
      setUpgradeFeature('DFM 분석');
      setShowUpgradePrompt(true);
      return;
    }
    if (!planLimits.feaAnalysis && feature === 'fea') {
      setUpgradeFeature('FEA 응력 해석');
      setShowUpgradePrompt(true);
      return;
    }
    if (!planLimits.ipShareLink && feature === 'share') {
      setUpgradeFeature('IP 보호 공유 링크');
      setShowUpgradePrompt(true);
      return;
    }
    if (!planLimits.rfq && feature === 'rfq') {
      setUpgradeFeature('견적 요청');
      setShowUpgradePrompt(true);
      return;
    }
    fn();
  };

  // 카트에 추가 가능한지 확인 (free: 1개 제한)
  const checkCartLimit = (currentCartCount: number): boolean => {
    if (currentCartCount < planLimits.maxCartItems) return true;
    setUpgradeFeature('형상 추가 (무료: 1개)');
    setShowUpgradePrompt(true);
    return false;
  };

  // Photoreal render: free 플랜은 1회 체험 후 업그레이드 유도
  // Pro 이상은 무제한. 카운터는 localStorage 기반 (기기별 1회).
  const PHOTO_REAL_KEY = 'nexyfab.photoRealUsed';
  const requirePhotoReal = (fn: () => void) => {
    const plan = authUser?.plan ?? 'free';
    if (plan !== 'free') { fn(); return; }
    if (typeof window === 'undefined') { fn(); return; }
    const used = parseInt(window.localStorage.getItem(PHOTO_REAL_KEY) ?? '0', 10) || 0;
    if (used >= 1) {
      setUpgradeFeature('사실적 렌더링 (무료: 1회)');
      setShowUpgradePrompt(true);
      return;
    }
    window.localStorage.setItem(PHOTO_REAL_KEY, String(used + 1));
    fn();
  };

  return {
    authUser,
    planLimits,
    showUpgradePrompt,
    setShowUpgradePrompt,
    upgradeFeature,
    setUpgradeFeature,
    requirePro,
    requirePhotoReal,
    checkCartLimit,
  };
}
