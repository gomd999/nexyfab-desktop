/**
 * Public 폴더의 WASM 등 정적 파일 URL.
 *
 * Next.js `basePath` 를 쓰면 브라우저 기준 경로가 `/myapp/replicad_single.wasm` 형이 됩니다.
 * 그때는 `NEXT_PUBLIC_BASE_PATH` (또는 전용 `NEXT_PUBLIC_STATIC_PREFIX`) 를
 * next.config 의 basePath 와 동일하게 설정하세요. 예: `/myapp` (끝 슬래시 없음)
 *
 * 비어 있으면 루트 배포와 동일하게 `/파일명` 만 사용합니다.
 */
export function publicWasmUrl(wasmFileName: string): string {
  const name = wasmFileName.replace(/^\//, '');
  const prefix =
    (typeof process !== 'undefined' &&
      (process.env.NEXT_PUBLIC_BASE_PATH || process.env.NEXT_PUBLIC_STATIC_PREFIX || '')
        .trim()
        .replace(/\/$/, '')) ||
    '';
  return prefix ? `${prefix}/${name}` : `/${name}`;
}
