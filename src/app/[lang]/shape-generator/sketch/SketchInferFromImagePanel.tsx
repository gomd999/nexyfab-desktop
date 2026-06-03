'use client';

/**
 * SketchInferFromImagePanel — standalone Phase 3.AI.UI panel that exposes
 * `inferSketchFromImage` (src/lib/ai/sketchInferenceFromImage.ts) as a
 * self-contained UI surface: user picks an image → preview → "Infer sketch"
 * → SVG overlay of detected geometry → "Accept" forwards a SolverViewState
 * to the host editor.
 *
 * Why a standalone panel (not bolted into SolverSketchEditorWithExtrude)?
 *   - The host editor already has 30+ testids and a fragile interaction
 *     surface; mounting an 8 MB-capable image uploader inside it would
 *     force surgery on dozens of editor tests.
 *   - This panel can be reused inside other AI surfaces: a future
 *     "Vision → Sketch" sidebar, the FeatureTree planner, a paste-image
 *     quick-action, etc. Keeping it dependency-light (image → result →
 *     callback) means it slots into any host that owns the solver state.
 *   - The wrapper picks the inferred SketchEntities + maps points/lines
 *     into the SolverViewState shape; circles/arcs are surfaced in the
 *     preview SVG but NOT forwarded to onAccept (Phase 2.A only supports
 *     point+line in SolverViewState; circle/arc → polyline approximation
 *     lands in Phase 2.A.2 — see solverToProfile.ts comments).
 *
 * Phase 1 vs Phase 2 split (mirrors sketchInferenceFromImage.ts):
 *   Phase 1 (this UI today):
 *     - File picker → FileReader.readAsDataURL → base64 data URL.
 *     - inferSketchFromImage called with NO detector → fallback 4-corner
 *       grid is returned. The "phase1Note" banner makes this explicit so
 *       users don't mistake the deterministic mock output for real CV.
 *     - SVG overlay renders the inferred entities scaled to fit the
 *       240×240 preview frame, sketch-space +Y-up flipped to screen +Y-down
 *       via a single scale(1,-1) wrapper (same idiom as sketchSvgExport).
 *   Phase 2 (UI ready for, not enabled yet):
 *     - The component accepts a `realDetector` prop pass-through (not in
 *       the current Props contract; will add when OpenCV-WASM ships) that
 *       forwards verbatim to `inferSketchFromImage({realDetector})`.
 *     - SVG overlay already handles the full entity set (points/lines/
 *       circles/arcs) so Phase 2 CV output renders without UI changes.
 *     - The 8 MB cap is already aligned with IMAGE_INFERENCE_MAX_SIZE so
 *       Phase 2 won't trip the inferer's own oversize guard.
 *
 * 8 MB cap policy:
 *   - We surface a warning chip (NOT a throw) when the selected file
 *     exceeds 8 MB. The user can still see the preview (browser handles
 *     the data URL fine) but the "Infer sketch" button is disabled so we
 *     never hand an oversized source to inferSketchFromImage (which would
 *     return {ok:false, error:'max size'} and clutter the result panel).
 *   - We compare against `file.size` (raw bytes), not base64 length, because
 *     the inferer's IMAGE_INFERENCE_MAX_SIZE check runs on the *string*
 *     length after the FileReader produces it — and base64 inflates ~33%.
 *     Using the raw 8 MB byte threshold gives us a small safety margin
 *     before the inferer's own check trips.
 *
 * Test surface (data-testids — all prefixed solver-sketch-infer-):
 *   solver-sketch-infer-panel,
 *   solver-sketch-infer-file-input,
 *   solver-sketch-infer-image-preview,
 *   solver-sketch-infer-infer-button,
 *   solver-sketch-infer-svg-preview,
 *   solver-sketch-infer-accept-button,
 *   solver-sketch-infer-warning,
 *   solver-sketch-infer-phase1-note,
 *   solver-sketch-infer-shape-count.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  inferSketchFromImage,
  IMAGE_INFERENCE_MAX_SIZE,
  type ImageInferenceResult,
} from '@/lib/ai/sketchInferenceFromImage';
import type { SketchEntities } from '@/lib/sketch/sketchSvgExport';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

export type SketchInferLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  inferFromImage: string;
  selectImage: string;
  inferButton: string;
  acceptButton: string;
  phase1Note: string;
  warningOversize: (mb: string) => string;
  warningInferFailed: string;
  noEntities: string;
  shapeCount: (n: { points: number; lines: number; circles: number; arcs: number }) => string;
}

const dict: Record<SketchInferLang, Dict> = {
  en: {
    inferFromImage: 'Infer sketch from image',
    selectImage: 'Select image',
    inferButton: 'Infer sketch',
    acceptButton: 'Accept',
    phase1Note: 'Phase 1: mock-driven fallback. OpenCV-WASM detector lands in Phase 2.',
    warningOversize: (mb) => `File exceeds 8 MB cap (${mb} MB). Choose a smaller image.`,
    warningInferFailed: 'Inference failed — see console for details.',
    noEntities: 'No entities detected.',
    shapeCount: (n) =>
      `${n.points} point(s), ${n.lines} line(s), ${n.circles} circle(s), ${n.arcs} arc(s)`,
  },
  ko: {
    inferFromImage: '이미지에서 스케치 추론',
    selectImage: '이미지 선택',
    inferButton: '스케치 추론',
    acceptButton: '적용',
    phase1Note: 'Phase 1: 모의 디텍터 기반. OpenCV-WASM은 Phase 2에서 도입됩니다.',
    warningOversize: (mb) => `파일이 8MB 상한을 초과합니다 (${mb} MB). 더 작은 이미지를 선택하세요.`,
    warningInferFailed: '추론 실패 — 콘솔을 확인하세요.',
    noEntities: '감지된 엔티티가 없습니다.',
    shapeCount: (n) =>
      `점 ${n.points}개, 선 ${n.lines}개, 원 ${n.circles}개, 호 ${n.arcs}개`,
  },
  ja: {
    inferFromImage: '画像からスケッチを推論',
    selectImage: '画像を選択',
    inferButton: 'スケッチを推論',
    acceptButton: '適用',
    phase1Note: 'フェーズ1: モック検出器ベース。OpenCV-WASM はフェーズ2で導入。',
    warningOversize: (mb) => `ファイルが8MB上限を超えています (${mb} MB)。より小さい画像を選択してください。`,
    warningInferFailed: '推論失敗 — コンソールを確認してください。',
    noEntities: '検出されたエンティティはありません。',
    shapeCount: (n) =>
      `点 ${n.points}件, 線 ${n.lines}件, 円 ${n.circles}件, 弧 ${n.arcs}件`,
  },
  zh: {
    inferFromImage: '从图像推断草图',
    selectImage: '选择图像',
    inferButton: '推断草图',
    acceptButton: '应用',
    phase1Note: '阶段1：基于模拟检测器。OpenCV-WASM 将在阶段2引入。',
    warningOversize: (mb) => `文件超过8MB上限 (${mb} MB)。请选择较小的图像。`,
    warningInferFailed: '推断失败 — 请查看控制台。',
    noEntities: '未检测到任何实体。',
    shapeCount: (n) =>
      `${n.points} 点 / ${n.lines} 线 / ${n.circles} 圆 / ${n.arcs} 弧`,
  },
  es: {
    inferFromImage: 'Inferir boceto desde imagen',
    selectImage: 'Seleccionar imagen',
    inferButton: 'Inferir boceto',
    acceptButton: 'Aceptar',
    phase1Note: 'Fase 1: detector simulado. OpenCV-WASM llega en la Fase 2.',
    warningOversize: (mb) => `El archivo supera el límite de 8 MB (${mb} MB). Elige una imagen más pequeña.`,
    warningInferFailed: 'Inferencia fallida — revisa la consola.',
    noEntities: 'No se detectaron entidades.',
    shapeCount: (n) =>
      `${n.points} pts, ${n.lines} líneas, ${n.circles} círcs, ${n.arcs} arcos`,
  },
  ar: {
    inferFromImage: 'استنتاج الرسم من الصورة',
    selectImage: 'اختر صورة',
    inferButton: 'استنتاج الرسم',
    acceptButton: 'قبول',
    phase1Note: 'المرحلة 1: كاشف وهمي. OpenCV-WASM في المرحلة 2.',
    warningOversize: (mb) => `الملف يتجاوز حد 8 ميغابايت (${mb} ميغابايت). اختر صورة أصغر.`,
    warningInferFailed: 'فشل الاستنتاج — راجع وحدة التحكم.',
    noEntities: 'لم يتم اكتشاف أي كيانات.',
    shapeCount: (n) =>
      `${n.points} نقطة، ${n.lines} خط، ${n.circles} دائرة، ${n.arcs} قوس`,
  },
};

export interface SketchInferFromImagePanelProps {
  lang: SketchInferLang;
  /**
   * Called when the user clicks "Accept" on a successful inference. The
   * payload contains ONLY points + lines (the subset SolverViewState
   * currently understands). Circles/arcs detected by the inferer are still
   * shown in the SVG preview but skipped from the forwarded state until
   * Phase 2.A.2 adds polyline approximation.
   */
  onAccept?: (sketch: SolverViewState) => void;
}

