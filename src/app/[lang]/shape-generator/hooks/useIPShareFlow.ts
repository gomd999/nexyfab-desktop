import { useState } from 'react';
import type { AuthUser } from '@/hooks/useAuth';
import { useIPShare } from '../freemium/useIPShare';
import type { ShapeResult } from '../shapes';
import type { PlanLimits } from '../freemium/planLimits';
import type { Toast } from '../useToast';

type AddToast = (type: Toast['type'], msg: string) => void;

export function useIPShareFlow(
  effectiveResult: ShapeResult | null,
  authUser: AuthUser | null,
  lang: string,
  addToast: AddToast,
) {
  const {
    createShareLink,
    copyToClipboard: copyShareUrl,
    isCreating: isCreatingShare,
    shareUrl,
    reset: resetShare,
  } = useIPShare();

  const [showShareConfirm, setShowShareConfirm] = useState(false);

  const handleIPShare = async (
    planLimits: PlanLimits,
    materialId: string,
    selectedId: string,
    setShowUpgradePrompt: (v: boolean) => void,
    setUpgradeFeature: (f: string) => void,
  ) => {
    if (!planLimits.ipShareLink) {
      setUpgradeFeature('IP 보호 공유 링크');
      setShowUpgradePrompt(true);
      return;
    }
    if (!effectiveResult) return;
    if (shareUrl) {
      setShowShareConfirm(true);
      return;
    }
    const url = await createShareLink(effectiveResult, {
      name: selectedId || 'design',
      material: materialId,
      lang,
      watermark: authUser?.name ? `NexyFab · ${authUser.name}` : 'NexyFab · No Download',
    });
    if (url) setShowShareConfirm(true);
  };

  return {
    isCreatingShare,
    shareUrl,
    showShareConfirm,
    setShowShareConfirm,
    handleIPShare,
    copyShareUrl,
    resetShare,
  };
}
