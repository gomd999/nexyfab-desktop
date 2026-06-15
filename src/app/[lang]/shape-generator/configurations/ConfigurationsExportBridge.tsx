'use client';

/**
 * ConfigurationsExportBridge.tsx — one-component host wiring for the
 * configurations bundle exporter (C7).
 *
 * Mirrors the AssemblyExportBridge / DirectEditHostBridge pattern:
 *   - Host gets a one-line mount:
 *       <ConfigurationsExportBridge
 *         partName="bracket"
 *         configs={cfgs}
 *         exportConfigStep={fn}
 *       />
 *   - The caller is the *only* code that knows how to materialize a
 *     given config's STEP text (it needs the parametric pipeline +
 *     ConfigStore which the host owns). The bridge stays storage-
 *     agnostic by routing configId → STEP through the injected
 *     `exportConfigStep` callback, then hands the result list to
 *     `buildConfigurationsBundle` for zip + manifest packaging.
 *   - Per-config drawings are optional. When `resolveConfigDrawing`
 *     is provided we await it for every config in parallel and feed
 *     the SVG into the bundle's `drawingSvg` field.
 *   - `triggerExport()` is exposed via `testHandleRef` so tests + host
 *     hotkeys can drive the export path without a click.
 */

import React, {
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { downloadBlob } from '@/lib/platform';
import {
  buildConfigurationsBundle,
  type BundleConfigInput,
  type BundleManifestEntry,
  type ConfigurationsBundleResult,
} from './configurationsExportBundle';

// ─── i18n (inline dict — 6 lang) ──────────────────────────────────────────

type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  readonly title: string;
  readonly configCount: (n: number) => string;
  readonly exportBtn: string;
  readonly exporting: string;
  readonly statusPending: string;
  readonly statusOk: string;
  readonly statusFailed: string;
  readonly lastExport: (ok: number, failed: number) => string;
  readonly emptyConfigs: string;
}

const DICTS: Record<Lang, Dict> = {
  ko: {
    title: '모든 구성 내보내기',
    configCount: (n) => `${n}개 구성`,
    exportBtn: '내보내기',
    exporting: '내보내는 중…',
    statusPending: '대기',
    statusOk: '성공',
    statusFailed: '실패',
    lastExport: (ok, failed) => `최근 내보내기: ${ok}개 성공 / ${failed}개 실패`,
    emptyConfigs: '구성이 없습니다',
  },
  en: {
    title: 'Export all configurations',
    configCount: (n) => `${n} configurations`,
    exportBtn: 'Export',
    exporting: 'Exporting…',
    statusPending: 'Pending',
    statusOk: 'OK',
    statusFailed: 'Failed',
    lastExport: (ok, failed) => `Last export: ${ok} ok / ${failed} failed`,
    emptyConfigs: 'No configurations available',
  },
  ja: {
    title: 'すべての構成をエクスポート',
    configCount: (n) => `${n}件の構成`,
    exportBtn: 'エクスポート',
    exporting: 'エクスポート中…',
    statusPending: '待機中',
    statusOk: '成功',
    statusFailed: '失敗',
    lastExport: (ok, failed) => `直近のエクスポート: ${ok}件成功 / ${failed}件失敗`,
    emptyConfigs: '構成がありません',
  },
  zh: {
    title: '导出所有配置',
    configCount: (n) => `${n} 个配置`,
    exportBtn: '导出',
    exporting: '正在导出…',
    statusPending: '待处理',
    statusOk: '成功',
    statusFailed: '失败',
    lastExport: (ok, failed) => `上次导出: ${ok} 个成功 / ${failed} 个失败`,
    emptyConfigs: '没有可用的配置',
  },
  es: {
    title: 'Exportar todas las configuraciones',
    configCount: (n) => `${n} configuraciones`,
    exportBtn: 'Exportar',
    exporting: 'Exportando…',
    statusPending: 'Pendiente',
    statusOk: 'OK',
    statusFailed: 'Fallido',
    lastExport: (ok, failed) => `Última exportación: ${ok} ok / ${failed} fallidas`,
    emptyConfigs: 'No hay configuraciones disponibles',
  },
  ar: {
    title: 'تصدير جميع التكوينات',
    configCount: (n) => `${n} تكوينات`,
    exportBtn: 'تصدير',
    exporting: 'جارٍ التصدير…',
    statusPending: 'قيد الانتظار',
    statusOk: 'نجح',
    statusFailed: 'فشل',
    lastExport: (ok, failed) => `آخر تصدير: ${ok} ناجح / ${failed} فاشل`,
    emptyConfigs: 'لا توجد تكوينات متاحة',
  },
};

