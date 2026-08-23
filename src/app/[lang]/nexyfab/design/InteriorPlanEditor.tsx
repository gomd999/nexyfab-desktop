'use client';

/**
 * InteriorPlanEditor — 인테리어(카페) 2D 탑뷰 배치 에디터 (Round 4 · B 인테리어 실전 UX).
 *
 * SVG 기반: 실(방) 사각형 + 벽/출입문/비상구/카운터(템플릿 기하 미러) + 가구 드래그 배치.
 * 모든 가구 변경은 onChange(list,label)로 패널에 올라가 같은 preset 빌드 파라미터
 * (customFurniture)와 디바운스→리빌드→재검증 파이프를 그대로 탄다 — 편집·검증 링크 유지.
 *
 * 오버레이 3종(체크박스): 피난 히트맵(travel.grid BFS 결과), 조도(조명 C×R 배치),
 * 스프링클러(헤드 배치+반경). 대응 결과가 INPUT이면 정직하게 입력 안내만 표시.
 *
 * 좌표계: 실내 원점(mm), x→오른쪽, y→아래(SVG와 동일 — 전면 벽/출입문이 위쪽).
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import { clampInteriorPlacementPositionMm, INTERIOR_PLACEMENT_CATALOG, roomCenteredToTopLeftMm, topLeftToRoomCenteredMm, type InteriorPlacementObject, type Vec3Mm } from '@/lib/cad/interiorPlacementDocument';

// ─── i18n dictionary (6-lang, identical key sets — AssemblyPresetPanel 패턴) ──
const dict = {
  ko: {
    title: '2D 배치 에디터',
    toCustom: '그리드 → 자유배치 전환',
    toGrid: '그리드 복귀',
    gridNote: '그리드 배치 모드 — 자유배치로 전환하면 드래그 편집이 열립니다.',
    addT2: '+2인 테이블',
    addT4: '+4인 테이블',
    addSofa: '+소파',
    delHint: '클릭=선택 · 드래그=이동(50mm 스냅) · Delete=삭제',
    ovHeat: '피난 히트맵',
    ovLux: '조도',
    ovSprk: '스프링클러',
    ovNeedInput: '입력 필요 — 해당 설비 파라미터 입력 후 재검증하세요.',
    ovNeedRun: '피난·마감 검증 실행 후 표시됩니다.',
    unre: '미도달',
    seats: '좌석',
    doors: '문폭합',
    farthest: '최원점',
    door: '출입문',
    exit2: '비상구',
    counter: '카운터',
  },
  en: {
    title: '2D layout editor',
    toCustom: 'Grid → free layout',
    toGrid: 'Back to grid',
    gridNote: 'Grid layout mode — switch to free layout to enable drag editing.',
    addT2: '+2-seat table',
    addT4: '+4-seat table',
    addSofa: '+Sofa',
    delHint: 'Click=select · drag=move (50mm snap) · Delete=remove',
    ovHeat: 'Egress heatmap',
    ovLux: 'Illuminance',
    ovSprk: 'Sprinkler',
    ovNeedInput: 'Input needed — enter the MEP parameter and re-verify.',
    ovNeedRun: 'Shown after running the egress & finish check.',
    unre: 'unreachable',
    seats: 'seats',
    doors: 'doors',
    farthest: 'farthest point',
    door: 'Door',
    exit2: 'Exit',
    counter: 'Counter',
  },
  ja: {
    title: '2D配置エディタ',
    toCustom: 'グリッド → 自由配置',
    toGrid: 'グリッドに戻す',
    gridNote: 'グリッド配置モード — 自由配置に切り替えるとドラッグ編集が可能になります。',
    addT2: '+2人テーブル',
    addT4: '+4人テーブル',
    addSofa: '+ソファ',
    delHint: 'クリック=選択 · ドラッグ=移動（50mmスナップ）· Delete=削除',
    ovHeat: '避難ヒートマップ',
    ovLux: '照度',
    ovSprk: 'スプリンクラー',
    ovNeedInput: '入力が必要 — 設備パラメータを入力して再検証してください。',
    ovNeedRun: '避難·仕上げ検証の実行後に表示されます。',
    unre: '未到達',
    seats: '座席',
    doors: '扉幅合計',
    farthest: '最遠点',
    door: '出入口',
    exit2: '非常口',
    counter: 'カウンター',
  },
  zh: {
    title: '2D布置编辑器',
    toCustom: '网格 → 自由布置',
    toGrid: '返回网格',
    gridNote: '网格布置模式 — 切换到自由布置后可拖拽编辑。',
    addT2: '+2人桌',
    addT4: '+4人桌',
    addSofa: '+沙发',
    delHint: '点击=选择 · 拖拽=移动（50mm吸附）· Delete=删除',
    ovHeat: '疏散热力图',
    ovLux: '照度',
    ovSprk: '喷淋',
    ovNeedInput: '需要输入 — 请输入相应设备参数后重新验证。',
    ovNeedRun: '运行疏散·装修验证后显示。',
    unre: '不可达',
    seats: '座位',
    doors: '门宽合计',
    farthest: '最远点',
    door: '出入口',
    exit2: '安全出口',
    counter: '吧台',
  },
  es: {
    title: 'Editor de planta 2D',
    toCustom: 'Cuadrícula → libre',
    toGrid: 'Volver a cuadrícula',
    gridNote: 'Modo cuadrícula — cambie a disposición libre para editar arrastrando.',
    addT2: '+Mesa 2p',
    addT4: '+Mesa 4p',
    addSofa: '+Sofá',
    delHint: 'Clic=seleccionar · arrastrar=mover (ajuste 50mm) · Supr=eliminar',
    ovHeat: 'Mapa de evacuación',
    ovLux: 'Iluminancia',
    ovSprk: 'Rociadores',
    ovNeedInput: 'Faltan datos — introduzca el parámetro y reverifique.',
    ovNeedRun: 'Se muestra tras ejecutar la verificación de evacuación.',
    unre: 'inaccesible',
    seats: 'asientos',
    doors: 'puertas',
    farthest: 'punto más lejano',
    door: 'Puerta',
    exit2: 'Salida',
    counter: 'Mostrador',
  },
  ar: {
    title: 'محرر التخطيط ثنائي الأبعاد',
    toCustom: 'شبكة → توزيع حر',
    toGrid: 'العودة إلى الشبكة',
    gridNote: 'وضع الشبكة — بدّل إلى التوزيع الحر لتمكين السحب.',
    addT2: '+طاولة لشخصين',
    addT4: '+طاولة لأربعة',
    addSofa: '+أريكة',
    delHint: 'نقر=اختيار · سحب=نقل (محاذاة 50مم) · Delete=حذف',
    ovHeat: 'خريطة الإخلاء الحرارية',
    ovLux: 'الإضاءة',
    ovSprk: 'المرشّات',
    ovNeedInput: 'مطلوب إدخال — أدخل معامل التجهيزات ثم أعد التحقق.',
    ovNeedRun: 'تظهر بعد تشغيل فحص الإخلاء والتشطيبات.',
    unre: 'غير قابل للوصول',
    seats: 'مقاعد',
    doors: 'مجموع عرض الأبواب',
    farthest: 'أبعد نقطة',
    door: 'مدخل',
    exit2: 'مخرج',
    counter: 'كاونتر',
  },
} as const;

export interface Furn { id?: string; kind: 'table2' | 'table4' | 'sofa'; x: number; y: number }

export interface InteriorPlanPlacementController {
  objects: readonly InteriorPlacementObject[];
  selectedObjectId: string | null;
  onSelectObject: (objectId: string | null) => void;
  onPreviewMove: (objectId: string, positionMm: Vec3Mm) => void;
  onCommitMove: (objectId: string, positionMm: Vec3Mm) => void | Promise<void>;
  onAddObject: (kind: Furn['kind'], positionMm?: Vec3Mm) => void | Promise<void>;
  onDeleteObject: (objectId: string) => void | Promise<void>;
}

export interface InteriorOverlayData {
  travel?: {
    pass?: boolean; maxTravelM?: number; unreachableM2?: number;
    farthestPointMm?: number[];
    grid?: { nx: number; ny: number; cellMm: number; dist_dm: number[]; blocked: number[] };
  } | null;
  egress?: { verdict?: string; derived?: { doorWidthSumMm?: number; seatCount?: number } } | null;
  lighting?: { verdict?: string; fixtures?: number; layout?: string } | null;
  fire?: { verdict?: string; note?: string; sprinkler?: { heads?: number; layout?: string; spacingX?: number; spacingY?: number; radiusM?: number } | null } | null;
}

// 가구 카탈로그 — scripts/drawing-to-3d/domain-assemblies.mjs cafe_room CATALOG 미러 (동기화 유지)
const CATALOG: Record<Furn['kind'], { w: number; d: number; seats: number }> = {
  table2: { w: INTERIOR_PLACEMENT_CATALOG.table2.dimensionsMm[0], d: INTERIOR_PLACEMENT_CATALOG.table2.dimensionsMm[1], seats: INTERIOR_PLACEMENT_CATALOG.table2.seats },
  table4: { w: INTERIOR_PLACEMENT_CATALOG.table4.dimensionsMm[0], d: INTERIOR_PLACEMENT_CATALOG.table4.dimensionsMm[1], seats: INTERIOR_PLACEMENT_CATALOG.table4.seats },
  sofa: { w: INTERIOR_PLACEMENT_CATALOG.sofa.dimensionsMm[0], d: INTERIOR_PLACEMENT_CATALOG.sofa.dimensionsMm[1], seats: INTERIOR_PLACEMENT_CATALOG.sofa.seats },
};
const FURN_FILL: Record<Furn['kind'], string> = { table2: '#ccfbf1', table4: '#99f6e4', sofa: '#fbcfe8' };
const SNAP = 50; // mm
const MARGIN = 500; // SVG 여백(mm)

const snapMm = (v: number) => Math.round(v / SNAP) * SNAP;
/** 'C×R' 배치 문자열 파싱 (조명·스프링클러 공용) */
const parseLayout = (s?: string): [number, number] | null => {
  const m = /^(\d+)\s*[×xX]\s*(\d+)$/.exec(s ?? '');
  return m ? [Math.max(1, +m[1]), Math.max(1, +m[2])] : null;
};

