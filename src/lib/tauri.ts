/**
 * Tauri 환경 감지 + 파일 I/O 브릿지
 * - Tauri 데스크톱: @tauri-apps/api 사용
 * - 웹: 브라우저 File API / R2 사용
 *
 * 투트랙: 웹에서도 핵심 플로우는 유지하고, 브라우저에서 비현실적으로 어려운 작업만
 * `hasDesktopPower(...)` 로 게이트한다. 웹에서는 항상 false, Tauri에서는 아래 맵에
 * 따라 true/false (미구현 능력은 Tauri여도 false 유지).
 */

export const isTauriApp = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI_INTERNALS__?: unknown };
  // `in` alone is true for `{ __TAURI_INTERNALS__: undefined }`; real web has no key.
  return w.__TAURI_INTERNALS__ != null;
};

/** Tauri에서 구현 완료된 “고난도” 능력만 true. 웹은 `hasDesktopPower`가 전부 false. */
export const DESKTOP_POWER_IMPL = {
  /** 프로젝트 .nfab 네이티브 경로, fs, 최근 파일 */
  nativeFilesystem: true,
  /** STL/STEP 등 대용량을 다이얼로그로 직접 디스크에 기록 (다운로드 폴더 UX 대체) */
  directDiskExport: true,
  /** 시스템 기본 브라우저로 URL */
  systemBrowser: true,
  /** `patchFetchForTauri` — 로컬 번들에서 /api → 프로덕션 */
  backendProxy: true,
  /** 향후: 사이드카 CLI, 오프라인 배치, 대용량 로컬 전처리 등 */
  nativeSidecar: false,
} as const;

export type DesktopPowerKey = keyof typeof DESKTOP_POWER_IMPL;

/** 웹은 항상 false. React 훅은 `@/lib/useDesktopPower`. */
export function hasDesktopPower(key: DesktopPowerKey): boolean {
  if (!isTauriApp()) return false;
  return DESKTOP_POWER_IMPL[key];
}

/** Tauri 데스크톱에서 상대 /api 경로를 nexyfab.com으로 리다이렉트하는 fetch 패치 */
export function patchFetchForTauri(): void {
  if (!hasDesktopPower('backendProxy')) return;
  const BASE = 'https://nexyfab.com';
  const original = window.fetch.bind(window);
  window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    if (typeof input === 'string' && input.startsWith('/api')) {
      return original(BASE + input, init);
    }
    if (input instanceof Request && input.url.startsWith('/api')) {
      const patched = new Request(BASE + input.url, input);
      return original(patched, init);
    }
    return original(input, init);
  };
}

// ─── 파일 저장 ────────────────────────────────────────────────────────────────

export async function saveFileDesktop(filename: string, content: string): Promise<void> {
  if (!hasDesktopPower('nativeFilesystem')) throw new Error('Not in Tauri environment');
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  const { invoke } = await import('@tauri-apps/api/core');

  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'NexyFab Project', extensions: ['nfab'] }],
  });
  if (!path) return; // 사용자가 취소
  await writeTextFile(path, content);
  await invoke('add_recent_file', { path });
}

// ─── 파일 열기 ────────────────────────────────────────────────────────────────

export async function openFileDesktop(): Promise<{ path: string; content: string } | null> {
  if (!hasDesktopPower('nativeFilesystem')) throw new Error('Not in Tauri environment');
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  const { invoke } = await import('@tauri-apps/api/core');

  const path = await open({
    multiple: false,
    filters: [{ name: 'NexyFab Project', extensions: ['nfab'] }],
  });
  if (!path || Array.isArray(path)) return null;
  const content = await readTextFile(path as string);
  await invoke('add_recent_file', { path });
  return { path: path as string, content };
}

// ─── STL/STEP 내보내기 ────────────────────────────────────────────────────────

export async function exportFileDesktop(filename: string, content: string, ext: string): Promise<void> {
  if (!hasDesktopPower('directDiskExport')) throw new Error('Not in Tauri environment');
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');

  const path = await save({
    defaultPath: filename,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (!path) return;
  await writeTextFile(path, content);
}

// ─── 최근 파일 목록 ───────────────────────────────────────────────────────────

export async function getRecentFiles(): Promise<string[]> {
  if (!hasDesktopPower('nativeFilesystem')) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string[]>('get_recent_files');
}

// ─── 앱 버전 ─────────────────────────────────────────────────────────────────

export async function getDesktopVersion(): Promise<string> {
  if (!isTauriApp()) return '';
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('get_app_version');
}

// ─── 시스템 브라우저로 URL 열기 ──────────────────────────────────────────────

export async function openUrlInBrowser(url: string): Promise<void> {
  if (!hasDesktopPower('systemBrowser')) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch {
    // shell plugin 미지원 환경 fallback
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
