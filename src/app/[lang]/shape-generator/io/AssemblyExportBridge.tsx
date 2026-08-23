'use client';

/**
 * AssemblyExportBridge.tsx — one-component host wiring for the nested
 * assembly STEP exporter.
 *
 * Ties together:
 *   - AssemblyTreeEditor (sub-asm tree builder UI, controlled)
 *   - stitchNestedAssemblyHierarchy (v2.1 nested STEP stitcher)
 *   - downloadBlob (browser save / Tauri dialog)
 *
 * Why a bridge (mirrors DirectEditHostBridge pattern):
 *   - Host gets a one-line mount:
 *       <AssemblyExportBridge availableParts={parts} resolvePartStepText={fn} />
 *   - The caller is the *only* code that knows how to materialize a
 *     part's STEP text (it may live in OCCT cache, server, or be
 *     produced lazily) — the bridge stays storage-agnostic by routing
 *     leaf identity → STEP through the injected `resolvePartStepText`.
 *   - Leaves that have no STEP yet (resolver returns null) are skipped
 *     and surfaced via `onDiagnostics` rather than aborting the export.
 *
 * Tree state:
 *   - Owned internally. `initialRoot` seeds the first render. Caller
 *     can omit it and we start with an empty root sub-assembly.
 *   - `triggerExport()` is exposed via `testHandleRef` so tests can run
 *     the export path without simulating a click.
 */

import React, {
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import * as THREE from 'three';
import { downloadBlob } from '@/lib/platform';
import {
  AssemblyTreeEditor,
  emptySubAssembly,
  emptyLeaf,
} from './AssemblyTreeEditor';
import {
  stitchNestedAssemblyHierarchy,
  type AssemblySubNode,
} from './assemblyStepHierarchy';

// ─── i18n (inline dict — 6 lang) ──────────────────────────────────────────

type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  readonly assemblyName: string;
  readonly exportStep: string;
  readonly exporting: string;
  readonly lastExport: (n: number) => string;
  readonly failedSuffix: (m: number) => string;
  readonly emptyTree: string;
}

const DICTS: Record<Lang, Dict> = {
  ko: {
    assemblyName: '어셈블리 이름',
    exportStep: 'STEP 내보내기',
    exporting: '내보내는 중…',
    lastExport: (n) => `최근 내보내기: ${n}개 부품`,
    failedSuffix: (m) => `${m}개 실패`,
    emptyTree: '빈 트리 — 부품을 최소 1개 추가하세요',
  },
  en: {
    assemblyName: 'Assembly name',
    exportStep: 'Export STEP',
    exporting: 'Exporting…',
    lastExport: (n) => `Last export: ${n} parts`,
    failedSuffix: (m) => `${m} failed`,
    emptyTree: 'Empty tree — add at least one part',
  },
  ja: {
    assemblyName: 'アセンブリ名',
    exportStep: 'STEPをエクスポート',
    exporting: 'エクスポート中…',
    lastExport: (n) => `直近のエクスポート: ${n}個の部品`,
    failedSuffix: (m) => `${m}件失敗`,
    emptyTree: '空のツリー — 部品を少なくとも1つ追加してください',
  },
  zh: {
    assemblyName: '装配体名称',
    exportStep: '导出 STEP',
    exporting: '正在导出…',
    lastExport: (n) => `上次导出: ${n} 个零件`,
    failedSuffix: (m) => `${m} 个失败`,
    emptyTree: '空树 — 至少添加一个零件',
  },
  es: {
    assemblyName: 'Nombre del ensamble',
    exportStep: 'Exportar STEP',
    exporting: 'Exportando…',
    lastExport: (n) => `Última exportación: ${n} piezas`,
    failedSuffix: (m) => `${m} fallidas`,
    emptyTree: 'Árbol vacío — añada al menos una pieza',
  },
  ar: {
    assemblyName: 'اسم التجميع',
    exportStep: 'تصدير STEP',
    exporting: 'جارٍ التصدير…',
    lastExport: (n) => `آخر تصدير: ${n} قطعة`,
    failedSuffix: (m) => `${m} فشل`,
    emptyTree: 'شجرة فارغة — أضف قطعة واحدة على الأقل',
  },
};