export default function InteriorPlanEditor({
  lang, width, depth, height = 3000, doorWidth, exitCount, rows, cols,
  furniture, onChange, result, unit = 'mm', placement,
}: {
  lang: string;
  width: number; depth: number; height?: number; doorWidth: number; exitCount: number;
  rows: number; cols: number;
  furniture: Furn[] | null; // null = 템플릿 그리드 모드
  onChange: (list: Furn[] | null, label: string) => void;
  result: InteriorOverlayData | null;
  placement?: InteriorPlanPlacementController;
  unit?: 'mm' | 'm'; // 치수 라벨 표시 단위 (좌표·스냅은 mm 고정)
}) {
  const t = dict[toIsoLang(lang)] ?? dict.ko;
  const W = Math.max(1000, width), D = Math.max(1000, depth), H = Math.max(1, height);
  const fmtDim = (v: number) => (unit === 'm' ? `${(v / 1000).toFixed(3)} m` : `${v} mm`);

  // 로컬 편집 상태 — 드래그 중엔 로컬만 갱신, 놓을 때 onChange로 커밋(리빌드 1회)
  const [items, setItems] = useState<Furn[] | null>(furniture);
  const [previewItems, setPreviewItems] = useState<Furn[] | null>(null);
  useEffect(() => { setItems(furniture); }, [furniture]);
  const [sel, setSel] = useState<number | null>(null);
  const [ovHeat, setOvHeat] = useState(true);
  const [ovLux, setOvLux] = useState(false);
  const [ovSprk, setOvSprk] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ idx: number; objectId?: string; dx: number; dy: number; moved: boolean } | null>(null);
  const placementMode = Boolean(placement);

  // cafe_room 그리드 테이블 좌표 미러 — domain-assemblies.mjs와 동일식 (1200각 = table4, 동기화 유지)
  const seedFromGrid = (): Furn[] => {
    const zoneW = W - 1600, zoneD = D - 2400;
    const list: Furn[] = [];
    for (let r = 0; r < Math.max(1, rows); r++) {
      for (let c = 0; c < Math.max(1, cols); c++) {
        list.push({
          kind: 'table4',
          x: Math.round(800 + (zoneW / Math.max(1, cols)) * (c + 0.5) - 600),
          y: Math.round(800 + (zoneD / Math.max(1, rows)) * (r + 0.5) - 600),
        });
      }
    }
    return list;
  };
  const gridPreview = useMemo(() => seedFromGrid(), [W, D, rows, cols]); // eslint-disable-line react-hooks/exhaustive-deps

  const clampFurn = useCallback((f: Furn): Furn => {
    const c = CATALOG[f.kind];
    return { ...f, x: Math.max(0, Math.min(W - c.w, snapMm(f.x))), y: Math.max(0, Math.min(D - c.d, snapMm(f.y))) };
  }, [W, D]);

  const placementItems = useMemo<Furn[]>(() => (placement?.objects ?? []).map(object => {
    const kind = (object.catalogType in INTERIOR_PLACEMENT_CATALOG ? object.catalogType : 'table4') as Furn['kind'];
    const [x, y] = roomCenteredToTopLeftMm(object.pose.positionMm, [W, D, H], object.dimensionsMm, object.pose.rotationDeg, object.clearanceMm);
    return { id: object.id, kind, x, y };
  }), [D, H, W, placement?.objects]);
  const shownItems = placementMode ? (previewItems ?? placementItems) : items;
  useEffect(() => { if (placementMode) setPreviewItems(null); }, [placement?.objects, placementMode]);

  const toMm = (ev: React.PointerEvent): { x: number; y: number } | null => {
    const el = svgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const viewWidth = W + 2 * MARGIN;
    const viewHeight = D + 2 * MARGIN;
    // SVG defaults to xMidYMid meet. Account for its letterbox offsets so a
    // pointer maps to the same physical point at every responsive aspect ratio.
    const pixelsPerMm = Math.min(r.width / viewWidth, r.height / viewHeight);
    const offsetX = (r.width - viewWidth * pixelsPerMm) / 2;
    const offsetY = (r.height - viewHeight * pixelsPerMm) / 2;
    return {
      x: (ev.clientX - r.left - offsetX) / pixelsPerMm - MARGIN,
      y: (ev.clientY - r.top - offsetY) / pixelsPerMm - MARGIN,
    };
  };

  const onFurnDown = (idx: number) => (ev: React.PointerEvent) => {
    if (!shownItems) return;
    ev.stopPropagation();
    const selected = shownItems[idx];
    if (placementMode) placement?.onSelectObject(selected?.id ?? null);
    else setSel(idx);
    const p = toMm(ev);
    if (!p || !selected) return;
    dragRef.current = { idx, objectId: selected.id, dx: p.x - selected.x, dy: p.y - selected.y, moved: false };
    svgRef.current?.setPointerCapture(ev.pointerId);
  };
  const onSvgMove = (ev: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !shownItems) return;
    const p = toMm(ev);
    if (!p) return;
    d.moved = true;
    const object = d.objectId ? placement?.objects.find(candidate => candidate.id === d.objectId) : undefined;
    const next = shownItems.map((f, i) => {
      if (i !== d.idx) return f;
      const desired = { ...f, x: snapMm(p.x - d.dx), y: snapMm(p.y - d.dy) };
      if (!placementMode || !object) return clampFurn(desired);
      const centered = topLeftToRoomCenteredMm([desired.x, desired.y], [W, D, H], object.dimensionsMm, object.pose.rotationDeg, object.clearanceMm);
      const clamped = clampInteriorPlacementPositionMm(centered, [W, D, H], object.dimensionsMm, object.pose.rotationDeg, object.clearanceMm);
      const [x, y] = roomCenteredToTopLeftMm(clamped, [W, D, H], object.dimensionsMm, object.pose.rotationDeg, object.clearanceMm);
      return { ...desired, x, y };
    });
    if (placementMode && d.objectId) {
      setPreviewItems(next);
      if (object) placement?.onPreviewMove(d.objectId, topLeftToRoomCenteredMm([next[d.idx]!.x, next[d.idx]!.y], [W, D, H], object.dimensionsMm, object.pose.rotationDeg, object.clearanceMm));
    } else setItems(next);
  };
  const onSvgUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && d.moved && shownItems) {
      const f = shownItems[d.idx];
      if (placementMode && d.objectId) {
        const object = placement?.objects.find(candidate => candidate.id === d.objectId);
        if (object) void placement?.onCommitMove(d.objectId, topLeftToRoomCenteredMm([f.x, f.y], [W, D, H], object.dimensionsMm, object.pose.rotationDeg, object.clearanceMm));
        setPreviewItems(null);
      } else onChange(shownItems, `${f.kind} → ${f.x},${f.y}`);
    }
  };
  const addFurn = (kind: Furn['kind']) => {
    if (placementMode) { if ((placement?.objects.length ?? 40) >= 40) return; void placement?.onAddObject(kind); return; }
    if (!items) return;
    const c = CATALOG[kind];
    const next = [...items, clampFurn({ kind, x: (W - c.w) / 2, y: (D - c.d) / 2 })];
    setItems(next);
    setSel(next.length - 1);
    onChange(next, `+${kind}`);
  };
  const onKey = (ev: React.KeyboardEvent) => {
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && placementMode && placement?.selectedObjectId) {
      ev.preventDefault(); void placement.onDeleteObject(placement.selectedObjectId); return;
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && items && sel !== null && items[sel]) {
      ev.preventDefault();
      const kind = items[sel].kind;
      const next = items.filter((_, i) => i !== sel);
      setItems(next);
      setSel(null);
      onChange(next, `−${kind}`);
    }
    if (placementMode && placement?.selectedObjectId && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) {
      const object = placement.objects.find(item => item.id === placement.selectedObjectId);
      if (!object) return;
      ev.preventDefault();
      const delta: Vec3Mm = [ev.key === 'ArrowRight' ? 50 : ev.key === 'ArrowLeft' ? -50 : 0, ev.key === 'ArrowDown' ? 50 : ev.key === 'ArrowUp' ? -50 : 0, 0];
      placement.onCommitMove(object.id, [object.pose.positionMm[0] + delta[0], object.pose.positionMm[1] + delta[1], object.pose.positionMm[2]]);
    }
  };

  const onSvgDrop = (ev: React.DragEvent<SVGSVGElement>) => {
    if (!placementMode || !placement) return;
    const kind = (ev.dataTransfer.getData('application/x-nexyfab-spatial-object') || ev.dataTransfer.getData('application/x-nexyfab-furniture')) as Furn['kind'];
    if (!(kind in INTERIOR_PLACEMENT_CATALOG)) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (placement.objects.length >= 40) return;
    const point = toMm(ev as unknown as React.PointerEvent);
    if (!point) return;
    const dimensions = INTERIOR_PLACEMENT_CATALOG[kind].dimensionsMm;
    const positionMm = clampInteriorPlacementPositionMm(
      [snapMm(point.x - W / 2), snapMm(point.y - D / 2), 0],
      [W, D, H],
      dimensions,
    );
    void placement.onAddObject(kind, positionMm);
  };

  // ── 오버레이 데이터 ─────────────────────────────────────────────────────────
  const grid = result?.travel?.grid;
  // 피난 히트맵 — dist_dm를 오프스크린 캔버스(셀=1px)로 그려 dataURL 임베드(4천여 rect 회피)
  const heatUrl = useMemo(() => {
    if (!grid || typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = grid.nx; c.height = grid.ny;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    let maxD = 1;
    for (const v of grid.dist_dm) if (v > maxD) maxD = v;
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        const idx = j * grid.nx + i;
        if (grid.blocked[idx]) ctx.fillStyle = 'rgba(31,41,55,0.8)';
        else if (grid.dist_dm[idx] < 0) ctx.fillStyle = 'rgba(124,58,237,0.75)'; // 미도달=보라
        else ctx.fillStyle = `hsla(${Math.round(120 * (1 - grid.dist_dm[idx] / maxD))},85%,45%,0.5)`; // 근접=초록→원거리=빨강
        ctx.fillRect(i, j, 1, 1);
      }
    }
    return c.toDataURL();
  }, [grid]);

  const luxLayout = result?.lighting?.verdict === 'INFO' ? parseLayout(result.lighting.layout) : null;
  const spk = result?.fire?.sprinkler ?? null;
  const spkLayout = spk ? parseLayout(spk.layout) : null;

  // 벽/개구 기하 미러 — domain-assemblies.mjs cafe_room (doorX=W/2−doorW/2 전면, 비상구 x=W−1300 w=900 후면)
  const wallT = 150;
  const doorX = W / 2 - doorWidth / 2;
  const hasExit2 = Math.round(exitCount) === 2;
  // 카운터 미러 — cw=min(3100, W×0.4), cx=W−cw−400, cy=D−1100, 깊이 800
  const cw = Math.min(3100, W * 0.4), cx = W - cw - 400, cy = D - 1100;

  const fs = Math.max(160, W * 0.028); // SVG 텍스트 크기(mm 공간)
  const eg = result?.egress;
  const tr = result?.travel;
  const farthest = tr && tr.pass === false && Array.isArray(tr.farthestPointMm) && tr.farthestPointMm.length === 2 ? tr.farthestPointMm : null;
  const custom = placementMode || items !== null;
  const shown = placementMode ? (shownItems ?? []) : custom ? (items ?? []) : gridPreview;

  const ovRow = (id: string, checked: boolean, set: (v: boolean) => void, label: string, ready: boolean, needInput: boolean) => (
    <label htmlFor={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, marginRight: 8, color: ready ? 'inherit' : 'var(--nx-text-3, #6b7684)' }}>
      <input id={id} name={id} type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} />
      {label}
      {checked && !ready && <span style={{ fontSize: 9.5, color: '#b45309' }}> — {needInput ? t.ovNeedInput : t.ovNeedRun}</span>}
    </label>
  );

  return (
    <div style={{ marginBottom: 8 }} tabIndex={0} onKeyDown={onKey}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 4 }}>
        <b style={{ fontSize: 11 }}>{t.title}</b>
        {!custom && (
          <button type="button" onClick={() => onChange(seedFromGrid(), 'grid→custom')} style={btn}>{t.toCustom}</button>
        )}
        {custom && (
          <>
            <button type="button" onClick={() => addFurn('table2')} style={btn}>{t.addT2}</button>
            <button type="button" onClick={() => addFurn('table4')} style={btn}>{t.addT4}</button>
            <button type="button" onClick={() => addFurn('sofa')} style={btn}>{t.addSofa}</button>
            {!placementMode && <button type="button" onClick={() => { setSel(null); onChange(null, 'custom→grid'); }} style={btn}>{t.toGrid}</button>}
          </>
        )}
      </div>
      <div style={{ fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)', marginBottom: 3 }}>
        {custom ? t.delHint : t.gridNote}
      </div>
      {/* 라이브 칩 — 좌석·문폭(egress 파생)·판정 + 미도달 경고 */}
      {(eg || tr) && (
        <div style={{ fontSize: 10, marginBottom: 3, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {eg?.derived && (
            <span style={{ padding: '1px 7px', borderRadius: 10, background: 'var(--nx-accent-soft, #eef4ff)', border: '1px solid var(--nx-border, #dfe3e8)' }}>
              {t.seats} {eg.derived.seatCount ?? '—'} · {t.doors} {eg.derived.doorWidthSumMm ?? '—'}mm
              {eg.verdict && <b style={{ marginLeft: 4, color: eg.verdict === 'PASS' ? '#16a34a' : eg.verdict === 'FAIL' ? '#dc2626' : '#d97706' }}>{eg.verdict}</b>}
            </span>
          )}
          {typeof tr?.unreachableM2 === 'number' && tr.unreachableM2 > 0 && (
            <span style={{ color: '#7c3aed', fontWeight: 700 }}>⚠ {t.unre} {tr.unreachableM2}m²</span>
          )}
        </div>
      )}
      {/* 오버레이 토글 — 대응 결과 없으면 정직 안내 */}
      <div style={{ marginBottom: 4 }}>
        {ovRow('interior-overlay-egress-heatmap', ovHeat, setOvHeat, t.ovHeat, !!heatUrl, false)}
        {ovRow('interior-overlay-lighting', ovLux, setOvLux, t.ovLux, !!luxLayout, result?.lighting?.verdict === 'INPUT')}
        {ovRow('interior-overlay-sprinkler', ovSprk, setOvSprk, t.ovSprk, !!(spk && spkLayout), result?.fire?.verdict === 'INPUT' || !result?.fire)}
      </div>

      <svg
        ref={svgRef}
        viewBox={`${-MARGIN} ${-MARGIN} ${W + 2 * MARGIN} ${D + 2 * MARGIN}`}
        style={{ width: '100%', display: 'block', borderRadius: 8, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', touchAction: 'none' }}
        onPointerMove={onSvgMove}
        onPointerUp={onSvgUp}
        onPointerDown={() => { setSel(null); if (placementMode) placement?.onSelectObject(null); }}
        onDragOver={placementMode ? (event => event.preventDefault()) : undefined}
        onDrop={placementMode ? onSvgDrop : undefined}
      >
        <defs>
          <radialGradient id="ipeLux">
            <stop offset="0%" stopColor="#fde047" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#fde047" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 바닥 */}
        <rect x={0} y={0} width={W} height={D} fill="#f8fafc" stroke="none" />

        {/* ① 피난 히트맵 (BFS 격자 — 셀 크기 grid.cellMm) */}
        {ovHeat && heatUrl && grid && (
          <image
            href={heatUrl} x={0} y={0}
            width={grid.nx * grid.cellMm} height={grid.ny * grid.cellMm}
            preserveAspectRatio="none" style={{ imageRendering: 'pixelated' }}
          />
        )}

        {/* 카운터(정적 — 템플릿 기하 미러) */}
        <rect x={cx} y={cy} width={cw} height={800} fill="#ede9fe" stroke="#7c3aed" strokeWidth={20} />
        <text x={cx + cw / 2} y={cy + 400} fontSize={fs * 0.8} fill="#7c3aed" textAnchor="middle" dominantBaseline="middle">{t.counter}</text>

        {/* 가구 — custom 모드=드래그 가능, grid 모드=프리뷰(비활성) */}
        {shown.map((f, i) => {
          const c = CATALOG[f.kind];
          const seld = placementMode ? placement?.selectedObjectId === f.id : custom && sel === i;
          return (
            <g key={f.id ?? `${f.kind}-${i}`} role={custom ? 'button' : undefined} tabIndex={custom ? 0 : undefined} aria-selected={custom ? seld : undefined} aria-label={custom ? `${f.kind} ${f.id ?? i + 1}` : undefined} data-object-id={f.id} style={{ cursor: custom ? 'move' : 'default' }} pointerEvents={custom ? 'auto' : 'none'} onPointerDown={custom ? onFurnDown(i) : undefined}>
              <rect
                x={f.x} y={f.y} width={c.w} height={c.d}
                fill={FURN_FILL[f.kind]} opacity={custom ? 0.95 : 0.55}
                stroke={seld ? '#2563eb' : '#0f766e'} strokeWidth={seld ? 40 : 15}
              />
              <text x={f.x + c.w / 2} y={f.y + c.d / 2} fontSize={fs * 0.72} fill="#134e4a" textAnchor="middle" dominantBaseline="middle" pointerEvents="none">
                {c.seats}
              </text>
            </g>
          );
        })}

        {/* ② 조도 오버레이 — lighting.layout C×R 균등 배치(계산기와 동일 규약) */}
        {ovLux && luxLayout && (() => {
          const [lc, lr] = luxLayout;
          const rad = Math.min(W / lc, D / lr) * 0.62;
          const out: React.ReactNode[] = [];
          for (let j = 0; j < lr; j++) for (let i = 0; i < lc; i++) {
            const x = ((i + 0.5) * W) / lc, y = ((j + 0.5) * D) / lr;
            out.push(<circle key={`lg${i}_${j}`} cx={x} cy={y} r={rad} fill="url(#ipeLux)" pointerEvents="none" />);
            out.push(<circle key={`lo${i}_${j}`} cx={x} cy={y} r={fs * 0.45} fill="none" stroke="#ca8a04" strokeWidth={18} pointerEvents="none" />);
          }
          return <g>{out}</g>;
        })()}

        {/* ③ 스프링클러 오버레이 — heads 배치 + 수평거리 r 커버리지 (미커버 모서리 시각화) */}
        {ovSprk && spk && spkLayout && (() => {
          const [sc, sr] = spkLayout;
          const sx = (spk.spacingX ?? 0) * 1000 || W / sc;
          const sy = (spk.spacingY ?? 0) * 1000 || D / sr;
          const rr = (spk.radiusM ?? 0) * 1000;
          const out: React.ReactNode[] = [];
          for (let j = 0; j < sr; j++) for (let i = 0; i < sc; i++) {
            const x = (i + 0.5) * sx, y = (j + 0.5) * sy;
            if (rr > 0) out.push(<circle key={`sc${i}_${j}`} cx={x} cy={y} r={rr} fill="rgba(37,99,235,0.10)" stroke="rgba(37,99,235,0.55)" strokeWidth={15} pointerEvents="none" />);
            out.push(<circle key={`sh${i}_${j}`} cx={x} cy={y} r={fs * 0.28} fill="#2563eb" pointerEvents="none" />);
          }
          return <g>{out}</g>;
        })()}

        {/* 벽 4면 + 출입문/비상구 마커 (템플릿 기하 미러 — 전면 y=0 위쪽) */}
        <rect x={0} y={-wallT} width={W} height={wallT} fill="#78716c" />
        <rect x={0} y={D} width={W} height={wallT} fill="#78716c" />
        <rect x={-wallT} y={0} width={wallT} height={D} fill="#78716c" />
        <rect x={W} y={0} width={wallT} height={D} fill="#78716c" />
        <rect x={doorX} y={-wallT} width={doorWidth} height={wallT} fill="#dcfce7" stroke="#16a34a" strokeWidth={20} />
        <text x={doorX + doorWidth / 2} y={-wallT - fs * 0.4} fontSize={fs * 0.75} fill="#16a34a" textAnchor="middle">{t.door}</text>
        {hasExit2 && (
          <>
            <rect x={W - 1300} y={D} width={900} height={wallT} fill="#dcfce7" stroke="#16a34a" strokeWidth={20} />
            <text x={W - 850} y={D + wallT + fs} fontSize={fs * 0.75} fill="#16a34a" textAnchor="middle">{t.exit2}</text>
          </>
        )}

        {/* FAIL 시 최원점 마커 */}
        {farthest && (
          <g pointerEvents="none">
            <circle cx={farthest[0]} cy={farthest[1]} r={fs * 1.1} fill="none" stroke="#dc2626" strokeWidth={35} />
            <circle cx={farthest[0]} cy={farthest[1]} r={fs * 0.28} fill="#dc2626" />
            <text x={farthest[0]} y={farthest[1] - fs * 1.4} fontSize={fs * 0.8} fill="#dc2626" fontWeight={700} textAnchor="middle">
              {t.farthest} {tr?.maxTravelM}m
            </text>
          </g>
        )}

        {/* 치수 라벨 */}
        <text x={W / 2} y={D + wallT + fs * (hasExit2 ? 2.2 : 1.1)} fontSize={fs * 0.85} fill="var(--nx-text-3, #6b7684)" textAnchor="middle">{fmtDim(W)}</text>
        <text x={-wallT - fs * 0.5} y={D / 2} fontSize={fs * 0.85} fill="var(--nx-text-3, #6b7684)" textAnchor="middle" transform={`rotate(-90 ${-wallT - fs * 0.5} ${D / 2})`}>{fmtDim(D)}</text>
      </svg>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '2px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
  border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'var(--nx-text, #1a2230)',
};
