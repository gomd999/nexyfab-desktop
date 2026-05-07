/**
 * M6 — 서버·클라이언트 공용: `.nfab` sceneData JSON 안의 `meta.nexyfabPdm.lifecycle` 읽기.
 */
import { NFAB_PDM_META_KEY } from '@/lib/nfProjectPdmConstants';

export type NfabSceneLifecycle = 'wip' | 'released';

export function readLifecycleFromNfabSceneData(sceneData: string | null | undefined): NfabSceneLifecycle {
  if (!sceneData || typeof sceneData !== 'string') return 'wip';
  try {
    const root = JSON.parse(sceneData) as { meta?: Record<string, unknown> };
    const pdm = root.meta?.[NFAB_PDM_META_KEY];
    if (!pdm || typeof pdm !== 'object') return 'wip';
    const lc = (pdm as Record<string, unknown>).lifecycle;
    return lc === 'released' ? 'released' : 'wip';
  } catch {
    return 'wip';
  }
}

/**
 * DB에 저장된 씬이 `released`인 경우, 동일 릴리스 상태로의 임의 변경을 막는다.
 * `lifecycle`을 `wip`로 바꾸는 페이로드(언릴리스)만 허용한다.
 */
export function assertReleasedSceneEditAllowed(
  currentSceneData: string | null | undefined,
  incomingSceneData: string | undefined,
): { ok: true } | { ok: false; message: string } {
  if (incomingSceneData === undefined) return { ok: true };
  if (incomingSceneData === currentSceneData) return { ok: true };
  if (readLifecycleFromNfabSceneData(currentSceneData) !== 'released') return { ok: true };
  if (readLifecycleFromNfabSceneData(incomingSceneData) === 'wip') return { ok: true };
  return {
    ok: false,
    message:
      'This project is marked Released in file metadata. Set lifecycle to WIP in PDM fields to edit, or keep the scene unchanged.',
  };
}
