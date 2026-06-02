'use client';

/**
 * SolverSketchEditorWithExtrude — Phase 2.A wrapper of SolverSketchEditor
 * adding an "Extrude" button + depth/options modal + SCAD/PNG preview pane.
 *
 * Architecture:
 *   - Wraps the unchanged SolverSketchEditor (Phase 1.3 sibling stays as-is).
 *   - Listens to `onSketchChange` to mirror the current sketch state locally.
 *   - "Extrude" button opens a modal with depth + direction + mode inputs.
 *   - On submit: POST /api/extrude-render → renders to SCAD + PNG → shows preview.
 *
 * Test surface (data-testids):
 *   solver-extrude-button, solver-extrude-modal,
 *   solver-extrude-depth-input, solver-extrude-submit, solver-extrude-cancel,
 *   solver-extrude-scad-preview, solver-extrude-png-preview-{idx},
 *   solver-extrude-error.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import SolverSketchEditor, { type SolverSketchEditorProps } from './SolverSketchEditor';
import RevolveModal, { type RevolveFetcher, type RevolveLang } from './RevolveModal';
import type { SweepFetcher, SweepLang } from './SweepModal';
import type { LoftFetcher, LoftLang } from './LoftModal';
import type { PatternFetcher, PatternLang } from './PatternModal';
import type { ShellFetcher, ShellLang } from './ShellModal';
import type { HoleFetcher, HoleWizardLang } from './HoleWizardModal';
import type { FilletFetcher, FilletLang } from './FilletModal';
import type { ChamferFetcher, ChamferLang } from './ChamferModal';
import FeatureTreeView, { type FeatureTreeLang } from './FeatureTreeView';
import type { StepImportFetcher, StepImportLang } from './StepImportModal';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import type { ExtrudeDirection, ExtrudeMode } from '@/lib/cad/extrudeProfile';
import type { AxisLine2D } from '@/lib/cad/revolveProfile';
import {
  type FeatureKind,
  type FeatureNode,
  type FeatureTree,
} from '@/lib/cad/featureTree';
import { applyEdit, FeatureTreeEditError } from '@/lib/cad/featureTreeEdit';
import {
  useFeatureTreeStorage,
  type SaveError,
} from '@/lib/cad/featureTreePersist';

// StlViewer pulls in Three.js + STLLoader; dynamic-loaded to keep the
// Sketch editor bundle small for users who never click Extrude.
const StlViewer = dynamic(() => import('./StlViewer'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>3D viewer loading…</div>,
});

// Sweep / Loft / Pattern modals are also dynamic-loaded so the wrapper
// bundle stays small for users who never open them. Each modal pulls in
// its own copy of the StlViewer dynamic chunk, but only when first opened.
const SweepModal = dynamic(() => import('./SweepModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
const LoftModal = dynamic(() => import('./LoftModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
const PatternModal = dynamic(() => import('./PatternModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
const ShellModal = dynamic(() => import('./ShellModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
const HoleWizardModal = dynamic(() => import('./HoleWizardModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
const FilletModal = dynamic(() => import('./FilletModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
const ChamferModal = dynamic(() => import('./ChamferModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
const StepImportModal = dynamic(() => import('./StepImportModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});

type Lang = NonNullable<SolverSketchEditorProps['lang']>;

interface Dict {
  extrude: string;
  revolve: string;
  sweep: string;
  loft: string;
  pattern: string;
  shell: string;
  hole: string;
  fillet: string;
  chamfer: string;
  importStep: string;
  importModeLabel: string;
  importModeReplace: string;
  importModeMerge: string;
  modalTitle: string;
  depth: string;
  direction: string;
  mode: string;
  draft: string;
  oneSided: string; twoSided: string; midplane: string;
  add: string; cut: string;
  submit: string; cancel: string;
  rendering: string;
  scadHeading: string;
  pngHeading: string;
  errorPrefix: string;
  errorDepthInvalid: string;
  /** Persistence (Phase 2.8) — shown when a projectId is provided. */
  savedAt: string;
  saveError: string;
  reset: string;
}

