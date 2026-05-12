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

  // Round 32: when a Pro gate fires, also stash a PendingIntent so the user
  // can resume the action after upgrading or signing up. The intent kind is
  // derived from the `feature` string the caller already passes — keeps the
  // call sites unchanged.
  const stashPaywallIntent = (feature: string) => {
    if (typeof window === 'undefined') return;
    void import('@/lib/pending-intents').then(({ stashPendingIntent }) => {
      const now = Date.now();
      switch (feature) {
        case 'dfm':   stashPendingIntent({ kind: 'run_dfm_analysis', stashedAt: now }); break;
        case 'fea':   stashPendingIntent({ kind: 'run_fea_analysis', stashedAt: now }); break;
        case 'rfq':   stashPendingIntent({ kind: 'request_quote',    stashedAt: now }); break;
        case 'share': stashPendingIntent({ kind: 'create_share_link', stashedAt: now }); break;
        default: break;
      }
    }).catch(() => { /* swallow */ });
  };

  const requirePro = (feature: string, fn: () => void) => {
    if (feature === 'dfm' && !dfmAnalysisAllowed(authUser?.plan)) {
      setUpgradeFeature('DFM 분석');
      setShowUpgradePrompt(true);
      stashPaywallIntent('dfm');
      return;
    }
    if (!planLimits.feaAnalysis && feature === 'fea') {
      setUpgradeFeature('FEA 응력 해석');
      setShowUpgradePrompt(true);
      stashPaywallIntent('fea');
      return;
    }
    if (!planLimits.ipShareLink && feature === 'share') {
      setUpgradeFeature('IP 보호 공유 링크');
      setShowUpgradePrompt(true);
      stashPaywallIntent('share');
      return;
    }
    if (!planLimits.rfq && feature === 'rfq') {
      setUpgradeFeature('견적 요청');
      setShowUpgradePrompt(true);
      stashPaywallIntent('rfq');
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

  // Project count gate — server enforces hard limit; this surfaces it as a
  // proper upgrade prompt instead of a generic "Cloud save failed" toast.
  // Pass the boolean from useCloudSaveFlow.projectLimitReached.
  const triggerProjectLimitPrompt = () => {
    setUpgradeFeature('프로젝트 추가 (무료: 1개)');
    setShowUpgradePrompt(true);
    // Funnel: 2nd-project paywall surfaced. dedupe per session via window flag
    // so reload doesn't double-count, but multiple attempts within the same
    // session also count just once (we want unique surface, not click count).
    if (typeof window !== 'undefined') {
      const flag = '__nexyfab_paywall_shown_session';
      const w = window as unknown as Record<string, unknown>;
      if (w[flag]) return;
      w[flag] = true;
      void fetch('/api/nexyfab/funnel-event', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'paywall_shown',
          contextType: 'paywall',
          contextId: 'project_limit',
        }),
      }).catch(() => { /* ignore */ });
    }
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
    triggerProjectLimitPrompt,
  };
}