function pickDict(lang: string | undefined | null): Dict {
  if (!lang) return DICTS.en;
  const lower = lang.toLowerCase();
  if (lower in DICTS) return DICTS[lower as Lang];
  return DICTS.en;
}

// ─── Public types ─────────────────────────────────────────────────────────

export type ConfigStatus = 'pending' | 'exporting' | 'ok' | 'failed';

export interface ConfigurationsExportBridgeProps {
  readonly lang?: string;
  /** Part name for the bundle file. */
  readonly partName: string;
  /** Configs list (from ConfigurationTable / ConfigStore). */
  readonly configs: readonly { id: string; name: string }[];
  /** Caller-provided STEP exporter per config — bridge calls
   *  Promise.all on all configs and packs the result. Return null to
   *  signal a per-config failure (the bundle keeps going). */
  readonly exportConfigStep: (configId: string) => Promise<string | null>;
  /** Optional per-config drawing SVG resolver. */
  readonly resolveConfigDrawing?: (
    configId: string,
  ) => Promise<string | null> | string | null;
  /** Optional callback after bundle build (e.g. host saves to disk). */
  readonly onBundleReady?: (result: {
    zipBytes: Uint8Array;
    manifest: unknown;
    diagnostics: unknown[];
  }) => void;
  readonly testId?: string;
  /** Imperative handle so tests (and host hotkeys) can drive the
   *  export without a click. */
  readonly testHandleRef?: React.RefObject<ConfigurationsExportBridgeHandle | null>;
}

export interface ConfigurationsExportBridgeHandle {
  /** Run the resolve → bundle → download pipeline. Resolves when the
   *  download has been kicked off (or when an early-exit branch
   *  returns — empty configs, etc.). */
  triggerExport: () => Promise<void>;
  /** Current per-config status map (read-only — for tests). */
  getStatuses: () => Readonly<Record<string, ConfigStatus>>;
}

// ─── Component ────────────────────────────────────────────────────────────