const PREVIEW_PX = 240;

// ─── geometry helpers ────────────────────────────────────────────────────

interface SketchBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Compute the bbox of all entity coordinates in sketch space. Returns a
 * 10x10 unit square when entities are empty so the SVG viewBox stays
 * non-degenerate (avoids division-by-zero in the scale math).
 */
function computeEntityBBox(entities: SketchEntities): SketchBBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const expand = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const p of entities.points) expand(p.x, p.y);
  for (const l of entities.lines) {
    expand(l.x1, l.y1);
    expand(l.x2, l.y2);
  }
  for (const c of entities.circles) {
    expand(c.cx - c.radius, c.cy - c.radius);
    expand(c.cx + c.radius, c.cy + c.radius);
  }
  for (const a of entities.arcs) {
    expand(a.cx - a.radius, a.cy - a.radius);
    expand(a.cx + a.radius, a.cy + a.radius);
  }
  if (!isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  }
  // pad 5 % each side so single-axis sketches (a horizontal line) still
  // get a visible bbox margin in the preview.
  const w = maxX - minX || 10;
  const h = maxY - minY || 10;
  const padX = w * 0.05;
  const padY = h * 0.05;
  return {
    minX: minX - padX,
    minY: minY - padY,
    maxX: maxX + padX,
    maxY: maxY + padY,
  };
}

