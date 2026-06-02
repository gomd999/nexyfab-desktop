'use client';

/**
 * StepImportModal — Phase 5.2 standalone modal that imports a STEP file
 * into a FeatureTree of supported extrude features. Wraps `/api/step-import`.
 *
 * Architecture:
 *   - Standalone (NOT a wrapper of SolverSketchEditor). The parent decides
 *     what to do with the returned tree (replace current tree, merge into
 *     assembly, etc.). The modal only exposes `(tree, warnings, unsupported)`
 *     via the `onImport` callback.
 *   - Two upload modes inside the same modal:
 *       1. File picker (default).  Accepts .step / .stp (any case).
 *       2. Paste-source mode.       Toggled by a "Paste STEP source" button;
 *          opens a textarea for users who already have the source in their
 *          clipboard (handy for diffs, samples, snippets).
 *     Both submit to the same endpoint; the file branch goes via multipart
 *     form-data, the paste branch via JSON.
 *   - 6-language UI (ko / en / ja / zh / es / ar) — error codes returned
 *     by the API are mapped here to localised copy. The free-form
 *     `message` from the server is *not* shown to the user; it is logged
 *     to console.warn for support.
 *
 * Test surface (data-testids — all prefixed step-import-):
 *   step-import-modal,
 *   step-import-file-input,
 *   step-import-toggle-paste, step-import-source-textarea,
 *   step-import-submit, step-import-cancel,
 *   step-import-error,
 *   step-import-summary,
 *   step-import-warnings, step-import-warning-{idx},
 *   step-import-unsupported, step-import-unsupported-{idx}.
 */

import React, { useCallback, useRef, useState } from 'react';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

export type StepImportLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  modalTitle: string;
  filePickerLabel: string;
  togglePaste: string;
  togglePicker: string;
  sourcePlaceholder: string;
  submit: string;
  cancel: string;
  importing: string;
  summarySingle: (count: number) => string;
  summaryEmpty: string;
  warningsHeading: string;
  unsupportedHeading: string;
  /** Map server `error` code → localised user-facing copy. */
  errorByCode: Record<'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE' | 'PARSE_ERROR' | 'NETWORK_ERROR', string>;
  errorPrefix: string;
  /** Per-feature summary fragments. */
  boxFragment: (n: number) => string;
  polygonFragment: (vertices: number) => string;
}