export function ConfigurationsExportBridge(
  props: ConfigurationsExportBridgeProps,
): React.ReactElement {
  const {
    lang = 'en',
    partName,
    configs,
    exportConfigStep,
    resolveConfigDrawing,
    onBundleReady,
    testId = 'configurations-export-bridge',
    testHandleRef,
  } = props;

  const dict = useMemo(() => pickDict(lang), [lang]);
  const isRtl = (lang ?? '').toLowerCase().startsWith('ar');

  const hasConfigs = configs.length > 0;

  const initialStatuses = useMemo<Record<string, ConfigStatus>>(() => {
    const o: Record<string, ConfigStatus> = {};
    for (const c of configs) o[c.id] = 'pending';
    return o;
  }, [configs]);

  const [statuses, setStatuses] = useState<Record<string, ConfigStatus>>(
    initialStatuses,
  );
  const [isExporting, setIsExporting] = useState(false);
  const [lastResult, setLastResult] = useState<{
    ok: number;
    failed: number;
    diagnostics: readonly BundleManifestEntry[];
  } | null>(null);

  // If the caller swaps `configs`, reset the status map so we don't
  // keep stale entries around for removed ids.
  React.useEffect(() => {
    setStatuses(initialStatuses);
    setLastResult(null);
  }, [initialStatuses]);

  const runExport = useCallback(async (): Promise<void> => {
    if (!hasConfigs || isExporting) return;
    setIsExporting(true);

    // 1. Mark every config as 'exporting' so the row icons spin.
    const nextStatuses: Record<string, ConfigStatus> = {};
    for (const c of configs) nextStatuses[c.id] = 'exporting';
    setStatuses(nextStatuses);

    try {
      // 2. Resolve drawings in parallel (optional). Failures here are
      //    non-fatal — the bundle just ships without a drawing for
      //    that config.
      const drawingMap: Record<string, string | undefined> = {};
      if (resolveConfigDrawing) {
        const resolved = await Promise.all(
          configs.map(async (c) => {
            try {
              const svg = await Promise.resolve(resolveConfigDrawing(c.id));
              return { id: c.id, svg: svg ?? undefined };
            } catch {
              return { id: c.id, svg: undefined };
            }
          }),
        );
        for (const r of resolved) drawingMap[r.id] = r.svg;
      }

      // 3. Build the bundle input list — order preserved.
      const bundleConfigs: BundleConfigInput[] = configs.map((c) => ({
        id: c.id,
        name: c.name,
        drawingSvg: drawingMap[c.id],
      }));

      // 4. Build the zip + manifest. buildConfigurationsBundle calls
      //    exportConfigStep itself (sequentially per config) and folds
      //    per-config failures into manifest.entries[i].status.
      const result: ConfigurationsBundleResult = await buildConfigurationsBundle({
        partName,
        configs: bundleConfigs,
        exportConfigStep,
      });

      // 5. Mirror manifest.entries[i].status back into the row UI.
      const finalStatuses: Record<string, ConfigStatus> = {};
      for (const e of result.manifest.entries) {
        finalStatuses[e.configId] = e.status;
      }
      // Any config absent from manifest (shouldn't happen since bundler
      // preserves order, but be defensive) defaults to 'failed'.
      for (const c of configs) {
        if (!(c.id in finalStatuses)) finalStatuses[c.id] = 'failed';
      }
      setStatuses(finalStatuses);

      const okCount = result.manifest.entries.filter(
        (e) => e.status === 'ok',
      ).length;
      const failedCount = result.diagnostics.length;
      setLastResult({
        ok: okCount,
        failed: failedCount,
        diagnostics: result.diagnostics,
      });

      // 6. Download the zip. Filename mirrors the bundler's slug rule
      //    loosely — keep the part name verbatim since downloadBlob
      //    handles browser-side sanitization.
      const safeName = (partName || 'configs').replace(/[^\w.-]+/g, '_');
      const filename = `${safeName}_configs.zip`;
      // `.buffer as ArrayBuffer` matches the existing zip blob pattern
      // in rfqBundler.ts — Uint8Array<ArrayBufferLike> isn't directly
      // assignable to BlobPart under the project's lib.dom typings.
      await downloadBlob(
        filename,
        new Blob([result.zipBytes.buffer as ArrayBuffer], {
          type: 'application/zip',
        }),
      );

      onBundleReady?.({
        zipBytes: result.zipBytes,
        manifest: result.manifest,
        diagnostics: [...result.diagnostics],
      });
    } finally {
      setIsExporting(false);
    }
  }, [
    configs,
    exportConfigStep,
    hasConfigs,
    isExporting,
    onBundleReady,
    partName,
    resolveConfigDrawing,
  ]);

  useImperativeHandle(
    testHandleRef,
    () => ({
      triggerExport: runExport,
      getStatuses: () => statuses,
    }),
    [runExport, statuses],
  );

  // ── Inline styles (match AssemblyExportBridge tokens) ─────────────────
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 10,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 12,
    color: 'var(--nx-text, #e5e7eb)',
    background: 'var(--nx-panel, #1a1d23)',
    border: '1px solid var(--nx-border, #2d3138)',
    borderRadius: 6,
  };
  const headerRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  };
  const titleStyle: React.CSSProperties = {
    fontWeight: 700,
    fontSize: 13,
  };
  const countStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--nx-text-3, #6b7280)',
  };
  const listStyle: React.CSSProperties = {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    maxHeight: 220,
    overflowY: 'auto',
    border: '1px solid var(--nx-border, #2d3138)',
    borderRadius: 4,
  };
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 8px',
    fontSize: 12,
  };
  const emptyStyle: React.CSSProperties = {
    padding: 8,
    fontSize: 12,
    color: 'var(--nx-text-3, #6b7280)',
    fontStyle: 'italic',
  };
  const footerRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  };
  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 700,
    border: '1px solid var(--nx-border, #2d3138)',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled
      ? 'var(--nx-panel-2, #22252b)'
      : 'var(--nx-accent, #22d3ee)',
    color: disabled ? 'var(--nx-text-3, #6b7280)' : '#000',
    opacity: disabled ? 0.6 : 1,
  });
  const statusStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--nx-text-3, #6b7280)',
  };
  const diagListStyle: React.CSSProperties = {
    margin: 0,
    padding: '4px 0 0 16px',
    fontSize: 11,
    color: 'var(--nx-warn, #f59e0b)',
  };

  function statusIcon(s: ConfigStatus): string {
    switch (s) {
      case 'exporting':
        return '⋯';
      case 'ok':
        return '✓';
      case 'failed':
        return '✕';
      case 'pending':
      default:
        return '·';
    }
  }
  function statusLabel(s: ConfigStatus): string {
    switch (s) {
      case 'exporting':
        return dict.exporting;
      case 'ok':
        return dict.statusOk;
      case 'failed':
        return dict.statusFailed;
      case 'pending':
      default:
        return dict.statusPending;
    }
  }

  const exportDisabled = !hasConfigs || isExporting;

  let bannerText = '';
  if (isExporting) {
    bannerText = dict.exporting;
  } else if (lastResult) {
    bannerText = dict.lastExport(lastResult.ok, lastResult.failed);
  }

  return (
    <div
      style={containerStyle}
      data-testid={testId}
      dir={isRtl ? 'rtl' : undefined}
    >
      <div style={headerRow}>
        <span style={titleStyle}>{dict.title}</span>
        <span style={countStyle} data-testid={`${testId}-count`}>
          {dict.configCount(configs.length)}
        </span>
      </div>

      {hasConfigs ? (
        <ul style={listStyle} data-testid={`${testId}-list`}>
          {configs.map((c) => {
            const s = statuses[c.id] ?? 'pending';
            return (
              <li
                key={c.id}
                style={rowStyle}
                data-testid={`${testId}-row-${c.id}`}
                data-status={s}
              >
                <span>{c.name}</span>
                <span
                  data-testid={`${testId}-status-${c.id}`}
                  aria-label={statusLabel(s)}
                  title={statusLabel(s)}
                >
                  {statusIcon(s)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div style={emptyStyle} data-testid={`${testId}-empty`}>
          {dict.emptyConfigs}
        </div>
      )}

      <div style={footerRow}>
        <button
          type="button"
          style={btnStyle(exportDisabled)}
          disabled={exportDisabled}
          onClick={() => {
            void runExport();
          }}
          data-testid={`${testId}-export`}
        >
          {isExporting ? dict.exporting : dict.exportBtn}
        </button>
        <span style={statusStyle} data-testid={`${testId}-banner`}>
          {bannerText}
        </span>
      </div>

      {lastResult && lastResult.diagnostics.length > 0 && (
        <ul
          style={diagListStyle}
          data-testid={`${testId}-diagnostics`}
        >
          {lastResult.diagnostics.map((d) => (
            <li key={d.configId} data-testid={`${testId}-diag-${d.configId}`}>
              {d.configName}: {d.failureReason ?? dict.statusFailed}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