const dict: Record<Lang, Dict> = {
  ko: {
    extrude: '돌출', revolve: '회전', sweep: '스윕', loft: '로프트', pattern: '패턴', shell: '쉘', hole: '구멍', fillet: '필렛', chamfer: '모따기',
    importStep: 'STEP 가져오기', importModeLabel: '가져오기 모드',
    importModeReplace: '교체', importModeMerge: '병합',
    modalTitle: '돌출 설정', depth: '깊이 (mm)', direction: '방향', mode: '연산', draft: '드래프트 각도(°)',
    oneSided: '한 방향', twoSided: '양 방향', midplane: '중심면',
    add: '추가', cut: '제거',
    submit: '돌출', cancel: '취소',
    rendering: '렌더링 중...', scadHeading: 'SCAD 소스', pngHeading: '미리보기',
    errorPrefix: '오류',
    errorDepthInvalid: '깊이는 0보다 커야 합니다',
    savedAt: '저장됨',
    saveError: '저장 실패',
    reset: '초기화',
  },
  en: {
    extrude: 'Extrude', revolve: 'Revolve', sweep: 'Sweep', loft: 'Loft', pattern: 'Pattern', shell: 'Shell', hole: 'Hole', fillet: 'Fillet', chamfer: 'Chamfer',
    importStep: 'Import STEP', importModeLabel: 'Import mode',
    importModeReplace: 'Replace', importModeMerge: 'Merge',
    modalTitle: 'Extrude options', depth: 'Depth (mm)', direction: 'Direction', mode: 'Mode', draft: 'Draft angle (°)',
    oneSided: 'One-sided', twoSided: 'Two-sided', midplane: 'Midplane',
    add: 'Add', cut: 'Cut',
    submit: 'Extrude', cancel: 'Cancel',
    rendering: 'Rendering...', scadHeading: 'SCAD source', pngHeading: 'Preview',
    errorPrefix: 'Error',
    errorDepthInvalid: 'depth must be > 0',
    savedAt: 'Saved',
    saveError: 'Save failed',
    reset: 'Reset',
  },
  ja: {
    extrude: '押し出し', revolve: '回転', sweep: 'スイープ', loft: 'ロフト', pattern: 'パターン', shell: 'シェル', hole: '穴', fillet: 'フィレット', chamfer: '面取り',
    importStep: 'STEPインポート', importModeLabel: 'インポートモード',
    importModeReplace: '置換', importModeMerge: 'マージ',
    modalTitle: '押し出し設定', depth: '深さ (mm)', direction: '方向', mode: '操作', draft: 'ドラフト角度(°)',
    oneSided: '片側', twoSided: '両側', midplane: '中央面',
    add: '追加', cut: '除去',
    submit: '押し出し', cancel: 'キャンセル',
    rendering: 'レンダリング中...', scadHeading: 'SCADソース', pngHeading: 'プレビュー',
    errorPrefix: 'エラー',
    errorDepthInvalid: '深さは 0 より大きい必要があります',
    savedAt: '保存済み',
    saveError: '保存失敗',
    reset: 'リセット',
  },
  zh: {
    extrude: '拉伸', revolve: '旋转', sweep: '扫掠', loft: '放样', pattern: '阵列', shell: '抽壳', hole: '孔', fillet: '圆角', chamfer: '倒角',
    importStep: '导入 STEP', importModeLabel: '导入模式',
    importModeReplace: '替换', importModeMerge: '合并',
    modalTitle: '拉伸选项', depth: '深度 (mm)', direction: '方向', mode: '模式', draft: '拔模角度(°)',
    oneSided: '单向', twoSided: '双向', midplane: '中面',
    add: '增加', cut: '切除',
    submit: '拉伸', cancel: '取消',
    rendering: '渲染中...', scadHeading: 'SCAD源', pngHeading: '预览',
    errorPrefix: '错误',
    errorDepthInvalid: '深度必须大于 0',
    savedAt: '已保存',
    saveError: '保存失败',
    reset: '重置',
  },
  es: {
    extrude: 'Extruir', revolve: 'Revolver', sweep: 'Barrido', loft: 'Loft', pattern: 'Patrón', shell: 'Vaciar', hole: 'Agujero', fillet: 'Redondeo', chamfer: 'Chaflán',
    importStep: 'Importar STEP', importModeLabel: 'Modo de importación',
    importModeReplace: 'Reemplazar', importModeMerge: 'Combinar',
    modalTitle: 'Opciones de extrusión', depth: 'Profundidad (mm)', direction: 'Dirección', mode: 'Modo', draft: 'Ángulo de salida(°)',
    oneSided: 'Un lado', twoSided: 'Dos lados', midplane: 'Plano medio',
    add: 'Añadir', cut: 'Cortar',
    submit: 'Extruir', cancel: 'Cancelar',
    rendering: 'Renderizando...', scadHeading: 'Fuente SCAD', pngHeading: 'Vista previa',
    errorPrefix: 'Error',
    errorDepthInvalid: 'la profundidad debe ser > 0',
    savedAt: 'Guardado',
    saveError: 'Error al guardar',
    reset: 'Restablecer',
  },
  ar: {
    extrude: 'بثق', revolve: 'دوران', sweep: 'كنس', loft: 'لوفت', pattern: 'نمط', shell: 'قشرة', hole: 'ثقب', fillet: 'تدوير', chamfer: 'شطف',
    importStep: 'استيراد STEP', importModeLabel: 'وضع الاستيراد',
    importModeReplace: 'استبدال', importModeMerge: 'دمج',
    modalTitle: 'خيارات البثق', depth: 'العمق (مم)', direction: 'الاتجاه', mode: 'الوضع', draft: 'زاوية المسودة(°)',
    oneSided: 'جانب واحد', twoSided: 'جانبان', midplane: 'مستوى متوسط',
    add: 'إضافة', cut: 'قص',
    submit: 'بثق', cancel: 'إلغاء',
    rendering: 'جارٍ التصيير...', scadHeading: 'مصدر SCAD', pngHeading: 'معاينة',
    errorPrefix: 'خطأ',
    errorDepthInvalid: 'يجب أن يكون العمق أكبر من 0',
    savedAt: 'تم الحفظ',
    saveError: 'فشل الحفظ',
    reset: 'إعادة تعيين',
  },
};

