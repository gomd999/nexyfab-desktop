'use client';

import { useMemo } from 'react';
import {
  hasDesktopPower,
  isTauriApp,
  DESKTOP_POWER_IMPL,
  type DesktopPowerKey,
} from './tauri';

/** 셸이 Tauri인지(타이틀 바·첫 실행 등). 능력 게이트는 `useDesktopPower`. */
export function useIsTauriApp(): boolean {
  return useMemo(() => isTauriApp(), []);
}

export function useDesktopPower(key: DesktopPowerKey): boolean {
  return useMemo(() => hasDesktopPower(key), [key]);
}

/** 리렌더 없이 스냅샷이면 되는 UI용: 모든 키의 현재 가용 여부 */
export function useDesktopPowerSnapshot(): Record<DesktopPowerKey, boolean> {
  return useMemo(() => {
    const shell = isTauriApp();
    const keys = Object.keys(DESKTOP_POWER_IMPL) as DesktopPowerKey[];
    const out = {} as Record<DesktopPowerKey, boolean>;
    for (const k of keys) {
      out[k] = shell && DESKTOP_POWER_IMPL[k];
    }
    return out;
  }, []);
}
