import { useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { getPlanLimits, type PlanLimits } from '../freemium/planLimits';

export function useFreemiumGate() {
  const authUser = useAuthStore(s => s.user);
  const planLimits: PlanLimits = getPlanLimits(authUser?.plan);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState('');

  const requirePro = (feature: string, fn: () => void) => {
    if (!planLimits.dfmAnalysis && feature === 'dfm') {
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

  return {
    authUser,
    planLimits,
    showUpgradePrompt,
    setShowUpgradePrompt,
    upgradeFeature,
    setUpgradeFeature,
    requirePro,
    checkCartLimit,
  };
}