interface RenderResult {
  scad: string;
  pngs: { label: string; base64: string }[];
  /** Binary STL bytes as base64 (Phase 2.A.4 — Three.js viewer). */
  stl?: string;
}

type RenderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; result: RenderResult }
  | { status: 'error'; message: string };

interface ExtrudeFetcher {
  (req: {
    sketch: SolverViewState;
    depth: number;
    draftDegrees?: number;
    direction: ExtrudeDirection;
    mode: ExtrudeMode;
    includeStl?: boolean;
  }): Promise<
    | { ok: true; scad: string; pngs: { label: string; base64: string }[]; stl?: string }
    | { ok: false; code: string; message: string }
  >;
}

/**
 * Module-level WeakMap so the wrapper can attach an optional AbortSignal to
 * any fetcher call without changing the public ExtrudeFetcher signature
 * (tests inject mock fetchers that ignore the signal — fine, abort is then
 * best-effort and we just suppress the late setState via the same signal).
 */
const fetcherSignals = new WeakMap<ExtrudeFetcher, AbortSignal>();

const defaultFetcher: ExtrudeFetcher = async (req) => {
  const signal = fetcherSignals.get(defaultFetcher);
  const res = await fetch('/api/extrude-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  return res.json();
};

/**
 * Optional persistence (Phase 2.8). When a `projectId` is supplied, the
 * wrapper switches FeatureTree state from plain in-memory `useState` to
 * `useFeatureTreeStorage('nexyfab:tree:${projectId}')` — auto-load on
 * mount, debounced save (500 ms) on every edit, Reset button to clear.
 *
 * When `projectId` is omitted, the wrapper uses the original in-memory
 * `useState` path verbatim. No localStorage I/O happens — tests written
 * before persistence existed keep passing without changes.
 *
 * Implementation note: React rules-of-hooks forbid conditional hook calls,
 * so we always call BOTH hooks and pick the active branch by `useMemo`.
 * The unused branch holds its empty initial state and never advances, so
 * the cost is one extra `useState` allocation per render.
 */
const STORAGE_KEY_PREFIX = 'nexyfab:tree:';

export interface SolverSketchEditorWithExtrudeProps extends SolverSketchEditorProps {
  /**
   * Optional project identifier. When provided the FeatureTree is
   * persisted to `localStorage['nexyfab:tree:${projectId}']` with a 500 ms
   * debounced auto-save (see useFeatureTreeStorage). When absent the
   * wrapper stays on its original in-memory state (100 % back-compat).
   */
  projectId?: string;
  /** Injectable fetcher for tests. Defaults to POST /api/extrude-render. */
  extrudeFetcher?: ExtrudeFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/revolve-render. */
  revolveFetcher?: RevolveFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/sweep-render. */
  sweepFetcher?: SweepFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/loft-render. */
  loftFetcher?: LoftFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/pattern-render. */
  patternFetcher?: PatternFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/shell-render. */
  shellFetcher?: ShellFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/hole-render. */
  holeFetcher?: HoleFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/fillet-render. */
  filletFetcher?: FilletFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/chamfer-render. */
  chamferFetcher?: ChamferFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/step-import. */
  stepImportFetcher?: StepImportFetcher;
  /**
   * Optional axis hint forwarded to the Revolve modal — e.g., a selected
   * line in the sketch. The modal renders a "use this as axis" button.
   */
  revolveAxisHint?: AxisLine2D;
}

export default function SolverSketchEditorWithExtrude(
  props: SolverSketchEditorWithExtrudeProps,
): React.ReactElement {
  const {
    projectId,
    extrudeFetcher = defaultFetcher,
    revolveFetcher,
    sweepFetcher,
    loftFetcher,
    patternFetcher,
    shellFetcher,
    holeFetcher,
    filletFetcher,
    chamferFetcher,
    stepImportFetcher,
    revolveAxisHint,
    ...editorProps
  } = props;
  const t = dict[(editorProps.lang ?? 'en') as Lang];
  const treeLang = (editorProps.lang ?? 'en') as FeatureTreeLang;

  const [sketch, setSketch] = useState<SolverViewState>({ points: [], lines: [] });
  const [modalOpen, setModalOpen] = useState(false);
  const [revolveOpen, setRevolveOpen] = useState(false);
  const [sweepOpen, setSweepOpen] = useState(false);
  const [loftOpen, setLoftOpen] = useState(false);
  const [patternOpen, setPatternOpen] = useState(false);
  const [shellOpen, setShellOpen] = useState(false);
  const [holeOpen, setHoleOpen] = useState(false);
  const [filletOpen, setFilletOpen] = useState(false);
  const [chamferOpen, setChamferOpen] = useState(false);
  const [stepImportOpen, setStepImportOpen] = useState(false);
  /** Replace vs merge — set inside the STEP import wizard before submit. */
  const [stepImportMode, setStepImportMode] = useState<'replace' | 'merge'>('replace');
  const [depth, setDepth] = useState<string>('10');
  const [direction, setDirection] = useState<ExtrudeDirection>('one_sided');
  const [mode, setMode] = useState<ExtrudeMode>('add');
  const [draftDegrees, setDraftDegrees] = useState<string>('0');
  const [render, setRender] = useState<RenderState>({ status: 'idle' });

  // ── feature tree state (Phase 2.7 + 5.2 UI integration) ─────────────────
  // Persistence toast (Phase 2.8) — shown for ~3 s when the storage hook
  // surfaces a write error (quota_exceeded, no_storage, unknown).
  const [persistError, setPersistError] = useState<{ error: SaveError; message: string } | null>(
    null,
  );
  // Stable callback the storage hook calls on every save failure. We mirror
  // both the structured error code AND the human-readable message so the
  // toast can fall back to "Save failed" + the raw reason.
  const onPersistError = useCallback((error: SaveError, message: string) => {
    setPersistError({ error, message });
  }, []);

  // BOTH hooks run on every render to keep rules-of-hooks happy. The
  // storage hook is keyed under a stable per-instance sentinel when no
  // projectId is supplied; we never *read* its state in that case, so
  // those writes never happen (we don't call its setter). When projectId
  // IS supplied, we route both reads and writes through it.
  const storageKey = projectId !== undefined ? `${STORAGE_KEY_PREFIX}${projectId}` : '';
  const [storedFeatureTree, setStoredFeatureTree] = useFeatureTreeStorage(storageKey, {
    onError: onPersistError,
  });
  const [memoryFeatureTree, setMemoryFeatureTree] = useState<FeatureTree>({ nodes: [] });
  const featureTree = projectId !== undefined ? storedFeatureTree : memoryFeatureTree;
  const setFeatureTree: typeof setMemoryFeatureTree =
    projectId !== undefined
      ? (setStoredFeatureTree as typeof setMemoryFeatureTree)
      : setMemoryFeatureTree;

  const [selectedFeatureId, setSelectedFeatureId] = useState<string | undefined>(undefined);
  /** Monotonic id generator for tree nodes created by modal submits. Seeded
   *  from the loaded tree size so a freshly rehydrated tree appends new
   *  nodes after the persisted ones rather than colliding with them. */
  const nextNodeIdRef = useRef<number>(featureTree.nodes.length);

  // Synthetic-payload helper: each modal returns only SCAD+pngs, not a full
  // feature IR, so we synthesise a placeholder payload tagged by `kind`. The
  // SCAD render is owned by the modal preview pane; the tree node only
  // surfaces history + selection. Full IR threading lands in a later batch.
  const appendNode = useCallback((kind: FeatureKind, labelBase: string): void => {
    setFeatureTree((prev) => {
      const idx = nextNodeIdRef.current++;
      const id = `${kind}_${idx}`;
      // Cast the synthesised stub to FeaturePayload — runtime tests do not
      // walk the payload shape; the FeatureTreeView only inspects `kind`.
      const payload = { kind } as unknown as FeatureNode['payload'];
      const node: FeatureNode = {
        id,
        name: `${labelBase} ${idx + 1}`,
        dependencies: [],
        payload,
      };
      return { nodes: [...prev.nodes, node] };
    });
  }, []);

  // ── fetcher wrappers — intercept ok responses to append a tree node ────
  // Wrap each per-feature fetcher exactly once per identity change. We
  // intentionally re-create on appendNode identity (stable across renders).
  const wrappedExtrudeFetcher = useMemo(
    () => {
      const base = extrudeFetcher;
      return async (req: Parameters<ExtrudeFetcher>[0]) => {
        const res = await base(req);
        if (res && res.ok === true) appendNode('extrude', t.extrude);
        return res;
      };
    },
    [extrudeFetcher, appendNode, t.extrude],
  );
  const wrappedRevolveFetcher = useMemo<RevolveFetcher | undefined>(
    () => {
      if (!revolveFetcher) return undefined;
      return async (req) => {
        const res = await revolveFetcher(req);
        if (res && res.ok === true) appendNode('revolve', t.revolve);
        return res;
      };
    },
    [revolveFetcher, appendNode, t.revolve],
  );
  const wrappedSweepFetcher = useMemo<SweepFetcher | undefined>(
    () => {
      if (!sweepFetcher) return undefined;
      return async (req) => {
        const res = await sweepFetcher(req);
        if (res && res.ok === true) appendNode('sweep', t.sweep);
        return res;
      };
    },
    [sweepFetcher, appendNode, t.sweep],
  );
  const wrappedLoftFetcher = useMemo<LoftFetcher | undefined>(
    () => {
      if (!loftFetcher) return undefined;
      return async (req) => {
        const res = await loftFetcher(req);
        if (res && res.ok === true) appendNode('loft', t.loft);
        return res;
      };
    },
    [loftFetcher, appendNode, t.loft],
  );
  const wrappedPatternFetcher = useMemo<PatternFetcher | undefined>(
    () => {
      if (!patternFetcher) return undefined;
      return async (req) => {
        const res = await patternFetcher(req);
        if (res && res.ok === true) {
          const kind: FeatureKind =
            req.kind === 'circular' ? 'circular_pattern' : 'linear_pattern';
          appendNode(kind, t.pattern);
        }
        return res;
      };
    },
    [patternFetcher, appendNode, t.pattern],
  );
  const wrappedShellFetcher = useMemo<ShellFetcher | undefined>(
    () => {
      if (!shellFetcher) return undefined;
      return async (req) => {
        const res = await shellFetcher(req);
        // Shell yields an extruded thin-wall body; tag the synthesised
        // node as 'extrude' (the FeatureKind enum has no dedicated shell
        // kind yet — covered by the Phase 2.x rework).
        if (res && res.ok === true) appendNode('extrude', t.shell);
        return res;
      };
    },
    [shellFetcher, appendNode, t.shell],
  );
  const wrappedHoleFetcher = useMemo<HoleFetcher | undefined>(
    () => {
      if (!holeFetcher) return undefined;
      return async (req) => {
        const res = await holeFetcher(req);
        if (res && res.ok === true) appendNode('hole', t.hole);
        return res;
      };
    },
    [holeFetcher, appendNode, t.hole],
  );
  const wrappedFilletFetcher = useMemo<FilletFetcher | undefined>(
    () => {
      if (!filletFetcher) return undefined;
      return async (req) => {
        const res = await filletFetcher(req);
        if (res && res.ok === true) appendNode('fillet', t.fillet);
        return res;
      };
    },
    [filletFetcher, appendNode, t.fillet],
  );
  const wrappedChamferFetcher = useMemo<ChamferFetcher | undefined>(
    () => {
      if (!chamferFetcher) return undefined;
      return async (req) => {
        const res = await chamferFetcher(req);
        if (res && res.ok === true) appendNode('chamfer', t.chamfer);
        return res;
      };
    },
    [chamferFetcher, appendNode, t.chamfer],
  );

  // ── tree-row callbacks ──────────────────────────────────────────────────
  // Reset = clear the tree + the local id counter. When persisted, also
  // wipes the localStorage entry on the next debounce flush (the storage
  // hook serialises the empty tree and writes it under the same key).
  const handleResetTree = useCallback(() => {
    nextNodeIdRef.current = 0;
    setSelectedFeatureId(undefined);
    setPersistError(null);
    setFeatureTree({ nodes: [] });
  }, [setFeatureTree]);
  const handleSelectNode = useCallback((id: string) => {
    setSelectedFeatureId(id);
  }, []);
  const handleToggleSuppress = useCallback((id: string) => {
    setFeatureTree((prev) => {
      const idx = prev.nodes.findIndex((n) => n.id === id);
      if (idx < 0) return prev;
      const node = prev.nodes[idx]!;
      const next: FeatureNode = { ...node, suppressed: !(node.suppressed === true) };
      const nodes = prev.nodes.slice();
      nodes[idx] = next;
      return { nodes };
    });
  }, []);
  const handleDeleteNode = useCallback((id: string) => {
    setFeatureTree((prev) => {
      try {
        return applyEdit(prev, { type: 'remove_node', nodeId: id });
      } catch (e) {
        if (e instanceof FeatureTreeEditError) {
          // Dependents exist — refuse silently for now; UX surface comes
          // in the next batch.
          return prev;
        }
        throw e;
      }
    });
    setSelectedFeatureId((curr) => (curr === id ? undefined : curr));
  }, []);
  const handleReorderNodes = useCallback((fromIdx: number, toIdx: number) => {
    setFeatureTree((prev) => {
      const node = prev.nodes[fromIdx];
      if (!node) return prev;
      try {
        return applyEdit(prev, { type: 'move_node', nodeId: node.id, toIndex: toIdx });
      } catch (e) {
        if (e instanceof FeatureTreeEditError) return prev;
        throw e;
      }
    });
  }, []);

  // ── STEP import — replace / merge into tree ─────────────────────────────
  const handleStepImport = useCallback(
    (importedTree: FeatureTree, _warnings: string[], _unsupported: string[]) => {
      setFeatureTree((prev) => {
        if (stepImportMode === 'replace') {
          // Bump the id counter past any imported id so future modal
          // appends do not collide with id-prefixed imports.
          nextNodeIdRef.current = importedTree.nodes.length;
          return { nodes: importedTree.nodes.slice() };
        }
        // Merge mode — append, prefixing imported ids on collision.
        const existing = new Set(prev.nodes.map((n) => n.id));
        const prefix = `imp${Date.now().toString(36)}_`;
        const remap = new Map<string, string>();
        for (const node of importedTree.nodes) {
          remap.set(node.id, existing.has(node.id) ? `${prefix}${node.id}` : node.id);
        }
        const remapped: FeatureNode[] = importedTree.nodes.map((node) => ({
          ...node,
          id: remap.get(node.id) ?? node.id,
          dependencies: node.dependencies.map((d) => remap.get(d) ?? d),
        }));
        return { nodes: [...prev.nodes, ...remapped] };
      });
      setStepImportOpen(false);
    },
    [stepImportMode],
  );

  // Tracks the in-flight fetch's AbortController so cancel/unmount can abort
  // it AND so we can suppress late setState after the controller is aborted.
  const abortRef = useRef<AbortController | null>(null);

  // Keep a stable callback to avoid re-renders inside the wrapped editor.
  const handleSketchChange = useCallback((s: SolverViewState) => {
    setSketch(s);
  }, []);

  // Merge our handler with any user-supplied onSketchChange.
  const composedOnSketchChange = useMemo(() => {
    const userHandler = editorProps.onSketchChange;
    if (!userHandler) return handleSketchChange;
    return (s: SolverViewState) => {
      userHandler(s);
      handleSketchChange(s);
    };
  }, [editorProps.onSketchChange, handleSketchChange]);

  const canExtrude = sketch.points.length >= 3 && sketch.lines.length >= 3;
  const canRevolve = canExtrude;
  const canSweep = canExtrude;
  const canLoft = canExtrude;
  const canPattern = canExtrude;
  const canShell = canExtrude;
  const canHole = canExtrude;
  const canFillet = canExtrude;
  const canChamfer = canExtrude;

  const onSubmit = useCallback(async () => {
    const d = Number(depth);
    if (!Number.isFinite(d) || d <= 0) {
      setRender({ status: 'error', message: `${t.errorPrefix}: ${t.errorDepthInvalid}` });
      return;
    }
    const draftN = Number(draftDegrees);

    // Abort any previous in-flight request before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // Attach signal for defaultFetcher to pick up. Test-injected fetchers
    // ignore this entry (they aren't the defaultFetcher reference).
    fetcherSignals.set(extrudeFetcher, controller.signal);

    setRender({ status: 'loading' });
    try {
      const res = await wrappedExtrudeFetcher({
        sketch,
        depth: d,
        draftDegrees: Number.isFinite(draftN) && draftN !== 0 ? draftN : undefined,
        direction,
        mode,
        includeStl: true,
      });
      if (controller.signal.aborted) return;
      if (res.ok) {
        setRender({ status: 'ok', result: { scad: res.scad, pngs: res.pngs, stl: res.stl } });
      } else {
        setRender({ status: 'error', message: `${t.errorPrefix}: ${res.message}` });
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setRender({ status: 'error', message: `${t.errorPrefix}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      fetcherSignals.delete(extrudeFetcher);
    }
  }, [depth, draftDegrees, direction, mode, sketch, extrudeFetcher, wrappedExtrudeFetcher, t.errorPrefix, t.errorDepthInvalid]);

  // Reset preview when modal closes; also abort any in-flight fetch so a
  // late setState after the user clicked Cancel does NOT land on a closed
  // modal (React act() warning) or leak the response.
  useEffect(() => {
    if (!modalOpen) {
      abortRef.current?.abort();
      abortRef.current = null;
      setRender({ status: 'idle' });
    }
  }, [modalOpen]);

  // Abort on unmount to avoid setState-after-unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SolverSketchEditor {...editorProps} onSketchChange={composedOnSketchChange} />

      {/* Operation toolbar */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={!canExtrude}
          onClick={() => setModalOpen(true)}
          data-testid="solver-extrude-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canExtrude ? '#16a34a' : '#e5e7eb',
            color: canExtrude ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canExtrude ? '#15803d' : '#d1d5db'),
            borderRadius: 6,
            cursor: canExtrude ? 'pointer' : 'not-allowed',
          }}
        >
          ⬆ {t.extrude}
        </button>
        <button
          type="button"
          disabled={!canRevolve}
          onClick={() => setRevolveOpen(true)}
          data-testid="solver-revolve-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canRevolve ? '#0ea5e9' : '#e5e7eb',
            color: canRevolve ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canRevolve ? '#0284c7' : '#d1d5db'),
            borderRadius: 6,
            cursor: canRevolve ? 'pointer' : 'not-allowed',
          }}
        >
          ↻ {t.revolve}
        </button>
        <button
          type="button"
          disabled={!canSweep}
          onClick={() => setSweepOpen(true)}
          data-testid="solver-sweep-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canSweep ? '#8b5cf6' : '#e5e7eb',
            color: canSweep ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canSweep ? '#7c3aed' : '#d1d5db'),
            borderRadius: 6,
            cursor: canSweep ? 'pointer' : 'not-allowed',
          }}
        >
          ✏ {t.sweep}
        </button>
        <button
          type="button"
          disabled={!canLoft}
          onClick={() => setLoftOpen(true)}
          data-testid="solver-loft-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canLoft ? '#f59e0b' : '#e5e7eb',
            color: canLoft ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canLoft ? '#d97706' : '#d1d5db'),
            borderRadius: 6,
            cursor: canLoft ? 'pointer' : 'not-allowed',
          }}
        >
          🥯 {t.loft}
        </button>
        <button
          type="button"
          disabled={!canPattern}
          onClick={() => setPatternOpen(true)}
          data-testid="solver-pattern-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canPattern ? '#10b981' : '#e5e7eb',
            color: canPattern ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canPattern ? '#059669' : '#d1d5db'),
            borderRadius: 6,
            cursor: canPattern ? 'pointer' : 'not-allowed',
          }}
        >
          ▦ {t.pattern}
        </button>
        <button
          type="button"
          disabled={!canShell}
          onClick={() => setShellOpen(true)}
          data-testid="solver-shell-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canShell ? '#14b8a6' : '#e5e7eb',
            color: canShell ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canShell ? '#0d9488' : '#d1d5db'),
            borderRadius: 6,
            cursor: canShell ? 'pointer' : 'not-allowed',
          }}
        >
          ◌ {t.shell}
        </button>
        <button
          type="button"
          disabled={!canHole}
          onClick={() => setHoleOpen(true)}
          data-testid="solver-hole-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canHole ? '#6366f1' : '#e5e7eb',
            color: canHole ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canHole ? '#4f46e5' : '#d1d5db'),
            borderRadius: 6,
            cursor: canHole ? 'pointer' : 'not-allowed',
          }}
        >
          ⊙ {t.hole}
        </button>
        <button
          type="button"
          disabled={!canFillet}
          onClick={() => setFilletOpen(true)}
          data-testid="solver-fillet-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canFillet ? '#f43f5e' : '#e5e7eb',
            color: canFillet ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canFillet ? '#e11d48' : '#d1d5db'),
            borderRadius: 6,
            cursor: canFillet ? 'pointer' : 'not-allowed',
          }}
        >
          ◜ {t.fillet}
        </button>
        <button
          type="button"
          disabled={!canChamfer}
          onClick={() => setChamferOpen(true)}
          data-testid="solver-chamfer-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canChamfer ? '#64748b' : '#e5e7eb',
            color: canChamfer ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canChamfer ? '#475569' : '#d1d5db'),
            borderRadius: 6,
            cursor: canChamfer ? 'pointer' : 'not-allowed',
          }}
        >
          ◣ {t.chamfer}
        </button>
        {/* STEP import — always enabled (canExtrude gate intentionally bypassed). */}
        <button
          type="button"
          onClick={() => setStepImportOpen(true)}
          data-testid="solver-import-step-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: '#d97706',
            color: '#fff',
            border: '1px solid #b45309',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          ⤓ {t.importStep}
        </button>
      </div>

      {/* Feature tree panel (Phase 2.7) — mounted below the operation
          toolbar so users see new nodes accumulate as they submit modals.
          Phase 2.8 adds a Reset button + persistence status banner that
          surface ONLY when the wrapper is in persisted mode (projectId set). */}
      <div data-testid="solver-feature-tree-panel" style={{ marginTop: 4 }}>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: 4,
            fontSize: 12,
          }}
        >
          <button
            type="button"
            onClick={handleResetTree}
            data-testid="solver-feature-tree-reset"
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: '#fff',
              border: '1px solid #d1d5db',
              color: '#374151',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t.reset}
          </button>
          {projectId !== undefined && persistError === null && (
            <span
              data-testid="solver-feature-tree-saved"
              style={{ color: '#16a34a', fontSize: 11 }}
            >
              {t.savedAt}
            </span>
          )}
          {projectId !== undefined && persistError !== null && (
            <span
              data-testid="solver-feature-tree-save-error"
              role="alert"
              style={{
                color: '#dc2626',
                fontSize: 11,
                padding: '2px 6px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 4,
              }}
            >
              {t.saveError}: {persistError.error === 'quota_exceeded'
                ? 'quota exceeded'
                : persistError.message}
            </span>
          )}
        </div>
        <FeatureTreeView
          lang={treeLang}
          tree={featureTree}
          selectedId={selectedFeatureId}
          onSelect={handleSelectNode}
          onToggleSuppress={handleToggleSuppress}
          onDelete={handleDeleteNode}
          onReorder={handleReorderNodes}
        />
      </div>

      {/* Revolve modal (sibling of the Extrude modal) */}
      {revolveOpen && (
        <RevolveModal
          lang={(editorProps.lang ?? 'en') as RevolveLang}
          sketch={sketch}
          axisHint={revolveAxisHint}
          onClose={() => setRevolveOpen(false)}
          revolveFetcher={wrappedRevolveFetcher}
        />
      )}

      {/* Sweep modal (Phase 2.2) */}
      {sweepOpen && (
        <SweepModal
          lang={(editorProps.lang ?? 'en') as SweepLang}
          sketch={sketch}
          onClose={() => setSweepOpen(false)}
          sweepFetcher={wrappedSweepFetcher}
        />
      )}

      {/* Loft modal (Phase 2.2) */}
      {loftOpen && (
        <LoftModal
          lang={(editorProps.lang ?? 'en') as LoftLang}
          sketch={sketch}
          onClose={() => setLoftOpen(false)}
          loftFetcher={wrappedLoftFetcher}
        />
      )}

      {/* Pattern modal (Phase 2.4) */}
      {patternOpen && (
        <PatternModal
          lang={(editorProps.lang ?? 'en') as PatternLang}
          sketch={sketch}
          onClose={() => setPatternOpen(false)}
          patternFetcher={wrappedPatternFetcher}
        />
      )}

      {/* Shell modal (Phase 2.A round 2) */}
      {shellOpen && (
        <ShellModal
          lang={(editorProps.lang ?? 'en') as ShellLang}
          sketch={sketch}
          onClose={() => setShellOpen(false)}
          shellFetcher={wrappedShellFetcher}
        />
      )}

      {/* Hole wizard modal (Phase 2.A round 2) */}
      {holeOpen && (
        <HoleWizardModal
          lang={(editorProps.lang ?? 'en') as HoleWizardLang}
          sketch={sketch}
          onClose={() => setHoleOpen(false)}
          holeFetcher={wrappedHoleFetcher}
        />
      )}

      {/* Fillet modal (Phase 2.2) */}
      {filletOpen && (
        <FilletModal
          lang={(editorProps.lang ?? 'en') as FilletLang}
          sketch={sketch}
          onClose={() => setFilletOpen(false)}
          filletFetcher={wrappedFilletFetcher}
        />
      )}

      {/* Chamfer modal (Phase 2.2) */}
      {chamferOpen && (
        <ChamferModal
          lang={(editorProps.lang ?? 'en') as ChamferLang}
          sketch={sketch}
          onClose={() => setChamferOpen(false)}
          chamferFetcher={wrappedChamferFetcher}
        />
      )}

      {/* STEP import modal (Phase 5.2) — wrapper picks replace/merge mode
          via the radio row above and forwards the imported tree. */}
      {stepImportOpen && (
        <div data-testid="solver-step-import-host">
          <div
            data-testid="solver-step-import-mode-row"
            style={{
              position: 'fixed',
              top: 12,
              right: 12,
              zIndex: 1001,
              padding: '8px 12px',
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontSize: 12,
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
          >
            <span style={{ fontWeight: 600 }}>{t.importModeLabel}</span>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="radio"
                name="step-import-mode"
                value="replace"
                checked={stepImportMode === 'replace'}
                onChange={() => setStepImportMode('replace')}
                data-testid="solver-step-import-mode-replace"
              />
              {t.importModeReplace}
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="radio"
                name="step-import-mode"
                value="merge"
                checked={stepImportMode === 'merge'}
                onChange={() => setStepImportMode('merge')}
                data-testid="solver-step-import-mode-merge"
              />
              {t.importModeMerge}
            </label>
          </div>
          <StepImportModal
            lang={(editorProps.lang ?? 'en') as StepImportLang}
            onClose={() => setStepImportOpen(false)}
            onImport={handleStepImport}
            stepImportFetcher={stepImportFetcher}
          />
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div
          data-testid="solver-extrude-modal"
          role="dialog"
          aria-labelledby="solver-extrude-title"
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <div style={{
            background: '#fff',
            padding: 20,
            borderRadius: 8,
            maxWidth: 600,
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            <h3 id="solver-extrude-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t.modalTitle}</h3>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.depth}
              <input
                type="number"
                value={depth}
                onChange={(e) => setDepth(e.target.value)}
                data-testid="solver-extrude-depth-input"
                step="0.1"
                min="0.1"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.direction}
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as ExtrudeDirection)}
                data-testid="solver-extrude-direction-select"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              >
                <option value="one_sided">{t.oneSided}</option>
                <option value="two_sided">{t.twoSided}</option>
                <option value="midplane">{t.midplane}</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.mode}
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as ExtrudeMode)}
                data-testid="solver-extrude-mode-select"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              >
                <option value="add">{t.add}</option>
                <option value="cut">{t.cut}</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.draft}
              <input
                type="number"
                value={draftDegrees}
                onChange={(e) => setDraftDegrees(e.target.value)}
                data-testid="solver-extrude-draft-input"
                step="1"
                min="-30"
                max="30"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              />
            </label>

            {render.status === 'loading' && (
              <div style={{ padding: 12, textAlign: 'center', color: '#6b7280' }}>
                {t.rendering}
              </div>
            )}

            {render.status === 'error' && (
              <div
                data-testid="solver-extrude-error"
                style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, color: '#dc2626', fontSize: 12 }}
              >
                {render.message}
              </div>
            )}

            {render.status === 'ok' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t.scadHeading}</div>
                  <pre
                    data-testid="solver-extrude-scad-preview"
                    style={{
                      padding: 8,
                      background: '#f3f4f6',
                      border: '1px solid #e5e7eb',
                      borderRadius: 4,
                      fontSize: 11,
                      fontFamily: 'monospace',
                      maxHeight: 200,
                      overflow: 'auto',
                      margin: 0,
                    }}
                  >
                    {render.result.scad}
                  </pre>
                </div>
                {render.result.pngs.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t.pngHeading}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {render.result.pngs.map((png, idx) => (
                        <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          { }
                          <img
                            data-testid={`solver-extrude-png-preview-${idx}`}
                            src={`data:image/png;base64,${png.base64}`}
                            alt={png.label}
                            style={{ maxWidth: 240, border: '1px solid #d1d5db', borderRadius: 4 }}
                          />
                          <div style={{ fontSize: 10, color: '#6b7280' }}>{png.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {render.result.stl !== undefined && (
                  <div data-testid="solver-extrude-stl-viewer-host">
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>3D</div>
                    <StlViewer stlBase64={render.result.stl} width={400} height={300} />
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                data-testid="solver-extrude-cancel"
                style={{ padding: '8px 16px', fontSize: 13, background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={render.status === 'loading'}
                data-testid="solver-extrude-submit"
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  background: render.status === 'loading' ? '#e5e7eb' : '#16a34a',
                  color: render.status === 'loading' ? '#9ca3af' : '#fff',
                  border: '1px solid #15803d',
                  borderRadius: 4,
                  cursor: render.status === 'loading' ? 'not-allowed' : 'pointer',
                }}
              >
                {t.submit}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