/**
 * Map SketchEntities (the inferer's output shape) to SolverViewState (the
 * solver's view-model shape). Points + lines only — circles/arcs deferred
 * to Phase 2.A.2 polyline approximation (see solverToProfile.ts docs).
 */
function entitiesToSolverView(entities: SketchEntities): SolverViewState {
  return {
    points: entities.points.map((p) => ({ id: p.id, x: p.x, y: p.y })),
    lines: entities.lines.map((l) => ({ id: l.id, p1: l.p1, p2: l.p2 })),
  };
}

// ─── component ───────────────────────────────────────────────────────────

export default function SketchInferFromImagePanel(
  props: SketchInferFromImagePanelProps,
): React.ReactElement {
  const { lang, onAccept } = props;
  const t = dict[lang];

  // Selected image as base64 data URL (for both the <img> preview AND the
  // inferer's `string` source path). null until a file is picked.
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  // Raw selected file size for the 8 MB cap check. We compare bytes (not
  // base64-string length) because file.size is authoritative — see header
  // comment for the policy rationale.
  const [fileSize, setFileSize] = useState<number>(0);
  // Local warning string ('' = no warning). Used for oversize and
  // inferer-failure surfaces. We DELIBERATELY don't throw — the panel
  // contract is "always render something". (Matches the inferer's own
  // no-throw policy.)
  const [warning, setWarning] = useState<string>('');
  // Most-recent inference result. null until first click of Infer.
  const [result, setResult] = useState<ImageInferenceResult | null>(null);

  const oversize = fileSize > IMAGE_INFERENCE_MAX_SIZE;

  // ─── file picker ───
  const handleFile = useCallback((evt: React.ChangeEvent<HTMLInputElement>): void => {
    const file = evt.target.files?.[0];
    if (!file) return;
    setFileSize(file.size);
    setResult(null);

    if (file.size > IMAGE_INFERENCE_MAX_SIZE) {
      const mb = (file.size / (1024 * 1024)).toFixed(2);
      setWarning(t.warningOversize(mb));
      // We STILL load the preview so the user can see what they tried to
      // upload — but the Infer button is disabled so we never hand the
      // oversized source to the inferer.
    } else {
      setWarning('');
    }

    const reader = new FileReader();
    reader.onload = (): void => {
      const url = String(reader.result ?? '');
      setDataUrl(url);
    };
    reader.onerror = (): void => {
      setDataUrl(null);
    };
    reader.readAsDataURL(file);
  }, [t]);

  // ─── infer click ───
  const handleInfer = useCallback(async (): Promise<void> => {
    if (!dataUrl || oversize) return;
    // Phase 1: no detector supplied → inferer returns the deterministic
    // 4-corner fallback grid + a warning. Phase 2 will pass a realDetector
    // here pulled from an injected OpenCV-WASM module.
    const r = await inferSketchFromImage(dataUrl);
    setResult(r);
    if (!r.ok) {
      setWarning(t.warningInferFailed);
    } else {
      // Don't clear oversize warnings on successful infer (they still apply
      // to the file). But clear any previous infer-failure warning.
      if (warning === t.warningInferFailed) setWarning('');
    }
  }, [dataUrl, oversize, t, warning]);

  // ─── accept click ───
  const handleAccept = useCallback((): void => {
    if (!result?.ok || !result.entities || !onAccept) return;
    onAccept(entitiesToSolverView(result.entities));
  }, [result, onAccept]);

  // ─── derived render state ───
  const entities = result?.ok ? result.entities : undefined;
  const bbox = useMemo(
    () => (entities ? computeEntityBBox(entities) : null),
    [entities],
  );
  const counts = useMemo(() => {
    if (!entities) return null;
    return {
      points: entities.points.length,
      lines: entities.lines.length,
      circles: entities.circles.length,
      arcs: entities.arcs.length,
    };
  }, [entities]);

  const canInfer = dataUrl !== null && !oversize;
  const canAccept = result?.ok === true && (entities?.points.length ?? 0) > 0;

  return (
    <div
      data-testid="solver-sketch-infer-panel"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: '#fff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        minWidth: 280,
        maxWidth: 360,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13 }}>{t.inferFromImage}</div>

      {/* phase 1 note — explicit so users don't mistake the mock fallback
          for real CV output. */}
      <div
        data-testid="solver-sketch-infer-phase1-note"
        style={{
          padding: 6,
          background: '#fef3c7',
          border: '1px solid #fde68a',
          borderRadius: 4,
          color: '#92400e',
          fontSize: 11,
          lineHeight: 1.4,
        }}
      >
        {t.phase1Note}
      </div>

      {/* file input */}
      <label
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          fontSize: 11,
          color: '#374151',
        }}
      >
        <span>{t.selectImage}</span>
        <input
          type="file"
          accept="image/*"
          data-testid="solver-sketch-infer-file-input"
          onChange={handleFile}
          style={{ fontSize: 11 }}
        />
      </label>

      {/* warning chip — single slot for oversize OR infer-failure */}
      {warning !== '' && (
        <div
          data-testid="solver-sketch-infer-warning"
          role="alert"
          style={{
            padding: 6,
            background: '#fee2e2',
            border: '1px solid #fecaca',
            borderRadius: 4,
            color: '#991b1b',
            fontSize: 11,
            lineHeight: 1.4,
          }}
        >
          {warning}
        </div>
      )}

      {/* image preview — shown for any successfully-loaded file (even
          oversize, so the user can confirm they picked the right one). */}
      {dataUrl !== null && (
        <img
          src={dataUrl}
          alt=""
          data-testid="solver-sketch-infer-image-preview"
          style={{
            maxWidth: PREVIEW_PX,
            maxHeight: PREVIEW_PX,
            border: '1px solid #e5e7eb',
            borderRadius: 4,
            background: '#f9fafb',
            objectFit: 'contain',
          }}
        />
      )}

      {/* infer button */}
      <button
        type="button"
        data-testid="solver-sketch-infer-infer-button"
        onClick={handleInfer}
        disabled={!canInfer}
        style={{
          padding: '6px 12px',
          border: '1px solid #d1d5db',
          borderRadius: 4,
          background: canInfer ? '#2563eb' : '#9ca3af',
          color: '#fff',
          cursor: canInfer ? 'pointer' : 'not-allowed',
          fontSize: 12,
          fontFamily: 'inherit',
        }}
      >
        {t.inferButton}
      </button>

      {/* svg preview + accept — only after a successful inference */}
      {result?.ok && entities && bbox && (
        <>
          <SvgOverlayPreview
            entities={entities}
            bbox={bbox}
            backgroundDataUrl={dataUrl}
          />
          {counts && (
            <div
              data-testid="solver-sketch-infer-shape-count"
              style={{ fontSize: 11, color: '#4b5563' }}
            >
              {counts.points + counts.lines + counts.circles + counts.arcs === 0
                ? t.noEntities
                : t.shapeCount(counts)}
            </div>
          )}
          <button
            type="button"
            data-testid="solver-sketch-infer-accept-button"
            onClick={handleAccept}
            disabled={!canAccept || !onAccept}
            style={{
              padding: '6px 12px',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              background: canAccept && onAccept ? '#16a34a' : '#9ca3af',
              color: '#fff',
              cursor: canAccept && onAccept ? 'pointer' : 'not-allowed',
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          >
            {t.acceptButton}
          </button>
        </>
      )}
    </div>
  );
}

