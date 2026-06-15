'use client';

// ScadCodePanel — read-only OpenSCAD projection of the current feature
// tree. Mounted inside the bottom drawer as the `scad` tab. Copy / save
// .scad buttons let users export the projection for use in OpenSCAD or
// any OpenSCAD-aware downstream tool.
//
// Round-trip editing (SCAD → feature tree) is deliberately *not* in this
// panel. That requires parsing OpenSCAD into NexyFab's FeatureInstance[]
// (Mode B of the SolidWorks + OpenSCAD hybrid), which is a separate
// surface. Read-only first keeps the contract narrow and obvious.

import { useEffect, useMemo, useState } from 'react';
import { downloadBlob } from '@/lib/platform';
import type { FeatureInstance } from '../features/types';
import { emitScadFromFeatures } from './emitScadFromFeatures';
import { parseScadToFeatures, type ScadRecognisedFeature } from './parseScadToFeatures';
import { useSceneStore } from '../store/sceneStore';
import { useLang } from '../hooks/useLang';
import { loc } from '../lib/loc';

interface Props {
  features: FeatureInstance[];
  baseShapeId: string;
  baseParams: Record<string, number>;
  /** File-level header (project name + date typically). */
  header?: string;
  isKo: boolean;
}

export default function ScadCodePanel({ features, baseShapeId, baseParams, header, isKo }: Props) {
  const lang = useLang();
  const projection = useMemo(
    () => emitScadFromFeatures(features, { baseShapeId, baseParams, header }),
    [features, baseShapeId, baseParams, header],
  );
  // Phase 1 — editable mode. `code` is the working buffer; the projection
  // refills it whenever the feature tree changes *and* we're not actively
  // editing (so the user's pending edits don't get clobbered).
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(projection);
  useEffect(() => { if (!editing) setCode(projection); }, [projection, editing]);

  const [copied, setCopied] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  // Phase 1 auto-apply — 600ms debounce after the user pauses typing,
  // run parseScadToFeatures, push to scene if recognised. Off by default
  // (mid-edit code is often unparseable so silent failures would feel
  // mysterious). Toggle persists for the lifetime of this panel session.
  const [autoApply, setAutoApply] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch { /* clipboard may be unavailable in non-secure contexts */ }
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const fname = `${(header || 'nexyfab').replace(/[^a-z0-9-]+/gi, '_')}.scad`;
    void downloadBlob(fname, blob);
  };

  /** Phase-1 Apply — sends the (possibly user-edited) SCAD source to the
   *  server renderer. On success surface a download link to the STL; on
   *  error display the message. Real viewport mount of the rendered mesh
   *  is phase-2 work (requires routing the STL into the scene store as a
   *  parallel "draft" body so the feature tree result isn't displaced). */
  const handleApply = async () => {
    setApplyBusy(true);
    setApplyMsg(null);
    try {
      const res = await fetch('/api/nexyfab/openscad-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scad: code, format: 'stl', async: false }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setApplyMsg((data as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      const artifactUrl = (data as { artifactUrl?: string }).artifactUrl;
      const dataB64 = (data as { dataBase64?: string }).dataBase64;
      if (artifactUrl) {
        setApplyMsg(loc(lang, {
          ko: `STL 준비됨 — 다운로드: ${artifactUrl}`,
          en: `STL ready — download: ${artifactUrl}`,
          ja: `STL 準備完了 — ダウンロード: ${artifactUrl}`,
          zh: `STL 已就绪 — 下载: ${artifactUrl}`,
          es: `STL listo — descargar: ${artifactUrl}`,
          ar: `STL جاهز — تنزيل: ${artifactUrl}`,
        }));
        return;
      }
      if (dataB64) {
        const bin = atob(dataB64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'model/stl' });
        const fname = `${(header || 'nexyfab').replace(/[^a-z0-9-]+/gi, '_')}.stl`;
        void downloadBlob(fname, blob);
        setApplyMsg(loc(lang, { ko: 'STL 다운로드 시작됨', en: 'STL download started', ja: 'STLのダウンロードを開始しました', zh: 'STL 下载已开始', es: 'Descarga de STL iniciada', ar: 'بدأ تنزيل STL' }));
        return;
      }
      setApplyMsg(loc(lang, { ko: '응답이 비어있습니다', en: 'Empty response from renderer', ja: 'レンダラーからの応答が空です', zh: '渲染器返回空响应', es: 'Respuesta vacía del renderizador', ar: 'استجابة فارغة من المُصيِّر' }));
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyBusy(false);
    }
  };

  /** Phase 1 reverse — parse the edited SCAD and, if it matches one of the
   *  primitives our own emitter writes, push the recognised base shape +
   *  params straight into the scene store. This is the round-trip the
   *  "양방향 sync" task is gated on; richer SCAD (union / difference /
   *  modules) still has to go through the server renderer path. */
  /** Centralised so the auto-apply path and the manual button do the
   *  same thing (incl. the translate → moveCopy side-effect). Returns
   *  the human-readable status the caller writes into applyMsg. */
  const applyParsedResult = (
    shape: { baseShapeId: 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus'; params: Record<string, number>; translate?: { x: number; y: number; z: number } },
    features: ScadRecognisedFeature[] | undefined,
    manual: boolean,
  ): string => {
    const { baseShapeId, params, translate } = shape;
    const store = useSceneStore.getState();
    store.setSelectedId(baseShapeId);
    store.setParams(params);
    if (translate) {
      // Phase 2-b — dispatch a moveCopy feature (operation 0 = move) so the
      // recognised translate prefix actually moves the resulting body. The
      // listener lives in ShapeGeneratorInner and calls addFeatureWithParams.
      window.dispatchEvent(new CustomEvent('nexyfab:add-feature', {
        detail: {
          type: 'moveCopy',
          overrides: { offsetX: translate.x, offsetY: translate.y, offsetZ: translate.z, operation: 0 },
        },
      }));
    }
    // Phase 2 — each subtractive hole recovered from a `difference()` becomes a
    // real `hole` feature node (same add-feature channel as moveCopy), so an
    // edited SCAD difference round-trips into the parametric tree, not a flat mesh.
    const holes = features ?? [];
    for (const h of holes) {
      window.dispatchEvent(new CustomEvent('nexyfab:add-feature', {
        detail: { type: h.type, overrides: h.params },
      }));
    }
    const prefix = manual
      ? loc(lang, { ko: '피처 트리에 적용됨', en: 'Applied to tree', ja: 'フィーチャーツリーに適用しました', zh: '已应用到特征树', es: 'Aplicado al árbol de operaciones', ar: 'تم التطبيق على شجرة العناصر' })
      : loc(lang, { ko: '자동 적용됨', en: 'Auto-applied', ja: '自動適用しました', zh: '已自动应用', es: 'Aplicado automáticamente', ar: 'تم التطبيق تلقائيًا' });
    const xfmNote = translate ? loc(lang, {
      ko: ` + 이동 (${translate.x}, ${translate.y}, ${translate.z})`,
      en: ` + move (${translate.x}, ${translate.y}, ${translate.z})`,
      ja: ` + 移動 (${translate.x}, ${translate.y}, ${translate.z})`,
      zh: ` + 移动 (${translate.x}, ${translate.y}, ${translate.z})`,
      es: ` + mover (${translate.x}, ${translate.y}, ${translate.z})`,
      ar: ` + نقل (${translate.x}, ${translate.y}, ${translate.z})`,
    }) : '';
    const holeNote = holes.length ? loc(lang, {
      ko: ` + 구멍 ${holes.length}개`,
      en: ` + ${holes.length} hole(s)`,
      ja: ` + 穴 ${holes.length}個`,
      zh: ` + ${holes.length} 个孔`,
      es: ` + ${holes.length} agujero(s)`,
      ar: ` + ${holes.length} فتحة`,
    }) : '';
    return `${prefix} — ${baseShapeId}${xfmNote}${holeNote}`;
  };

  const handleApplyToTree = () => {
    const res = parseScadToFeatures(code);
    if (!res.ok) {
      setApplyMsg(loc(lang, {
        ko: '인식 실패: 서버 렌더 사용 또는 기본 도형으로 단순화하세요',
        en: 'Not recognised — use Apply (server render) or simplify to a primitive',
        ja: '認識できません — Apply(サーバーレンダー)を使うか、基本形状に簡略化してください',
        zh: '无法识别 — 请使用 Apply(服务器渲染)或简化为基本图元',
        es: 'No reconocido — use Apply (renderizado en servidor) o simplifique a una primitiva',
        ar: 'غير معروف — استخدم Apply (التصيير على الخادم) أو بسّطه إلى شكل أولي',
      }));
      return;
    }
    setApplyMsg(applyParsedResult(res.shape, res.features, true));
  };

  /** Auto-apply debounce — only fires while the user is actively editing
   *  and the toggle is on. Silent on parse failure so mid-edit incomplete
   *  code doesn't flood the status line. Successful applies still log to
   *  applyMsg so the user knows what just changed. */
  useEffect(() => {
    if (!editing || !autoApply) return;
    const timer = setTimeout(() => {
      const res = parseScadToFeatures(code);
      if (!res.ok) return;
      // Subtractive holes append a feature node each fire — like moveCopy, that
      // would spam duplicates during live typing. Leave hole-bearing SCAD to the
      // explicit Apply button (handleApplyToTree) and only auto-apply base edits.
      if (res.features && res.features.length > 0) return;
      const { baseShapeId, params, translate } = res.shape;
      const store = useSceneStore.getState();
      // Skip when nothing changed (idempotent typing — the user added a
      // comment or whitespace). Note we don't dedupe on translate yet so
      // edits to the offset do re-fire; the moveCopy listener silently
      // appends a fresh feature each time, so callers should pair this
      // with `Apply (server render)` for now if they want a clean tree.
      if (!translate
          && store.selectedId === baseShapeId
          && JSON.stringify(store.params) === JSON.stringify({ ...store.params, ...params })) {
        return;
      }
      setApplyMsg(applyParsedResult(res.shape, res.features, false));
    }, 600);
    return () => clearTimeout(timer);
    // applyParsedResult is intentionally not in deps — it closes over
    // setters and isKo, both stable for this purpose. Re-running on every
    // render would reset the debounce timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, editing, autoApply, isKo]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--nx-text-2)', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          {editing
            ? loc(lang, { ko: '편집 모드 · Apply로 서버 렌더', en: 'Editing · Apply renders on server', ja: '編集モード · Apply でサーバーレンダー', zh: '编辑模式 · Apply 在服务器渲染', es: 'Edición · Apply renderiza en el servidor', ar: 'وضع التحرير · Apply يُصيّر على الخادم' })
            : loc(lang, { ko: '읽기 전용 · 피처 트리 투영', en: 'Read-only · feature tree projection', ja: '読み取り専用 · フィーチャーツリー投影', zh: '只读 · 特征树投影', es: 'Solo lectura · proyección del árbol de operaciones', ar: 'للقراءة فقط · إسقاط شجرة العناصر' })}
        </span>
        <button
          type="button"
          onClick={() => setEditing(v => !v)}
          style={{
            height: 24, padding: '0 10px', borderRadius: 4,
            border: '1px solid var(--nx-border)',
            background: editing ? 'var(--nx-accent-soft)' : 'var(--nx-panel-2)',
            color: editing ? 'var(--nx-accent-2)' : 'var(--nx-text)',
            fontSize: 11, cursor: 'pointer', fontWeight: 600,
          }}
        >
          {editing
            ? loc(lang, { ko: '편집 종료', en: 'Done', ja: '完了', zh: '完成', es: 'Hecho', ar: 'تم' })
            : loc(lang, { ko: '편집', en: 'Edit', ja: '編集', zh: '编辑', es: 'Editar', ar: 'تحرير' })}
        </button>
        {editing && (
          <>
            <label
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--nx-text-2)', cursor: 'pointer', userSelect: 'none' }}
              title={loc(lang, { ko: '편집 중 600ms마다 인식되면 자동 적용', en: 'Auto-apply on pause (600ms) when parse succeeds', ja: '一時停止時(600ms)に解析が成功すれば自動適用', zh: '暂停时(600ms)解析成功则自动应用', es: 'Auto-aplicar al pausar (600 ms) si el análisis tiene éxito', ar: 'تطبيق تلقائي عند التوقف (600 مللي ثانية) إذا نجح التحليل' })}
            >
              <input
                type="checkbox"
                checked={autoApply}
                onChange={e => setAutoApply(e.target.checked)}
                style={{ accentColor: 'var(--nx-accent)' }}
              />
              {loc(lang, { ko: '자동', en: 'Auto', ja: '自動', zh: '自动', es: 'Auto', ar: 'تلقائي' })}
            </label>
            <button
              type="button"
              onClick={handleApplyToTree}
              style={{
                height: 24, padding: '0 10px', borderRadius: 4,
                border: '1px solid var(--nx-border-strong)',
                background: 'var(--nx-panel-2)',
                color: 'var(--nx-text)',
                fontSize: 11, cursor: 'pointer', fontWeight: 600,
              }}
              title={loc(lang, { ko: '인식된 기본 도형을 피처 트리에 적용', en: 'Apply recognised primitive to feature tree', ja: '認識された基本形状をフィーチャーツリーに適用', zh: '将识别的基本图元应用到特征树', es: 'Aplicar la primitiva reconocida al árbol de operaciones', ar: 'تطبيق الشكل الأولي المُتعرَّف عليه على شجرة العناصر' })}
            >
              {loc(lang, { ko: '트리에 적용', en: 'To tree', ja: 'ツリーに適用', zh: '应用到树', es: 'Al árbol', ar: 'إلى الشجرة' })}
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={applyBusy}
              style={{
                height: 24, padding: '0 10px', borderRadius: 4,
                border: '1px solid var(--nx-accent)',
                background: applyBusy ? 'var(--nx-text-3)' : 'var(--nx-accent)',
                color: '#fff',
                fontSize: 11, cursor: applyBusy ? 'wait' : 'pointer', fontWeight: 700,
              }}
              title={loc(lang, { ko: '서버에서 렌더링 (STL 다운로드)', en: 'Render on server (STL download)', ja: 'サーバーでレンダリング (STL ダウンロード)', zh: '在服务器渲染 (STL 下载)', es: 'Renderizar en el servidor (descarga STL)', ar: 'التصيير على الخادم (تنزيل STL)' })}
            >
              {applyBusy
                ? loc(lang, { ko: '렌더 중…', en: 'Rendering…', ja: 'レンダリング中…', zh: '渲染中…', es: 'Renderizando…', ar: 'جارٍ التصيير…' })
                : 'Apply →'}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={handleCopy}
          style={{
            height: 24, padding: '0 10px', borderRadius: 4,
            border: '1px solid var(--nx-border)', background: 'var(--nx-panel-2)',
            color: 'var(--nx-text)', fontSize: 11, cursor: 'pointer',
          }}
        >
          {copied
            ? '✓ ' + loc(lang, { ko: '복사됨', en: 'Copied', ja: 'コピーしました', zh: '已复制', es: 'Copiado', ar: 'تم النسخ' })
            : loc(lang, { ko: '복사', en: 'Copy', ja: 'コピー', zh: '复制', es: 'Copiar', ar: 'نسخ' })}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          style={{
            height: 24, padding: '0 10px', borderRadius: 4,
            border: '1px solid var(--nx-border)', background: 'var(--nx-panel-2)',
            color: 'var(--nx-text)', fontSize: 11, cursor: 'pointer',
          }}
        >
          {loc(lang, { ko: '.scad 저장', en: 'Save .scad', ja: '.scad を保存', zh: '保存 .scad', es: 'Guardar .scad', ar: 'حفظ ‎.scad' })}
        </button>
      </div>
      {editing ? (
        <textarea
          value={code}
          onChange={e => setCode(e.target.value)}
          spellCheck={false}
          style={{
            flex: 1, minHeight: 0, margin: 0,
            padding: 12, borderRadius: 6,
            background: 'var(--nx-panel-2)', border: '1px solid var(--nx-accent)',
            color: 'var(--nx-text)',
            fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace',
            fontSize: 12, lineHeight: 1.5,
            resize: 'none',
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
      ) : (
        <pre
          style={{
            flex: 1, minHeight: 0, margin: 0,
            padding: 12, borderRadius: 6,
            background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)',
            color: 'var(--nx-text)',
            fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace',
            fontSize: 12, lineHeight: 1.5,
            overflow: 'auto',
            whiteSpace: 'pre',
          }}
        >
          {code}
        </pre>
      )}
      {applyMsg && (
        <div style={{
          fontSize: 11, padding: '6px 8px',
          background: 'var(--nx-panel-2)',
          border: '1px solid var(--nx-border)',
          borderRadius: 4,
          color: 'var(--nx-text-2)',
          wordBreak: 'break-all',
        }}>
          {applyMsg}
        </div>
      )}
    </div>
  );
}
