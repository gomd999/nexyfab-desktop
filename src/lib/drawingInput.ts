/**
 * 도면·이미지 입력의 **단일 소스** — 허용 타입·크기·등급 판정.
 *
 * ## 왜 파일을 따로 두나
 * 실측: `image/png,image/jpeg,image/webp` 가 **6곳에 각각** 적혀 있었다
 * (`extract` · `extract-preset` · `intent-from-image` 라우트 3곳 + ChatHero ·
 * AssemblyPresetPanel 의 `accept` 속성 2곳 + 클라 정규식). 붙여넣기·드래그를 더하면
 * 여덟 곳이 된다. 이 세션에 **같은 단일소스 결손으로 여섯 번 틀렸다** — 입력 타입에서
 * 일곱 번째를 만들지 않는다.
 *
 * ## 입력 등급 — **엔진이 정한다, 사용자가 고르지 않는다**
 * 「도면인가요 사진인가요」를 물으면 잘못 고른다. 사진을 도면이라 하고 올린 뒤
 * 「왜 치수를 무시하냐」가 된다. 파일 성질로 판정한다:
 * ```
 *   A  STEP/STL        치수가 파일 안에 있다 — 추정 0
 *   B  DXF · 벡터 PDF   치수를 도면에서 읽는다 — 읽은 것/추정한 것을 항목별로 표기
 *   C  래스터(사진·스캔) 치수는 text 가 나른다 — 이미지는 형상 힌트
 * ```
 * ⚠ **PDF 는 하나가 아니다.** 벡터 PDF(CAD Export)는 선분·원호·문자가 좌표로 들어 있어
 *   DXF 급이고, 스캔 PDF 는 픽셀뿐이라 사진 급이다. 같은 확장자로 한 덩어리로 다루면
 *   벡터를 올린 사람은 「왜 치수를 안 읽냐」, 스캔을 올린 사람은 「왜 틀리냐」가 된다.
 */

/** 래스터 이미지 — 붙여넣기·드래그·파일선택 전부 이 목록을 쓴다. */
export const RASTER_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** 벡터 도면 — 좌표가 들어 있어 치수를 읽을 수 있다. */
export const VECTOR_MIME = ['application/pdf', 'image/svg+xml'] as const;
/** 3D 모델 — 치수가 형상 자체에 있다(추정 없음). */
export const MODEL_EXT = ['.step', '.stp', '.stl', '.iges', '.igs'] as const;

/** `<input accept>` 문자열 — 속성에 직접 적지 말고 이걸 쓴다. */
export const ACCEPT_RASTER = RASTER_MIME.join(',');
export const ACCEPT_ALL = [...RASTER_MIME, ...VECTOR_MIME, ...MODEL_EXT].join(',');

/** 6MB — 라우트와 클라가 같은 값을 봐야 「올렸는데 서버가 거부」가 안 생긴다. */
export const MAX_IMAGE_BYTES = 6_000_000;

export type InputGrade = 'model' | 'vector' | 'raster' | 'text';

/**
 * 파일 → 입력 등급. **확장자·MIME 만으로 판정한다**(내용 검사는 서버 몫).
 * ⚠ PDF 는 여기서 `vector` 로 두되, **벡터 오브젝트가 실제로 있는지는 서버가 확인**하고
 *   없으면 `raster` 로 강등해 알린다. 클라가 「벡터입니다」라고 단정하면 안 된다.
 */
export function gradeOf(file: { name?: string; type?: string }): InputGrade {
  const name = (file.name ?? '').toLowerCase();
  const type = (file.type ?? '').toLowerCase();
  if (MODEL_EXT.some((e) => name.endsWith(e))) return 'model';
  if ((VECTOR_MIME as readonly string[]).includes(type) || name.endsWith('.dxf') || name.endsWith('.svg')) return 'vector';
  if ((RASTER_MIME as readonly string[]).includes(type)) return 'raster';
  return 'text';
}

/** 등급별 안내 — 화면이 「이 입력으로 무엇이 보장되는가」를 말할 수 있게. */
export const GRADE_NOTE: Record<InputGrade, { ko: string; en: string }> = {
  model: { ko: '치수를 파일에서 그대로 읽습니다(추정 없음).', en: 'Dimensions come from the file itself (no estimation).' },
  vector: { ko: '도면에서 치수를 읽습니다. 못 읽은 값은 표시하고 물어봅니다.', en: 'Dimensions are read from the drawing; anything unread is flagged.' },
  raster: { ko: '이미지는 형상 힌트로 씁니다 — **치수는 글로 적어 주세요.**', en: 'The image gives shape hints — please state dimensions in text.' },
  text: { ko: '설명한 치수로 만듭니다.', en: 'Built from the dimensions you describe.' },
};

/** 래스터로 받을 수 있는 파일인가(붙여넣기·드래그 공통 판정). */
export function isAcceptedRaster(file: { type?: string; size?: number }): { ok: true } | { ok: false; reason: 'type' | 'size' } {
  if (!(RASTER_MIME as readonly string[]).includes((file.type ?? '').toLowerCase())) return { ok: false, reason: 'type' };
  if ((file.size ?? 0) > MAX_IMAGE_BYTES) return { ok: false, reason: 'size' };
  return { ok: true };
}

/**
 * 클립보드·드래그 이벤트에서 **첫 이미지 파일**을 꺼낸다.
 * ⚠ 붙여넣기는 `items`(스크린샷), 드래그는 `files`(파일 탐색기)로 온다 — 둘 다 본다.
 *   한쪽만 보면 「캡처는 되는데 파일 드래그는 안 되는」 상태가 된다.
 */
export function imageFromTransfer(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  for (const f of Array.from(dt.files ?? [])) {
    if ((RASTER_MIME as readonly string[]).includes(f.type)) return f;
  }
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind === 'file' && (RASTER_MIME as readonly string[]).includes(it.type)) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}