// ─── SVG overlay sub-component ───────────────────────────────────────────

interface SvgOverlayProps {
  entities: SketchEntities;
  bbox: SketchBBox;
  /** Optional background image rendered behind the geometry (so user can
   * visually verify alignment). When omitted, the SVG renders on a plain
   * background. */
  backgroundDataUrl: string | null;
}

/**
 * SVG overlay of inferred geometry. Sketch space is +Y up; SVG is +Y down,
 * so we wrap content in a `translate(0, vbH) scale(1, -1)` group — same
 * idiom as `sketchSvgExport.ts`. The viewBox uses the bbox 1:1 so a single
 * sketch unit maps to a single SVG unit (independent of preview-pixel
 * dimensions, which only set the rendered frame size via width/height).
 *
 * Stroke widths are computed in sketch units so they don't blow up when the
 * bbox is small. We pick max(bboxW, bboxH) * 0.005 as a sensible "1 pixel
 * at typical preview zoom" default.
 */
function SvgOverlayPreview(props: SvgOverlayProps): React.ReactElement {
  const { entities, bbox, backgroundDataUrl } = props;
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  const stroke = Math.max(w, h) * 0.005;
  const pointR = Math.max(w, h) * 0.015;

  return (
    <svg
      data-testid="solver-sketch-infer-svg-preview"
      xmlns="http://www.w3.org/2000/svg"
      width={PREVIEW_PX}
      height={PREVIEW_PX}
      viewBox={`${bbox.minX} ${bbox.minY} ${w} ${h}`}
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 4,
        background: '#fafafa',
        display: 'block',
      }}
    >
      {/* Background image: rendered in sketch space so it shares the viewBox
          with the overlay. We pre-flip the image Y so the inferred geometry
          (which is sketch-space +Y up) overlays correctly on top after the
          scale(1,-1) wrapper below. */}
      {backgroundDataUrl !== null && (
        <image
          href={backgroundDataUrl}
          x={bbox.minX}
          y={bbox.minY}
          width={w}
          height={h}
          preserveAspectRatio="xMidYMid meet"
          opacity={0.35}
        />
      )}
      {/* Y-flip wrapper so sketch +Y-up coords render upright in SVG +Y-down
          screen space. translate by the viewBox bottom-edge first, then
          scale(1,-1) reflects across that edge. */}
      <g transform={`translate(0 ${bbox.minY + bbox.maxY}) scale(1 -1)`}>
        {entities.lines.map((ln) => (
          <line
            key={ln.id}
            x1={ln.x1}
            y1={ln.y1}
            x2={ln.x2}
            y2={ln.y2}
            stroke="#2563eb"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        ))}
        {entities.circles.map((c) => (
          <circle
            key={c.id}
            cx={c.cx}
            cy={c.cy}
            r={c.radius}
            fill="none"
            stroke="#16a34a"
            strokeWidth={stroke}
          />
        ))}
        {entities.arcs.map((a) => {
          // Encode arc as an SVG path. Same math as sketchSvgExport but
          // inlined here since we don't want a runtime dep on the exporter
          // (the preview is a UI-only concern). large-arc flag = |delta|>pi;
          // sweep flag inverted to compensate for the Y-flip wrapper.
          const x0 = a.cx + a.radius * Math.cos(a.startAngle);
          const y0 = a.cy + a.radius * Math.sin(a.startAngle);
          const x1 = a.cx + a.radius * Math.cos(a.endAngle);
          const y1 = a.cy + a.radius * Math.sin(a.endAngle);
          const delta = a.endAngle - a.startAngle;
          const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
          const sweep = delta > 0 ? 0 : 1;
          const d = `M ${x0} ${y0} A ${a.radius} ${a.radius} 0 ${largeArc} ${sweep} ${x1} ${y1}`;
          return (
            <path
              key={a.id}
              d={d}
              fill="none"
              stroke="#9333ea"
              strokeWidth={stroke}
            />
          );
        })}
        {entities.points.map((p) => (
          <circle
            key={p.id}
            cx={p.x}
            cy={p.y}
            r={pointR}
            fill="#dc2626"
          />
        ))}
      </g>
    </svg>
  );
}
