/**
 * Tauri 환경 감지 + 파일 I/O 브릿지
 * - Tauri 데스크톱: @tauri-apps/api 사용
 * - 웹: 브라우저 File API / R2 사용
 */

export const isTauriApp = (): boolean => {
  if (typeof window === 'undefined') return false;
  return typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
};

/** Tauri 데스크톱에서 상대 /api 경로를 nexyfab.com으로 리다이렉트하는 fetch 패치 */
export function patchFetchForTauri(): void {
  if (!isTauriApp()) return;
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
  if (!isTauriApp()) throw new Error('Not in Tauri environment');
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
  if (!isTauriApp()) throw new Error('Not in Tauri environment');
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
  if (!isTauriApp()) throw new Error('Not in Tauri environment');
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
  if (!isTauriApp()) return [];
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
  if (!isTauriApp()) {
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