const dict: Record<StepImportLang, Dict> = {
  ko: {
    modalTitle: 'STEP 가져오기',
    filePickerLabel: 'STEP 파일 선택 (.step / .stp)',
    togglePaste: 'STEP 소스 붙여넣기',
    togglePicker: '파일 선택으로 돌아가기',
    sourcePlaceholder: 'ISO-10303-21; ... END-ISO-10303-21;',
    submit: '가져오기',
    cancel: '취소',
    importing: '가져오는 중...',
    summarySingle: (count) => `${count}개 솔리드를 가져왔습니다.`,
    summaryEmpty: '인식 가능한 솔리드가 없습니다.',
    warningsHeading: '경고',
    unsupportedHeading: '지원되지 않는 형상',
    errorByCode: {
      BAD_REQUEST: '잘못된 요청입니다. STEP 소스를 확인해 주세요.',
      PAYLOAD_TOO_LARGE: 'STEP 파일이 너무 큽니다 (최대 5MB).',
      PARSE_ERROR: 'STEP 파일을 분석할 수 없습니다.',
      NETWORK_ERROR: '네트워크 오류가 발생했습니다.',
    },
    errorPrefix: '오류',
    boxFragment: (n) => `박스 ${n}개`,
    polygonFragment: (v) => `${v}꼭짓점 다각형 프리즘`,
  },
  en: {
    modalTitle: 'Import STEP',
    filePickerLabel: 'Pick a STEP file (.step / .stp)',
    togglePaste: 'Paste STEP source instead',
    togglePicker: 'Back to file picker',
    sourcePlaceholder: 'ISO-10303-21; ... END-ISO-10303-21;',
    submit: 'Import',
    cancel: 'Cancel',
    importing: 'Importing...',
    summarySingle: (count) => `Imported ${count} solid${count === 1 ? '' : 's'}.`,
    summaryEmpty: 'No recognised solids found.',
    warningsHeading: 'Warnings',
    unsupportedHeading: 'Unsupported geometry',
    errorByCode: {
      BAD_REQUEST: 'Bad request — please check the STEP source.',
      PAYLOAD_TOO_LARGE: 'STEP file is too large (max 5MB).',
      PARSE_ERROR: 'Could not parse STEP file.',
      NETWORK_ERROR: 'Network error.',
    },
    errorPrefix: 'Error',
    boxFragment: (n) => `${n} box${n === 1 ? '' : 'es'}`,
    polygonFragment: (v) => `${v}-vertex polygon prism`,
  },
  ja: {
    modalTitle: 'STEPインポート',
    filePickerLabel: 'STEPファイルを選択 (.step / .stp)',
    togglePaste: 'STEPソースを貼り付け',
    togglePicker: 'ファイル選択に戻る',
    sourcePlaceholder: 'ISO-10303-21; ... END-ISO-10303-21;',
    submit: 'インポート',
    cancel: 'キャンセル',
    importing: 'インポート中...',
    summarySingle: (count) => `${count}個のソリッドをインポートしました。`,
    summaryEmpty: '認識できるソリッドが見つかりません。',
    warningsHeading: '警告',
    unsupportedHeading: '未対応形状',
    errorByCode: {
      BAD_REQUEST: '不正なリクエストです。STEPソースを確認してください。',
      PAYLOAD_TOO_LARGE: 'STEPファイルが大きすぎます (最大5MB)。',
      PARSE_ERROR: 'STEPファイルを解析できません。',
      NETWORK_ERROR: 'ネットワークエラーが発生しました。',
    },
    errorPrefix: 'エラー',
    boxFragment: (n) => `ボックス${n}個`,
    polygonFragment: (v) => `${v}頂点ポリゴンプリズム`,
  },
  zh: {
    modalTitle: '导入 STEP',
    filePickerLabel: '选择 STEP 文件 (.step / .stp)',
    togglePaste: '改为粘贴 STEP 源',
    togglePicker: '返回文件选择',
    sourcePlaceholder: 'ISO-10303-21; ... END-ISO-10303-21;',
    submit: '导入',
    cancel: '取消',
    importing: '导入中...',
    summarySingle: (count) => `已导入 ${count} 个实体。`,
    summaryEmpty: '未找到可识别的实体。',
    warningsHeading: '警告',
    unsupportedHeading: '不支持的几何',
    errorByCode: {
      BAD_REQUEST: '错误请求 — 请检查 STEP 源。',
      PAYLOAD_TOO_LARGE: 'STEP 文件过大 (最大 5MB)。',
      PARSE_ERROR: '无法解析 STEP 文件。',
      NETWORK_ERROR: '网络错误。',
    },
    errorPrefix: '错误',
    boxFragment: (n) => `${n} 个长方体`,
    polygonFragment: (v) => `${v} 顶点多边形棱柱`,
  },
  es: {
    modalTitle: 'Importar STEP',
    filePickerLabel: 'Selecciona un archivo STEP (.step / .stp)',
    togglePaste: 'Pegar el código STEP en su lugar',
    togglePicker: 'Volver al selector de archivos',
    sourcePlaceholder: 'ISO-10303-21; ... END-ISO-10303-21;',
    submit: 'Importar',
    cancel: 'Cancelar',
    importing: 'Importando...',
    summarySingle: (count) => `Importado ${count} sólido${count === 1 ? '' : 's'}.`,
    summaryEmpty: 'No se encontraron sólidos reconocibles.',
    warningsHeading: 'Avisos',
    unsupportedHeading: 'Geometría no soportada',
    errorByCode: {
      BAD_REQUEST: 'Solicitud incorrecta — revisa el código STEP.',
      PAYLOAD_TOO_LARGE: 'El archivo STEP es demasiado grande (máx. 5 MB).',
      PARSE_ERROR: 'No se pudo analizar el archivo STEP.',
      NETWORK_ERROR: 'Error de red.',
    },
    errorPrefix: 'Error',
    boxFragment: (n) => `${n} caja${n === 1 ? '' : 's'}`,
    polygonFragment: (v) => `prisma poligonal de ${v} vértices`,
  },
  ar: {
    modalTitle: 'استيراد STEP',
    filePickerLabel: 'اختر ملف STEP (.step / .stp)',
    togglePaste: 'لصق مصدر STEP بدلاً من ذلك',
    togglePicker: 'العودة إلى اختيار الملف',
    sourcePlaceholder: 'ISO-10303-21; ... END-ISO-10303-21;',
    submit: 'استيراد',
    cancel: 'إلغاء',
    importing: 'جارٍ الاستيراد...',
    summarySingle: (count) => `تم استيراد ${count} مجسم.`,
    summaryEmpty: 'لم يتم العثور على مجسمات معروفة.',
    warningsHeading: 'تحذيرات',
    unsupportedHeading: 'هندسة غير مدعومة',
    errorByCode: {
      BAD_REQUEST: 'طلب غير صالح — تحقق من مصدر STEP.',
      PAYLOAD_TOO_LARGE: 'ملف STEP كبير جدًا (الحد الأقصى 5 ميغابايت).',
      PARSE_ERROR: 'تعذر تحليل ملف STEP.',
      NETWORK_ERROR: 'خطأ في الشبكة.',
    },
    errorPrefix: 'خطأ',
    boxFragment: (n) => `${n} صندوق`,
    polygonFragment: (v) => `موشور مضلع بـ ${v} رأس`,
  },
};