function pickDict(lang: string | undefined | null): Dict {
  if (!lang) return DICTS.en;
  const lower = lang.toLowerCase();
  if (lower in DICTS) return DICTS[lower as Lang];
  return DICTS.en;
}

// ─── Tree walk helpers ────────────────────────────────────────────────────

/** Walk the tree and collect every leaf's partId (with its tree path so
 *  we can later swap the leaf node carrying the resolved stepText). */
interface LeafLocation {
  partId: string;
  path: number[];
}

function collectLeafLocations(root: AssemblySubNode): LeafLocation[] {
  const out: LeafLocation[] = [];
  function walk(n: AssemblySubNode, path: number[]): void {
    if (n.kind === 'part') {
      out.push({ partId: n.partId, path });
      return;
    }
    n.children.forEach((c, i) => walk(c, [...path, i]));
  }
  walk(root, []);
  return out;
}

/** Replace the leaf at `path` with a new leaf carrying the resolved
 *  stepText. Returns a structurally cloned tree. */
function withLeafStepText(
  root: AssemblySubNode,
  path: readonly number[],
  stepText: string,
): AssemblySubNode {
  if (path.length === 0) {
    if (root.kind !== 'part') return root;
    return { ...root, stepText };
  }
  if (root.kind !== 'subAssembly') return root;
  const [head, ...rest] = path;
  if (head < 0 || head >= root.children.length) return root;
  const nextChildren = root.children.slice();
  nextChildren[head] = withLeafStepText(nextChildren[head], rest, stepText);
  return { ...root, children: nextChildren };
}

/** Inject per-partId transforms into every matching leaf, overriding
 *  any existing leaf.transform. Use case: host has authoritative
 *  per-part positions/rotations (e.g. PlacedPart.position +
 *  PlacedPart.rotation) and wants those to win over the leaf's own
 *  identity transform stamped by emptyLeaf. Returns a structurally
 *  cloned tree. */
function injectPartTransforms(
  root: AssemblySubNode,
  partTransforms: Readonly<Record<string, THREE.Matrix4>>,
): AssemblySubNode {
  if (root.kind === 'part') {
    const next = partTransforms[root.partId];
    if (!next) return root;
    return { ...root, transform: next };
  }
  const nextChildren = root.children.map((c) => injectPartTransforms(c, partTransforms));
  return { ...root, children: nextChildren };
}

/** Prune leaves whose path is in `skipPaths` (Set of path-as-string).
 *  Empty sub-assemblies that result are also pruned. Returns null if
 *  the entire tree becomes empty. */
function pruneSkippedLeaves(
  root: AssemblySubNode,
  skipPaths: ReadonlySet<string>,
  curPath: number[] = [],
): AssemblySubNode | null {
  if (root.kind === 'part') {
    return skipPaths.has(curPath.join('.')) ? null : root;
  }
  const keptChildren: AssemblySubNode[] = [];
  root.children.forEach((c, i) => {
    const kept = pruneSkippedLeaves(c, skipPaths, [...curPath, i]);
    if (kept) keptChildren.push(kept);
  });
  if (keptChildren.length === 0 && curPath.length > 0) {
    // Empty interior sub-asm — drop it (root is always preserved so the
    // stitcher gets a chance to throw "no children" cleanly).
    return null;
  }
  return { ...root, children: keptChildren };
}

// ─── Component ────────────────────────────────────────────────────────────

export interface AssemblyExportBridgeProps {
  readonly lang?: string;
  /** Initial tree (controlled outside or seeded). */
  readonly initialRoot?: AssemblySubNode;
  /** Scene-side parts available as leaf nodes. */
  readonly availableParts: readonly { id: string; label: string }[];
  /**
   * Caller-provided STEP text resolver per leaf partId. Returns null
   * when the part has no STEP yet (e.g. not exported). Bridge skips
   * leaves that return null and surfaces them in onDiagnostics.
   */
  readonly resolvePartStepText: (partId: string) => Promise<string | null> | string | null;
  /** Optional: caller can react to export failures per leaf. */
  readonly onDiagnostics?: (
    diags: ReadonlyArray<{ partId: string; warning: string }>,
  ) => void;
  /**
   * Per-partId transforms applied right before stitching. Override
   * whatever transform the leaf node carries (e.g. the identity
   * Matrix4 stamped by AssemblyTreeEditor.emptyLeaf). Use case:
   * host has authoritative PlacedPart.position/rotation and wants
   * those positions baked into the exported NAUO STEP. When omitted,
   * the leaf's own transform survives unchanged.
   */
  readonly partTransforms?: Readonly<Record<string, THREE.Matrix4>>;
  /**
   * Optional 2D assembly drawing SVG. When provided, the bridge
   * downloads a `.zip` containing both `<asmName>.step` and
   * `<asmName>.svg` instead of the bare STEP. Use case: host has
   * generated a multi-view assembly drawing via
   * `analysis/assemblyDrawing.generateAssemblyDrawing` +
   * `analysis/drawingExport.buildDrawingSvgString` and wants both
   * deliverables packed for vendor handoff.
   *
   * Accepts a sync string OR an async resolver — the latter lets
   * the host defer the (cheap but non-trivial) SVG generation until
   * the user actually clicks Export.
   */
  readonly resolveAssemblyDrawing?: () => Promise<string | null> | string | null;
  /**
   * Optional assembly mates manifest as a JSON string. When
   * provided, the bridge adds `<asmName>.mates.json` to the zip
   * alongside the STEP + SVG. Use case: host serializes
   * `assemblyMates` (AssemblyMate[]) so vendor CAMs can re-create
   * constraints. Phase 6a — JSON manifest is more practical than
   * real AP242 KINEMATIC_PAIR (most CAMs don't parse those).
   *
   * Triggers the zip path independently of resolveAssemblyDrawing,
   * so a host that provides mates BUT not SVG still gets a zip with
   * STEP + mates.json. Sync or async resolver accepted.
   */
  readonly resolveAssemblyMatesJson?: () => Promise<string | null> | string | null;
  /** Asm name default for the file. */
  readonly defaultAsmName?: string;
  readonly testId?: string;
  /** Imperative handle so tests (and host hotkeys) can drive the
   *  export without a click. */
  readonly testHandleRef?: React.RefObject<AssemblyExportBridgeHandle | null>;
}

export interface AssemblyExportBridgeHandle {
  /** Run the resolve → stitch → download pipeline. Resolves when the
   *  download has been kicked off (or when an early-exit branch
   *  returns — empty tree, all leaves null, etc.). */
  triggerExport: () => Promise<void>;
  /** Current asm name (handy for assertions). */
  getAsmName: () => string;
  /** Current tree (read-only — for tests). */
  getRoot: () => AssemblySubNode;
}

function makeEmptyRoot(): AssemblySubNode {
  return {
    kind: 'subAssembly',
    subAsmId: 'root',
    label: 'Assembly',
    transform: new THREE.Matrix4().identity(),
    children: [],
  };
}