type ImportState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; tree: FeatureTree; warnings: string[]; unsupported: string[] }
  | { status: 'error'; message: string };

export interface StepImportResponse {
  ok: boolean;
  tree?: FeatureTree;
  warnings?: string[];
  unsupported?: string[];
  error?: string;
  message?: string;
}

export type StepImportFetcher = (
  body: { source: string } | FormData,
) => Promise<StepImportResponse>;

const defaultFetcher: StepImportFetcher = async (body) => {
  const init: RequestInit = body instanceof FormData
    ? { method: 'POST', body }
    : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      };
  const res = await fetch('/api/step-import', init);
  return (await res.json()) as StepImportResponse;
};

export interface StepImportModalProps {
  lang: StepImportLang;
  onClose: () => void;
  onImport: (tree: FeatureTree, warnings: string[], unsupported: string[]) => void;
  /** Injectable for tests. Defaults to POST /api/step-import. */
  stepImportFetcher?: StepImportFetcher;
}

/** 5 MB client-side cap matches the server-side limit. */
const MAX_BYTES = 5 * 1024 * 1024;

function describeTree(tree: FeatureTree, t: Dict): string {
  const nodes = tree.nodes;
  if (nodes.length === 0) return t.summaryEmpty;

  let boxCount = 0;
  const polygonVertices: number[] = [];
  for (const node of nodes) {
    if (node.payload.kind !== 'extrude') continue;
    const extrude = node.payload as ExtrudeFeature;
    if (extrude.loop.length === 4) boxCount++;
    else polygonVertices.push(extrude.loop.length);
  }

  const parts: string[] = [t.summarySingle(nodes.length)];
  const fragments: string[] = [];
  if (boxCount > 0) fragments.push(t.boxFragment(boxCount));
  for (const v of polygonVertices) fragments.push(t.polygonFragment(v));
  if (fragments.length > 0) parts.push(`(${fragments.join(', ')})`);
  return parts.join(' ');
}