export function AssemblyExportBridge(
  props: AssemblyExportBridgeProps,
): React.ReactElement {
  const {
    lang = 'en',
    initialRoot,
    availableParts,
    resolvePartStepText,
    onDiagnostics,
    partTransforms,
    resolveAssemblyDrawing,
    resolveAssemblyMatesJson,
    defaultAsmName,
    testId = 'assembly-export-bridge',
    testHandleRef,
  } = props;

  const dict = useMemo(() => pickDict(lang), [lang]);
  const isRtl = (lang ?? '').toLowerCase().startsWith('ar');

  const [asmName, setAsmName] = useState<string>(defaultAsmName ?? 'Assembly_1');
  const [root, setRoot] = useState<AssemblySubNode>(initialRoot ?? makeEmptyRoot());
  const [isExporting, setIsExporting] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: number; failed: number } | null>(null);

  const leafLocations = useMemo(() => collectLeafLocations(root), [root]);
  const hasAnyLeaves = leafLocations.length > 0;

  const runExport = useCallback(async (): Promise<void> => {
    if (!hasAnyLeaves || isExporting) return;
    setIsExporting(true);
    setLastResult(null);
    try {
      // 1. Resolve every leaf's STEP text in parallel.
      const resolved = await Promise.all(
        leafLocations.map(async (loc) => {
          try {
            const text = await Promise.resolve(resolvePartStepText(loc.partId));
            return { loc, text };
          } catch (err) {
            return { loc, text: null as string | null, err };
          }
        }),
      );

      // 2. Partition into successes / skips. Skips become diagnostics.
      const diags: { partId: string; warning: string }[] = [];
      const skipPaths = new Set<string>();
      let okCount = 0;
      let rootWithStep: AssemblySubNode = root;
      for (const r of resolved) {
        if (r.text == null) {
          skipPaths.add(r.loc.path.join('.'));
          diags.push({
            partId: r.loc.partId,
            warning: 'resolvePartStepText returned null — part has no STEP available',
          });
          continue;
        }
        rootWithStep = withLeafStepText(rootWithStep, r.loc.path, r.text);
        okCount++;
      }

      // 3. Need at least one OK leaf to stitch.
      if (okCount === 0) {
        setLastResult({ ok: 0, failed: diags.length });
        if (diags.length > 0) onDiagnostics?.(diags);
        return;
      }

      // 4. Prune skipped leaves before stitching (stitcher can't handle
      //    a leaf without stepText — it would push a "no PRODUCT_DEFINITION"
      //    diagnostic, but better to drop them up-front to keep the
      //    stitcher's diagnostic surface focused on real STEP parse issues).
      const pruned = pruneSkippedLeaves(rootWithStep, skipPaths) ?? rootWithStep;

      // 4b. Inject per-partId transforms (e.g. PlacedPart.position/
      //     rotation) into the matching leaves. No-op when partTransforms
      //     prop is omitted.
      const withTransforms = partTransforms
        ? injectPartTransforms(pruned, partTransforms)
        : pruned;

      // 5. Stitch + download. Stitcher diagnostics are appended.
      let result: ReturnType<typeof stitchNestedAssemblyHierarchy>;
      try {
        result = stitchNestedAssemblyHierarchy(withTransforms, asmName);
      } catch (err) {
        diags.push({
          partId: '__assembly_export__',
          warning: `assembly STEP hierarchy could not be generated: ${err instanceof Error ? err.message : String(err)}`,
        });
        setLastResult({ ok: 0, failed: diags.length });
        onDiagnostics?.(diags);
        return;
      }
      for (const d of result.diagnostics) diags.push(d);

      const safeName = asmName.replace(/[^a-zA-Z0-9_\-.]/g, '_') || 'Assembly';

      // Phase 5j + 6a — gather optional bundle companions:
      //   - drawing SVG (5j)
      //   - mates manifest JSON (6a)
      // If EITHER is present, switch to zip download (STEP + companions).
      // Otherwise download bare STEP (v1 behaviour preserved).
      let drawingSvg: string | null = null;
      if (resolveAssemblyDrawing) {
        try {
          drawingSvg = await Promise.resolve(resolveAssemblyDrawing());
        } catch (err) {
          diags.push({
            partId: '__assembly_drawing__',
            warning: `resolveAssemblyDrawing threw: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
      let matesJson: string | null = null;
      if (resolveAssemblyMatesJson) {
        try {
          matesJson = await Promise.resolve(resolveAssemblyMatesJson());
        } catch (err) {
          diags.push({
            partId: '__assembly_mates__',
            warning: `resolveAssemblyMatesJson threw: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      if (drawingSvg || matesJson) {
        const { zipSync, strToU8 } = await import('fflate');
        const files: Record<string, Uint8Array> = {
          [`${safeName}/${safeName}.step`]: strToU8(result.stepText),
        };
        if (drawingSvg) files[`${safeName}/${safeName}.svg`] = strToU8(drawingSvg);
        if (matesJson) files[`${safeName}/${safeName}.mates.json`] = strToU8(matesJson);
        const zipBytes = zipSync(files);
        await downloadBlob(
          `${safeName}.zip`,
          new Blob([new Uint8Array(zipBytes)], { type: 'application/zip' }),
        );
      } else {
        await downloadBlob(
          `${safeName}.step`,
          new Blob([result.stepText], { type: 'application/octet-stream' }),
        );
      }

      setLastResult({ ok: result.partCount, failed: diags.length });
      if (diags.length > 0) onDiagnostics?.(diags);
    } finally {
      setIsExporting(false);
    }
  }, [
    asmName,
    hasAnyLeaves,
    isExporting,
    leafLocations,
    onDiagnostics,
    partTransforms,
    resolveAssemblyDrawing,
    resolveAssemblyMatesJson,
    resolvePartStepText,
    root,
  ]);

  useImperativeHandle(
    testHandleRef,
    () => ({
      triggerExport: runExport,
      getAsmName: () => asmName,
      getRoot: () => root,
    }),
    [runExport, asmName, root],
  );

  // ── Inline styles ────────────────────────────────────────────────────────
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
    alignItems: 'center',
    gap: 8,
  };
  const labelStyle: React.CSSProperties = {
    color: 'var(--nx-text-3, #6b7280)',
    minWidth: 110,
  };
  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 120,
    padding: '4px 6px',
    fontSize: 12,
    border: '1px solid var(--nx-border, #2d3138)',
    borderRadius: 3,
    background: 'var(--nx-bg, #0f1115)',
    color: 'var(--nx-text, #e5e7eb)',
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
    background: disabled ? 'var(--nx-panel-2, #22252b)' : 'var(--nx-accent, #22d3ee)',
    color: disabled ? 'var(--nx-text-3, #6b7280)' : '#000',
    opacity: disabled ? 0.6 : 1,
  });
  const statusStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--nx-text-3, #6b7280)',
  };

  const exportDisabled = !hasAnyLeaves || isExporting;

  let statusText = '';
  if (isExporting) {
    statusText = dict.exporting;
  } else if (lastResult) {
    statusText = dict.lastExport(lastResult.ok);
    if (lastResult.failed > 0) {
      statusText += ` · ${dict.failedSuffix(lastResult.failed)}`;
    }
  } else if (!hasAnyLeaves) {
    statusText = dict.emptyTree;
  }

  return (
    <div
      style={containerStyle}
      data-testid={testId}
      dir={isRtl ? 'rtl' : undefined}
    >
      <div style={headerRow}>
        <span style={labelStyle}>{dict.assemblyName}</span>
        <input
          type="text"
          style={inputStyle}
          value={asmName}
          onChange={(e) => setAsmName(e.target.value)}
          data-testid={`${testId}-asm-name`}
        />
      </div>

      <AssemblyTreeEditor
        root={root}
        onChange={(next) => {
          setRoot(next);
          // Stale "last export" status would be misleading once the
          // tree changes — clear it.
          setLastResult(null);
        }}
        availablePartIds={availableParts}
        lang={lang}
        testId={`${testId}-tree`}
      />

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
          {dict.exportStep}
        </button>
        <span style={statusStyle} data-testid={`${testId}-status`}>
          {statusText}
        </span>
      </div>
    </div>
  );
}

// Helpers re-exported for host-side wiring + tests.
export { emptySubAssembly, emptyLeaf, makeEmptyRoot };