export default function StepImportModal({
  lang,
  onClose,
  onImport,
  stepImportFetcher = defaultFetcher,
}: StepImportModalProps): React.ReactElement {
  const t = dict[lang];

  const [pasteMode, setPasteMode] = useState<boolean>(false);
  const [pastedSource, setPastedSource] = useState<string>('');
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [state, setState] = useState<ImportState>({ status: 'idle' });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onSubmit = useCallback(async () => {
    // Validate: at least one source must be supplied.
    if (pasteMode) {
      if (pastedSource.trim().length === 0) {
        setState({ status: 'error', message: t.errorByCode.BAD_REQUEST });
        return;
      }
      if (pastedSource.length > MAX_BYTES) {
        setState({ status: 'error', message: t.errorByCode.PAYLOAD_TOO_LARGE });
        return;
      }
    } else {
      if (!pickedFile) {
        setState({ status: 'error', message: t.errorByCode.BAD_REQUEST });
        return;
      }
      if (pickedFile.size > MAX_BYTES) {
        setState({ status: 'error', message: t.errorByCode.PAYLOAD_TOO_LARGE });
        return;
      }
    }

    setState({ status: 'loading' });
    try {
      let res: StepImportResponse;
      if (pasteMode) {
        res = await stepImportFetcher({ source: pastedSource });
      } else {
        const fd = new FormData();
        fd.append('file', pickedFile!, pickedFile!.name);
        res = await stepImportFetcher(fd);
      }
      if (res.ok && res.tree) {
        const warnings = res.warnings ?? [];
        const unsupported = res.unsupported ?? [];
        setState({ status: 'ok', tree: res.tree, warnings, unsupported });
        onImport(res.tree, warnings, unsupported);
      } else {
        const codeKey = (res.error ?? 'PARSE_ERROR') as keyof Dict['errorByCode'];
        const localised = t.errorByCode[codeKey] ?? t.errorByCode.PARSE_ERROR;
        if (res.message) {
          console.warn('[step-import]', res.error, res.message);
        }
        setState({ status: 'error', message: localised });
      }
    } catch (e) {
      console.warn('[step-import] network error', e);
      setState({ status: 'error', message: t.errorByCode.NETWORK_ERROR });
    }
  }, [pasteMode, pastedSource, pickedFile, stepImportFetcher, onImport, t.errorByCode]);

  return (
    <div
      data-testid="step-import-modal"
      role="dialog"
      aria-labelledby="step-import-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#fff',
          padding: 20,
          borderRadius: 8,
          maxWidth: 640,
          width: '92%',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h3 id="step-import-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          {t.modalTitle}
        </h3>

        {!pasteMode && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            {t.filePickerLabel}
            <input
              ref={fileInputRef}
              type="file"
              accept=".step,.stp,.STEP,.STP"
              data-testid="step-import-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setPickedFile(f);
              }}
              style={{ fontSize: 12 }}
            />
          </label>
        )}

        {pasteMode && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            {t.togglePaste}
            <textarea
              data-testid="step-import-source-textarea"
              value={pastedSource}
              onChange={(e) => setPastedSource(e.target.value)}
              placeholder={t.sourcePlaceholder}
              rows={8}
              style={{
                padding: 8,
                fontFamily: 'monospace',
                fontSize: 11,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                resize: 'vertical',
              }}
            />
          </label>
        )}

        <button
          type="button"
          data-testid="step-import-toggle-paste"
          onClick={() => {
            setPasteMode((m) => !m);
            setState({ status: 'idle' });
          }}
          style={{
            alignSelf: 'flex-start',
            padding: '4px 8px',
            fontSize: 11,
            background: '#f3f4f6',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {pasteMode ? t.togglePicker : t.togglePaste}
        </button>

        {state.status === 'loading' && (
          <div style={{ padding: 12, textAlign: 'center', color: '#6b7280', fontSize: 12 }}>
            {t.importing}
          </div>
        )}

        {state.status === 'error' && (
          <div
            data-testid="step-import-error"
            style={{
              padding: 12,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
              color: '#dc2626',
              fontSize: 12,
            }}
          >
            {t.errorPrefix}: {state.message}
          </div>
        )}

        {state.status === 'ok' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              data-testid="step-import-summary"
              style={{
                padding: 10,
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: 4,
                color: '#065f46',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {describeTree(state.tree, t)}
            </div>
            {state.warnings.length > 0 && (
              <div data-testid="step-import-warnings">
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  {t.warningsHeading}
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 20,
                    fontSize: 11,
                    color: '#92400e',
                    background: '#fffbeb',
                    border: '1px solid #fcd34d',
                    borderRadius: 4,
                    padding: '6px 6px 6px 24px',
                  }}
                >
                  {state.warnings.map((w, idx) => (
                    <li key={idx} data-testid={`step-import-warning-${idx}`}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {state.unsupported.length > 0 && (
              <div data-testid="step-import-unsupported">
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  {t.unsupportedHeading}
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 20,
                    fontSize: 11,
                    color: '#92400e',
                    background: '#fff7ed',
                    border: '1px solid #fdba74',
                    borderRadius: 4,
                    padding: '6px 6px 6px 24px',
                  }}
                >
                  {state.unsupported.map((u, idx) => (
                    <li key={idx} data-testid={`step-import-unsupported-${idx}`}>{u}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={onClose}
            data-testid="step-import-cancel"
            style={{
              padding: '8px 16px',
              fontSize: 13,
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={state.status === 'loading'}
            data-testid="step-import-submit"
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              background: state.status === 'loading' ? '#e5e7eb' : '#0ea5e9',
              color: state.status === 'loading' ? '#9ca3af' : '#fff',
              border: '1px solid #0284c7',
              borderRadius: 4,
              cursor: state.status === 'loading' ? 'not-allowed' : 'pointer',
            }}
          >
            {t.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
