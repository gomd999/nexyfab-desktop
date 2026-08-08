'use client';

import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import * as THREE from 'three';
import type { ShapeResult } from '../shapes';
import { formatWithUnit, type UnitSystem } from '../units';
import { extractCircles } from './svgCircleExtract';
import { exportDrawingPDF } from '../io/pdfExport';
import type { SurfaceRoughnessGrade, ISO2768Class } from '../annotations/GDTTypes';
import { ROUGHNESS_RA } from '../annotations/GDTTypes';

// ─── i18n dict ──────────────────────────────────────────────────────────────
// Keep technical abbreviations (ISO 2768, Ra, mm, µm) and coord/unit symbols in English.
const dict = {
  ko: {
    downloadSvg: 'SVG 다운로드',
    exportPdf: 'PDF 내보내기',
    exporting: '내보내는 중...',
    generalRoughness: '일반조도',
    tolerance: '공차',
    projection: '투영법',
    tolF: 'f (정밀)', tolM: 'm (중간)', tolC: 'c (거칠게)', tolV: 'v (매우 거칠게)',
    firstAngle: '1각법',
    thirdAngle: '3각법',
    noGeometry: '표시할 형상이 없습니다. 먼저 형상을 생성하세요.',
    untitledPart: '제목 없는 부품',
    partName: '부품명', partNo: '도번', material: '재료', company: '회사',
    scaleLbl: '척도', date: '날짜', drawnBy: '작성자',
    tolLabel: '일반공차', roughLabel: '일반조도',
    frontKo: '정면도', topKo: '평면도', rightKo: '우측면도',
    hlrToggle: '실투영(HLR)', hlrOn: '실투영 모드 — 은선 포함 · 치수 주석은 표준 모드에서', hlrFail: 'HLR 투영 실패',
  },
  en: {
    downloadSvg: 'Download SVG',
    exportPdf: 'Export PDF',
    exporting: 'Exporting...',
    generalRoughness: 'Roughness',
    tolerance: 'Tolerance',
    projection: 'Projection',
    tolF: 'f (fine)', tolM: 'm (medium)', tolC: 'c (coarse)', tolV: 'v (very coarse)',
    firstAngle: '1st angle',
    thirdAngle: '3rd angle',
    noGeometry: 'No geometry to display. Generate a shape first.',
    untitledPart: 'Untitled Part',
    partName: 'Part Name', partNo: 'Part No.', material: 'Material', company: 'Company',
    scaleLbl: 'Scale', date: 'Date', drawnBy: 'Drawn By',
    tolLabel: 'Gen. Tolerance', roughLabel: 'Gen. Roughness',
    frontKo: 'FRONT', topKo: 'TOP', rightKo: 'RIGHT',
    hlrToggle: 'True projection (HLR)', hlrOn: 'HLR mode — hidden lines shown · dimensions in standard mode', hlrFail: 'HLR projection failed',
  },
  ja: {
    downloadSvg: 'SVGダウンロード',
    exportPdf: 'PDF出力',
    exporting: '出力中...',
    generalRoughness: '一般粗さ',
    tolerance: '公差',
    projection: '投影法',
    tolF: 'f (精密)', tolM: 'm (中)', tolC: 'c (粗)', tolV: 'v (極粗)',
    firstAngle: '第1角法',
    thirdAngle: '第3角法',
    noGeometry: '表示する形状がありません。まず形状を生成してください。',
    untitledPart: '無題部品',
    partName: '部品名', partNo: '図番', material: '材料', company: '会社',
    scaleLbl: '尺度', date: '日付', drawnBy: '作成者',
    tolLabel: '一般公差', roughLabel: '一般粗さ',
    frontKo: '正面図', topKo: '平面図', rightKo: '右側面図',
    hlrToggle: '実投影(HLR)', hlrOn: 'HLRモード — 陰線表示 · 寸法は標準モード', hlrFail: 'HLR投影失敗',
  },
  zh: {
    downloadSvg: '下载SVG',
    exportPdf: '导出PDF',
    exporting: '导出中...',
    generalRoughness: '粗糙度',
    tolerance: '公差',
    projection: '投影法',
    tolF: 'f (精密)', tolM: 'm (中)', tolC: 'c (粗)', tolV: 'v (非常粗)',
    firstAngle: '第一角法',
    thirdAngle: '第三角法',
    noGeometry: '无可显示的几何体。请先生成形状。',
    untitledPart: '未命名零件',
    partName: '零件名', partNo: '图号', material: '材料', company: '公司',
    scaleLbl: '比例', date: '日期', drawnBy: '绘制者',
    tolLabel: '一般公差', roughLabel: '一般粗糙度',
    frontKo: '正视图', topKo: '俯视图', rightKo: '右视图',
    hlrToggle: '真实投影(HLR)', hlrOn: 'HLR模式 — 显示隐藏线 · 尺寸在标准模式', hlrFail: 'HLR投影失败',
  },
  es: {
    downloadSvg: 'Descargar SVG',
    exportPdf: 'Exportar PDF',
    exporting: 'Exportando...',
    generalRoughness: 'Rugosidad',
    tolerance: 'Tolerancia',
    projection: 'Proyección',
    tolF: 'f (fina)', tolM: 'm (media)', tolC: 'c (gruesa)', tolV: 'v (muy gruesa)',
    firstAngle: '1er ángulo',
    thirdAngle: '3er ángulo',
    noGeometry: 'Nada que mostrar. Genere primero una forma.',
    untitledPart: 'Pieza sin título',
    partName: 'Nombre pieza', partNo: 'Nº plano', material: 'Material', company: 'Empresa',
    scaleLbl: 'Escala', date: 'Fecha', drawnBy: 'Dibujado por',
    tolLabel: 'Tol. general', roughLabel: 'Rug. general',
    frontKo: 'FRENTE', topKo: 'SUPERIOR', rightKo: 'DERECHA',
    hlrToggle: 'Proyección real (HLR)', hlrOn: 'Modo HLR — líneas ocultas · cotas en modo estándar', hlrFail: 'Fallo de proyección HLR',
  },
  ar: {
    downloadSvg: 'تحميل SVG',
    exportPdf: 'تصدير PDF',
    exporting: 'جاري التصدير...',
    generalRoughness: 'الخشونة',
    tolerance: 'التفاوت',
    projection: 'الإسقاط',
    tolF: 'f (دقيق)', tolM: 'm (متوسط)', tolC: 'c (خشن)', tolV: 'v (خشن جدًا)',
    firstAngle: 'الزاوية الأولى',
    thirdAngle: 'الزاوية الثالثة',
    noGeometry: 'لا توجد هندسة للعرض. أنشئ شكلاً أولاً.',
    untitledPart: 'قطعة بلا عنوان',
    partName: 'اسم القطعة', partNo: 'رقم الرسم', material: 'المادة', company: 'الشركة',
    scaleLbl: 'المقياس', date: 'التاريخ', drawnBy: 'رسم بواسطة',
    tolLabel: 'التفاوت العام', roughLabel: 'الخشونة العامة',
    frontKo: 'الأمامي', topKo: 'العلوي', rightKo: 'الأيمن',
    hlrToggle: 'إسقاط حقيقي (HLR)', hlrOn: 'وضع HLR — خطوط مخفية · الأبعاد في الوضع القياسي', hlrFail: 'فشل إسقاط HLR',
  },
} as const;

/* ─── Types ─────────────────────────────────────────────────────────────────── */

interface DrawingViewProps {
  result: ShapeResult | null;
  unitSystem?: UnitSystem;
  partName?: string;
  partNumber?: string;
  material?: string;
  drawnBy?: string;
  company?: string;
  generalRoughness?: SurfaceRoughnessGrade;
  toleranceClass?: ISO2768Class;
  projectionAngle?: 'first' | 'third';
  onExportPDF?: () => void;
}

interface Edge2D {
  x1: number; y1: number;
  x2: number; y2: number;
  hidden: boolean;
}

interface ProjectedView {
  edges: Edge2D[];
  label: string;
  labelKo: string;
}

/* ─── Constants ─────────────────────────────────────────────────────────────── */

const DRAWING_W = 1050;
const DRAWING_H = 760;
const MARGIN = 30;
const TITLE_BLOCK_H = 100;
const TITLE_BLOCK_W = 380;
const VIEW_GAP = 40;
const DIM_OFFSET = 18;
const DIM_ARROW = 4;
const DIM_EXT = 6;

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

/** Extract triangle edges from BufferGeometry, returning unique edge pairs */
function _extractEdges(geometry: THREE.BufferGeometry): [THREE.Vector3, THREE.Vector3][] {
  const pos = geometry.getAttribute('position');
  if (!pos) return [];
  const idx = geometry.getIndex();
  const edges: [THREE.Vector3, THREE.Vector3][] = [];
  const edgeSet = new Set<string>();

  const addEdge = (a: THREE.Vector3, b: THREE.Vector3) => {
    const ka = `${a.x.toFixed(4)},${a.y.toFixed(4)},${a.z.toFixed(4)}`;
    const kb = `${b.x.toFixed(4)},${b.y.toFixed(4)},${b.z.toFixed(4)}`;
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push([a.clone(), b.clone()]);
    }
  };

  if (idx) {
    const arr = idx.array;
    for (let i = 0; i < arr.length; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, arr[i]);
      const b = new THREE.Vector3().fromBufferAttribute(pos, arr[i + 1]);
      const c = new THREE.Vector3().fromBufferAttribute(pos, arr[i + 2]);
      addEdge(a, b); addEdge(b, c); addEdge(c, a);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
      addEdge(a, b); addEdge(b, c); addEdge(c, a);
    }
  }
  return edges;
}

/** Use EdgesGeometry for sharp-edge outlines (better silhouette) */
function extractSharpEdges(geometry: THREE.BufferGeometry): [THREE.Vector3, THREE.Vector3][] {
  const edgesGeo = new THREE.EdgesGeometry(geometry, 20);
  const pos = edgesGeo.getAttribute('position');
  const result: [THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i < pos.count; i += 2) {
    result.push([
      new THREE.Vector3().fromBufferAttribute(pos, i),
      new THREE.Vector3().fromBufferAttribute(pos, i + 1),
    ]);
  }
  return result;
}

/** Project 3D edges to 2D for a given orthographic view */
function projectEdges(
  edges: [THREE.Vector3, THREE.Vector3][],
  dropAxis: 'x' | 'y' | 'z' | 'iso',
  flipH: boolean,
  flipV: boolean,
): Edge2D[] {
  if (dropAxis === 'iso') {
    const cos30 = Math.cos(Math.PI / 6);
    const sin30 = Math.sin(Math.PI / 6);
    return edges.map(([a, b]) => ({
      x1: (a.x - a.z) * cos30,
      y1: a.y - (a.x + a.z) * sin30,
      x2: (b.x - b.z) * cos30,
      y2: b.y - (b.x + b.z) * sin30,
      hidden: false
    }));
  }

  return edges.map(([a, b]) => {
    let x1: number, y1: number, x2: number, y2: number;
    // depth values for hidden-line detection
    let _d1: number, _d2: number;

    switch (dropAxis) {
      case 'z': // Front view (XY plane, looking from +Z)
        x1 = a.x; y1 = a.y; x2 = b.x; y2 = b.y;
        _d1 = a.z; _d2 = b.z;
        break;
      case 'y': // Top view (XZ plane, looking from -Y)
        x1 = a.x; y1 = a.z; x2 = b.x; y2 = b.z;
        _d1 = a.y; _d2 = b.y;
        break;
      case 'x': // Right view (YZ plane, looking from +X)
        x1 = a.z; y1 = a.y; x2 = b.z; y2 = b.y;
        _d1 = a.x; _d2 = b.x;
        break;
    }

    if (flipH) { x1 = -x1!; x2 = -x2!; }
    if (flipV) { y1 = -y1!; y2 = -y2!; }

    return { x1: x1!, y1: y1!, x2: x2!, y2: y2!, hidden: false };
  });
}

/** Compute bounding rect of 2D edges */
function edgeBounds(edges: Edge2D[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of edges) {
    minX = Math.min(minX, e.x1, e.x2);
    minY = Math.min(minY, e.y1, e.y2);
    maxX = Math.max(maxX, e.x1, e.x2);
    maxY = Math.max(maxY, e.y1, e.y2);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/* ─── SVG sub-components ────────────────────────────────────────────────────── */

/** B-4(260808e) — 실 HLR 뷰 패널: occtProjectViews 산출(가시 실선+은선 파선)을
 *  기존 뷰 슬롯에 중첩 svg 로 맞춰 넣는다(viewBox 자동 맞춤 — 좌표계 사상
 *  불필요). 라이브 핸들에서 토글 시점마다 재투영 = 연관성 구성적 성립. */
function HlrViewPanel({ data, cx, cy, w, h, label, view, ext, unitSystem }: {
  data: { visible: string[]; hidden: string[]; viewBox: string | null } | undefined;
  cx: number; cy: number; w: number; h: number; label: string;
  view: 'front' | 'top' | 'right';
  ext: { min: [number, number, number]; max: [number, number, number] } | null;
  unitSystem: UnitSystem;
}) {
  if (!data?.viewBox) return null;
  /**
   * F-2/D-1(260808f) — 해석 치수 오버레이: 모델 bbox(모델값 — 픽셀 측정 아님)
   * 를 투영좌표로 사상. 사상 규약은 노드 HLR 엔진(hlr-drawing.mjs)에서 실측
   * 검증된 그대로: front (x,−z) · top (x,y) · right (y,−z). 재투영 시점마다
   * 재계산되므로 치수도 연관이다.
   */
  const fmtV = (n: number) => formatWithUnit(n, unitSystem, 1);
  const dims: React.ReactNode[] = [];
  let [vx, vy, vw, vh] = data.viewBox.split(' ').map(Number);
  if (ext && [vx, vy, vw, vh].every(Number.isFinite)) {
    const mnx = ext.min[0], mny = ext.min[1], mnz = ext.min[2];
    const mxx = ext.max[0], mxy = ext.max[1], mxz = ext.max[2];
    const W3 = mxx - mnx, D3 = mxy - mny, H3 = mxz - mnz;
    const fs = Math.max(3.5, vh * 0.05);
    const dimH = (x0: number, x1: number, y: number, txt: string, key: string) => dims.push(
      <g key={key}>
        <line x1={x0} y1={y} x2={x1} y2={y} stroke="#2563eb" strokeWidth={0.35} vectorEffect="non-scaling-stroke" />
        <line x1={x0} y1={y - 1.5} x2={x0} y2={y + 1.5} stroke="#2563eb" strokeWidth={0.35} vectorEffect="non-scaling-stroke" />
        <line x1={x1} y1={y - 1.5} x2={x1} y2={y + 1.5} stroke="#2563eb" strokeWidth={0.35} vectorEffect="non-scaling-stroke" />
        <text x={(x0 + x1) / 2} y={y - 1.2} fill="#2563eb" fontSize={fs} textAnchor="middle" fontFamily="ui-monospace, monospace">{txt}</text>
      </g>,
    );
    const dimV = (x: number, y0: number, y1: number, txt: string, key: string) => dims.push(
      <g key={key}>
        <line x1={x} y1={y0} x2={x} y2={y1} stroke="#2563eb" strokeWidth={0.35} vectorEffect="non-scaling-stroke" />
        <line x1={x - 1.5} y1={y0} x2={x + 1.5} y2={y0} stroke="#2563eb" strokeWidth={0.35} vectorEffect="non-scaling-stroke" />
        <line x1={x - 1.5} y1={y1} x2={x + 1.5} y2={y1} stroke="#2563eb" strokeWidth={0.35} vectorEffect="non-scaling-stroke" />
        <text x={x - 1.2} y={(y0 + y1) / 2} fill="#2563eb" fontSize={fs} textAnchor="end" dominantBaseline="middle" fontFamily="ui-monospace, monospace">{txt}</text>
      </g>,
    );
    const pad = Math.max(6, vh * 0.08);
    // 뷰별 (u,v) 파트 원점(투영 최소 코너) — 원 위치치수의 기준선.
    let u0 = mnx, v0 = mny;
    if (view === 'front') {
      dimH(mnx, mxx, -mnz + pad, fmtV(W3), 'w');
      dimV(mnx - pad, -mxz, -mnz, fmtV(H3), 'h');
      vx = Math.min(vx, mnx - pad * 2.5); vy = Math.min(vy, -mxz - pad / 2);
      vw = Math.max(vw, W3 + pad * 4); vh = Math.max(vh, H3 + pad * 2.5);
      u0 = mnx; v0 = -mxz;
    } else if (view === 'top') {
      dimH(mnx, mxx, mny - pad, fmtV(W3), 'w');
      dimV(mnx - pad, mny, mxy, fmtV(D3), 'd');
      vx = Math.min(vx, mnx - pad * 2.5); vy = Math.min(vy, mny - pad * 2.5);
      vw = Math.max(vw, W3 + pad * 4); vh = Math.max(vh, D3 + pad * 4);
      u0 = mnx; v0 = mny;
    } else {
      // right 뷰 (u,v)=(−y,−z) — drawingProjectionMapping.test.ts 실측 정정
      // (가정 (y,−z)의 u 부호 반전: 판 y 0..60 이 u −60..0 에 투영된다).
      dimH(-mxy, -mny, -mnz + pad, fmtV(D3), 'd');
      dimV(-mxy - pad, -mxz, -mnz, fmtV(H3), 'h');
      vx = Math.min(vx, -mxy - pad * 2.5); vy = Math.min(vy, -mxz - pad / 2);
      vw = Math.max(vw, D3 + pad * 4); vh = Math.max(vh, H3 + pad * 2.5);
      u0 = -mxy; v0 = -mxz;
    }

    // F-4/D-2(260808g) — 원형 피처(구멍/보스 실루엣) 치수: 소스는 **B-rep
    // 투영의 완전 원**(svgCircleExtract — 실측 경로 형식 고정)이라 피처 기원
    // 과 무관하게 모델값이고, 재투영마다 재추출되므로 연관이다.
    //  · ⌀ 그룹: 같은 지름은 1회 표기(×n), 지시선으로 첫 원에 연결
    //  · 센터마크 + 위치치수: 고유 u/v 좌표별 스태거(기준선 = 파트 최소 코너)
    const circles = extractCircles([...(data.visible as unknown[]), ...(data.hidden as unknown[])]);
    if (circles.length > 0 && circles.length <= 12) {
      const rnd = (n: number) => Math.round(n * 100) / 100;
      circles.forEach((c, i) => {
        const cm = Math.max(1.2, c.r * 0.3);
        dims.push(
          <g key={`cm${i}`} stroke="#2563eb" strokeWidth={0.3}>
            <line x1={c.cx - cm} y1={c.cy} x2={c.cx + cm} y2={c.cy} vectorEffect="non-scaling-stroke" />
            <line x1={c.cx} y1={c.cy - cm} x2={c.cx} y2={c.cy + cm} vectorEffect="non-scaling-stroke" />
          </g>,
        );
      });
      const groups = new Map<string, typeof circles>();
      circles.forEach(c => {
        const k = rnd(2 * c.r).toFixed(2);
        const g = groups.get(k);
        if (g) g.push(c); else groups.set(k, [c]);
      });
      let gi = 0;
      for (const [, cs] of groups) {
        const c = cs[0];
        const lx = c.cx + c.r * 0.75, ly = c.cy - c.r * 0.75;
        dims.push(
          <g key={`dia${gi}`}>
            <line x1={lx} y1={ly} x2={lx + pad * 0.9} y2={ly - pad * 0.55} stroke="#2563eb" strokeWidth={0.3} vectorEffect="non-scaling-stroke" />
            <text x={lx + pad} y={ly - pad * 0.6} fill="#2563eb" fontSize={fs} fontFamily="ui-monospace, monospace">
              {`⌀${fmtV(rnd(2 * c.r))}${cs.length > 1 ? ` ×${cs.length}` : ''}`}
            </text>
          </g>,
        );
        gi++;
      }
      const uxs = [...new Set(circles.map(c => rnd(c.cx)))].sort((a, b) => a - b);
      const uys = [...new Set(circles.map(c => rnd(c.cy)))].sort((a, b) => a - b);
      uxs.forEach((x, i) => {
        if (Math.abs(x - u0) < 1e-6) return;
        dimH(u0, x, v0 - pad * (1.9 + 0.75 * i), fmtV(x - u0), `cu${i}`);
      });
      uys.forEach((y, i) => {
        if (Math.abs(y - v0) < 1e-6) return;
        dimV(u0 - pad * (1.9 + 0.75 * i), v0, y, fmtV(y - v0), `cv${i}`);
      });
      // viewBox 확장: 우/하단 모서리를 고정한 채 좌/상단만 스태거 행·열만큼.
      const right = vx + vw, bottom = vy + vh;
      vy = Math.min(vy, v0 - pad * (1.9 + 0.75 * uxs.length) - pad / 2);
      vx = Math.min(vx, u0 - pad * (1.9 + 0.75 * uys.length) - pad / 2);
      vw = right - vx; vh = bottom - vy;
    }
  }
  const vb = vx + ' ' + vy + ' ' + vw + ' ' + vh;
  return (
    <g>
      <svg x={cx - w / 2} y={cy - h / 2} width={w} height={h} viewBox={vb} preserveAspectRatio="xMidYMid meet">
        {data.hidden.map((d, i) => (
          <path key={'h' + i} d={d} fill="none" stroke="#777" strokeWidth={0.5} strokeDasharray="4 2" vectorEffect="non-scaling-stroke" />
        ))}
        {data.visible.map((d, i) => (
          <path key={'v' + i} d={d} fill="none" stroke="#000" strokeWidth={0.9} vectorEffect="non-scaling-stroke" />
        ))}
        {dims}
      </svg>
      <text x={cx} y={cy + h / 2 + 14} textAnchor="middle" fontSize={11} fontWeight={600} fill="#000">{label}</text>
    </g>
  );
}

function DimensionLine({ x1, y1, x2, y2, value, unitSystem, side }: {
  x1: number; y1: number; x2: number; y2: number;
  value: number; unitSystem: UnitSystem;
  side: 'top' | 'bottom' | 'left' | 'right';
}) {
  const label = formatWithUnit(value, unitSystem, 1);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  // Extension lines
  let ext1Start: [number, number], ext1End: [number, number];
  let ext2Start: [number, number], ext2End: [number, number];
  const textAnchor: 'start' | 'middle' | 'end' = 'middle';
  let textX = midX, textY = midY;
  let textRotate = 0;

  const isHorizontal = side === 'top' || side === 'bottom';

  if (isHorizontal) {
    const dir = side === 'top' ? -1 : 1;
    ext1Start = [x1, y1 - dir * DIM_EXT]; ext1End = [x1, y1 + dir * DIM_EXT];
    ext2Start = [x2, y2 - dir * DIM_EXT]; ext2End = [x2, y2 + dir * DIM_EXT];
    textY = midY + dir * 4;
  } else {
    const dir = side === 'left' ? -1 : 1;
    ext1Start = [x1 - dir * DIM_EXT, y1]; ext1End = [x1 + dir * DIM_EXT, y1];
    ext2Start = [x2 - dir * DIM_EXT, y2]; ext2End = [x2 + dir * DIM_EXT, y2];
    textX = midX + dir * 4;
    textRotate = -90;
  }

  // Arrowheads
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const ax = Math.cos(angle) * DIM_ARROW;
  const ay = Math.sin(angle) * DIM_ARROW;
  const ap = DIM_ARROW * 0.4;

  return (
    <g className="dim-line" stroke="var(--nx-accent)" strokeWidth={0.5} fill="none">
      {/* Extension lines */}
      <line x1={ext1Start[0]} y1={ext1Start[1]} x2={ext1End[0]} y2={ext1End[1]} strokeDasharray="1.5,1" />
      <line x1={ext2Start[0]} y1={ext2Start[1]} x2={ext2End[0]} y2={ext2End[1]} strokeDasharray="1.5,1" />
      {/* Dimension line */}
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      {/* Arrows */}
      <polygon
        points={`${x1},${y1} ${x1 + ax - ay * (ap / DIM_ARROW)},${y1 + ay + ax * (ap / DIM_ARROW)} ${x1 + ax + ay * (ap / DIM_ARROW)},${y1 + ay - ax * (ap / DIM_ARROW)}`}
        fill="var(--nx-accent)" stroke="none"
      />
      <polygon
        points={`${x2},${y2} ${x2 - ax - ay * (ap / DIM_ARROW)},${y2 - ay + ax * (ap / DIM_ARROW)} ${x2 - ax + ay * (ap / DIM_ARROW)},${y2 - ay - ax * (ap / DIM_ARROW)}`}
        fill="var(--nx-accent)" stroke="none"
      />
      {/* Label */}
      <text
        x={textX} y={textY}
        textAnchor={textAnchor}
        dominantBaseline="central"
        transform={textRotate ? `rotate(${textRotate},${textX},${textY})` : undefined}
        fill="var(--nx-accent)" stroke="none" fontSize={7} fontFamily="monospace" fontWeight={600}
      >
        {label}
      </text>
    </g>
  );
}

function ViewBlock({ view, ox, oy, scale, bbox3D, unitSystem }: {
  view: ProjectedView;
  ox: number; oy: number;
  scale: number;
  bbox3D: { w: number; h: number; d: number };
  unitSystem: UnitSystem;
}) {
  const bounds = edgeBounds(view.edges);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  const sw = bounds.w * scale;
  const sh = bounds.h * scale;

  // Determine which dimension labels to show
  let dimW: number, dimH: number;
  if (view.label === 'FRONT') { dimW = bbox3D.w; dimH = bbox3D.h; }
  else if (view.label === 'TOP') { dimW = bbox3D.w; dimH = bbox3D.d; }
  else { dimW = bbox3D.d; dimH = bbox3D.h; }

  return (
    <g>
      {/* View label */}
      <text x={ox} y={oy - sh / 2 - 12} textAnchor="middle" fill="#555" fontSize={7} fontFamily="sans-serif" fontWeight={700}>
        {view.label}
      </text>
      {/* Edges */}
      {view.edges.map((e, i) => (
        <line
          key={i}
          x1={ox + (e.x1 - cx) * scale}
          y1={oy - (e.y1 - cy) * scale}
          x2={ox + (e.x2 - cx) * scale}
          y2={oy - (e.y2 - cy) * scale}
          stroke="#000"
          strokeWidth={e.hidden ? 0.3 : 0.7}
          strokeDasharray={e.hidden ? '2,1.5' : undefined}
        />
      ))}
      {/* Dimensions (only for orthographic views) */}
      {view.label !== 'ISO' && (
        <>
          <DimensionLine
            x1={ox - sw / 2} y1={oy + sh / 2 + DIM_OFFSET}
            x2={ox + sw / 2} y2={oy + sh / 2 + DIM_OFFSET}
            value={dimW} unitSystem={unitSystem} side="bottom"
          />
          <DimensionLine
            x1={ox + sw / 2 + DIM_OFFSET} y1={oy + sh / 2}
            x2={ox + sw / 2 + DIM_OFFSET} y2={oy - sh / 2}
            value={dimH} unitSystem={unitSystem} side="right"
          />
        </>
      )}
    </g>
  );
}

/** KS B ISO 7200 / KS A 0005 규격 표제란 */
function TitleBlock({
  x, y, w, h,
  partName, partNumber, date, scale, material,
  drawnBy, company,
  generalRoughness, toleranceClass, projectionAngle,
  tt,
}: {
  x: number; y: number; w: number; h: number;
  partName: string; partNumber: string; date: string; scale: string; material: string;
  drawnBy: string; company: string;
  generalRoughness: SurfaceRoughnessGrade;
  toleranceClass: ISO2768Class;
  projectionAngle: 'first' | 'third';
  tt: (typeof dict)[keyof typeof dict];
}) {
  const lbl = (lx: number, ly: number, text: string) => (
    <text x={lx} y={ly} fill="#888" fontSize={5} fontFamily="sans-serif" dominantBaseline="central">{text}</text>
  );
  const val = (vx: number, vy: number, text: string, bold = false) => (
    <text x={vx} y={vy} fill="#000" fontSize={7} fontFamily="sans-serif" fontWeight={bold ? 700 : 400} dominantBaseline="central">{text}</text>
  );

  const R1 = h / 5; // row height
  const col1 = 55;  // label column width
  const _col2 = w / 2 - col1; // value column width (left half)
  const mid = w / 2;         // midpoint

  // General tolerance text
  const tolText = `ISO 2768-${toleranceClass.toUpperCase()}`;
  // Surface roughness Ra value
  const raVal = ROUGHNESS_RA[generalRoughness];
  const raText = `Ra ${raVal} µm (${generalRoughness})`;

  return (
    <g>
      {/* Outer border */}
      <rect x={x} y={y} width={w} height={h} fill="white" stroke="#000" strokeWidth={1} />

      {/* Horizontal dividers */}
      {[1,2,3,4].map(i => (
        <line key={i} x1={x} y1={y + R1 * i} x2={x + w} y2={y + R1 * i} stroke="#000" strokeWidth={0.4} />
      ))}

      {/* Vertical divider (center) */}
      <line x1={x + mid} y1={y} x2={x + mid} y2={y + h} stroke="#000" strokeWidth={0.4} />
      {/* Label-value divider (left half) */}
      <line x1={x + col1} y1={y} x2={x + col1} y2={y + h} stroke="#000" strokeWidth={0.25} strokeDasharray="1,1" />
      {/* Label-value divider (right half) */}
      <line x1={x + mid + col1} y1={y} x2={x + mid + col1} y2={y + h} stroke="#000" strokeWidth={0.25} strokeDasharray="1,1" />

      {/* Row 0: Part name | Company */}
      {lbl(x + 3, y + R1 * 0.5, tt.partName)}
      {val(x + col1 + 3, y + R1 * 0.5, partName, true)}
      {lbl(x + mid + 3, y + R1 * 0.5, tt.company)}
      {val(x + mid + col1 + 3, y + R1 * 0.5, company)}

      {/* Row 1: Part No | Scale */}
      {lbl(x + 3, y + R1 * 1.5, tt.partNo)}
      {val(x + col1 + 3, y + R1 * 1.5, partNumber)}
      {lbl(x + mid + 3, y + R1 * 1.5, tt.scaleLbl)}
      {val(x + mid + col1 + 3, y + R1 * 1.5, scale)}

      {/* Row 2: Material | Date */}
      {lbl(x + 3, y + R1 * 2.5, tt.material)}
      {val(x + col1 + 3, y + R1 * 2.5, material)}
      {lbl(x + mid + 3, y + R1 * 2.5, tt.date)}
      {val(x + mid + col1 + 3, y + R1 * 2.5, date)}

      {/* Row 3: Tolerance | Drawn by */}
      {lbl(x + 3, y + R1 * 3.5, tt.tolLabel)}
      {val(x + col1 + 3, y + R1 * 3.5, tolText)}
      {lbl(x + mid + 3, y + R1 * 3.5, tt.drawnBy)}
      {val(x + mid + col1 + 3, y + R1 * 3.5, drawnBy)}

      {/* Row 4: Surface roughness | Projection symbol */}
      {lbl(x + 3, y + R1 * 4.5, tt.roughLabel)}
      {val(x + col1 + 3, y + R1 * 4.5, raText)}
      {/* Projection angle symbol (simplified ISO 128 symbols) */}
      <ProjectionSymbol
        x={x + mid + 3} y={y + R1 * 4 + 2}
        w={mid - 6} h={R1 - 4}
        angle={projectionAngle}
        tt={tt}
      />
    </g>
  );
}

/** ISO 128 first-angle / third-angle projection symbol */
function ProjectionSymbol({ x, y, w: _w, h, angle, tt }: {
  x: number; y: number; w: number; h: number;
  angle: 'first' | 'third';
  tt: (typeof dict)[keyof typeof dict];
}) {
  // Simplified truncated-cone symbol
  const cx = x + 16;
  const cy = y + h / 2;
  const r1 = h * 0.35; // large radius
  const r2 = h * 0.18; // small radius
  const conW = h * 0.55;
  // First-angle: cone on left, circle on right; Third-angle: reversed
  const coneX = angle === 'first' ? cx - conW / 2 : cx + conW / 2;
  const circX = angle === 'first' ? cx + r1 + 4 : cx - r1 - 4;

  return (
    <g>
      {/* Cone (trapezoid) */}
      <polygon
        points={`${coneX},${cy - r1} ${coneX + (angle === 'first' ? conW : -conW)},${cy - r2} ${coneX + (angle === 'first' ? conW : -conW)},${cy + r2} ${coneX},${cy + r1}`}
        fill="none" stroke="#000" strokeWidth={0.5}
      />
      {/* Circle projection */}
      <circle cx={circX} cy={cy} r={r2} fill="none" stroke="#000" strokeWidth={0.5} />
      <text x={x + 38} y={cy} fill="#555" fontSize={5} fontFamily="sans-serif" dominantBaseline="central">
        {angle === 'first' ? tt.firstAngle : tt.thirdAngle}
      </text>
    </g>
  );
}

/* ─── Export helper ─────────────────────────────────────────────────────────── */

async function exportDrawingSVG(svgEl: SVGSVGElement | null, filename = 'drawing.svg') {
  if (!svgEl) return;
  const { downloadBlob } = await import('@/lib/platform');
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
  await downloadBlob(filename, blob);
}

/* ─── Main component ────────────────────────────────────────────────────────── */

export default function DrawingView({
  result,
  unitSystem = 'mm',
  partName,
  partNumber,
  material,
  drawnBy,
  company,
  generalRoughness = 'N7',
  toleranceClass = 'm',
  projectionAngle = 'first',
  onExportPDF,
}: DrawingViewProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const tt = dict[langMap[seg] ?? 'en'];

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [roughness, setRoughness] = useState<SurfaceRoughnessGrade>(generalRoughness);
  const [tolerance, setTolerance] = useState<ISO2768Class>(toleranceClass);
  const [projection, setProjection] = useState<'first' | 'third'>(projectionAngle);
  // B-4 — 실 HLR 모드: 라이브 B-rep 핸들이 있을 때만 토글 노출. 토글 시점에
  // 현재 핸들에서 재투영(수 초·온디맨드 — 스냅샷 아님).
  const [hlrViews, setHlrViews] = useState<Record<string, { visible: string[]; hidden: string[]; viewBox: string | null }> | null>(null);
  const [hlrBusy, setHlrBusy] = useState(false);
  const [hlrError, setHlrError] = useState('');
  const [hlrExt, setHlrExt] = useState<{ min: [number, number, number]; max: [number, number, number] } | null>(null);
  const occtHandle = (result?.geometry?.userData as { occtHandle?: string } | undefined)?.occtHandle;
  const toggleHlr = useCallback(async () => {
    if (hlrViews) { setHlrViews(null); return; }
    if (!occtHandle || hlrBusy) return;
    setHlrBusy(true); setHlrError('');
    try {
      const { occtProjectViews, isOcctReady } = await import('../features/occtEngine');
      if (!isOcctReady()) throw new Error('OCCT not ready');
      const projected = occtProjectViews(occtHandle, ['front', 'top', 'right']);
      if (!projected) throw new Error('projection unavailable');
      // F-2/D-1 — 치수 소스 = 모델 지오메트리 bbox(모델값). 재투영마다 갱신.
      const geo = result?.geometry;
      if (geo) {
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        setHlrExt(bb ? { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] } : null);
      } else setHlrExt(null);
      setHlrViews(projected);
    } catch (err) {
      setHlrError(err instanceof Error ? err.message : String(err));
    } finally {
      setHlrBusy(false);
    }
  }, [hlrViews, occtHandle, hlrBusy]);

  // M4: Orthographic views are recomputed from `result.geometry` every render (useMemo below).
  // Unlike `AutoDrawingPanel`, there is no separate cached drawing snapshot — no stale-preview gap.

  // Prevent page scroll when mouse wheel is used inside the drawing view
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const views = useMemo<ProjectedView[] | null>(() => {
    if (!result) return null;
    const edges = extractSharpEdges(result.geometry);
    if (edges.length === 0) return null;

    return [
      {
        label: 'FRONT',
        labelKo: '정면도',
        edges: projectEdges(edges, 'z', false, false),
      },
      {
        label: 'TOP',
        labelKo: '평면도',
        edges: projectEdges(edges, 'y', false, true),
      },
      {
        label: 'RIGHT',
        labelKo: '우측면도',
        edges: projectEdges(edges, 'x', true, false),
      },
      {
        label: 'ISO',
        labelKo: '등각투상도',
        edges: projectEdges(edges, 'iso', false, false),
      },
    ];
  }, [result]);

  const handleExport = useCallback(() => {
    void exportDrawingSVG(svgRef.current, `${partName || 'drawing'}.svg`);
  }, [partName]);

  const handleExportPDF = useCallback(async () => {
    if (!svgRef.current || pdfExporting) return;
    setPdfExporting(true);
    try {
      await exportDrawingPDF(svgRef.current, `${partName || 'drawing'}.pdf`, 'A3', 'landscape');
      onExportPDF?.();
    } finally {
      setPdfExporting(false);
    }
  }, [partName, pdfExporting, onExportPDF]);

  if (!result || !views) {
    return (
      <div style={{
        width: '100%', height: '100%', background: 'var(--nx-bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--nx-border-strong)', fontSize: 14,
      }}>
        {tt.noGeometry}
      </div>
    );
  }

  const bbox = result.bbox;

  // Compute scale to fit all three views in the drawing area
  const usableW = DRAWING_W - MARGIN * 2 - VIEW_GAP;
  const usableH = DRAWING_H - MARGIN * 2 - TITLE_BLOCK_H - VIEW_GAP - 30;

  const frontBounds = edgeBounds(views[0].edges);
  const topBounds = edgeBounds(views[1].edges);
  const rightBounds = edgeBounds(views[2].edges);

  // Front + Right horizontally, Front + Top vertically
  const hNeeded = frontBounds.w + rightBounds.w;
  const vNeeded = frontBounds.h + topBounds.h;
  const scaleH = (usableW - VIEW_GAP - DIM_OFFSET * 4) / (hNeeded || 1);
  const scaleV = (usableH - VIEW_GAP - DIM_OFFSET * 4) / (vNeeded || 1);
  const scale = Math.min(scaleH, scaleV, 3);

  // Layout positions (first-angle projection layout)
  const frontW = frontBounds.w * scale;
  const frontH = frontBounds.h * scale;
  const topH = topBounds.h * scale;
  const rightW = rightBounds.w * scale;

  const frontCX = MARGIN + DIM_OFFSET * 2 + frontW / 2;
  const frontCY = MARGIN + 20 + topH + VIEW_GAP + frontH / 2;

  const topCX = frontCX;
  const topCY = MARGIN + 20 + topH / 2;

  const rightCX = frontCX + frontW / 2 + VIEW_GAP + DIM_OFFSET * 2 + rightW / 2;
  const rightCY = frontCY;

  // Iso view placed at top-right corner
  const isoCX = DRAWING_W - MARGIN - 120;
  const isoCY = MARGIN + 80;

  const today = new Date().toISOString().slice(0, 10);
  const scaleLabel = `1:${(1 / scale).toFixed(1)}`;

  return (
    <div ref={containerRef} style={{
      width: '100%', height: '100%', background: 'var(--nx-panel)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      overflow: 'auto', padding: 8,
    }}
      onWheel={e => e.stopPropagation()}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap',
      }}>
        {occtHandle && (
          <button
            onClick={() => { void toggleHlr(); }}
            disabled={hlrBusy}
            style={{
              padding: '5px 14px', borderRadius: 6,
              border: '1px solid ' + (hlrViews ? 'var(--nx-accent)' : 'var(--nx-border)'),
              background: hlrViews ? 'var(--nx-bg)' : 'var(--nx-panel-2)',
              color: hlrViews ? 'var(--nx-accent-2)' : 'var(--nx-text)',
              fontSize: 12, fontWeight: 600, cursor: hlrBusy ? 'wait' : 'pointer',
            }}
          >
            {hlrBusy ? '…' : `📐 ${tt.hlrToggle}`}
          </button>
        )}
        {hlrError && <span style={{ fontSize: 11, color: '#dc2626' }}>{tt.hlrFail}: {hlrError}</span>}
        <button
          onClick={handleExport}
          style={{
            padding: '5px 14px', borderRadius: 6, border: '1px solid var(--nx-border)',
            background: 'var(--nx-panel-2)', color: 'var(--nx-text)', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M8 1v9M5 7l3 3 3-3M2 12v2h12v-2" />
          </svg>
          {tt.downloadSvg}
        </button>
        <button
          onClick={handleExportPDF}
          disabled={pdfExporting}
          style={{
            padding: '5px 14px', borderRadius: 6, border: '1px solid var(--nx-accent)',
            background: pdfExporting ? 'var(--nx-panel-2)' : 'var(--nx-bg)',
            color: pdfExporting ? 'var(--nx-text-2)' : 'var(--nx-accent-2)',
            fontSize: 12, fontWeight: 600,
            cursor: pdfExporting ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
            opacity: pdfExporting ? 0.7 : 1,
            transition: 'all 0.15s',
          }}
        >
          {pdfExporting ? (
            <>
              <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}
                style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M8 2a6 6 0 1 0 6 6" strokeLinecap="round" />
              </svg>
              {tt.exporting}
            </>
          ) : (
            <>
              <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <rect x={2} y={1} width={12} height={14} rx={1} />
                <path d="M4 5h5M4 8h8M4 11h6" strokeLinecap="round" />
              </svg>
              {tt.exportPdf}
            </>
          )}
        </button>

        {/* Drawing settings */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8, borderLeft: '1px solid var(--nx-border)', paddingLeft: 8 }}>
          <label style={{ fontSize: 10, color: 'var(--nx-text-2)', whiteSpace: 'nowrap' }}>{tt.generalRoughness}</label>
          <select value={roughness} onChange={e => setRoughness(e.target.value as SurfaceRoughnessGrade)}
            style={{ fontSize: 10, background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)', color: 'var(--nx-text)', borderRadius: 4, padding: '2px 4px' }}>
            {(['N4','N5','N6','N7','N8','N9','N10','N11','N12'] as SurfaceRoughnessGrade[]).map(g => (
              <option key={g} value={g}>{g} (Ra {ROUGHNESS_RA[g]}µm)</option>
            ))}
          </select>
          <label style={{ fontSize: 10, color: 'var(--nx-text-2)', whiteSpace: 'nowrap' }}>{tt.tolerance}</label>
          <select value={tolerance} onChange={e => setTolerance(e.target.value as ISO2768Class)}
            style={{ fontSize: 10, background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)', color: 'var(--nx-text)', borderRadius: 4, padding: '2px 4px' }}>
            <option value="f">{tt.tolF}</option>
            <option value="m">{tt.tolM}</option>
            <option value="c">{tt.tolC}</option>
            <option value="v">{tt.tolV}</option>
          </select>
          <label style={{ fontSize: 10, color: 'var(--nx-text-2)', whiteSpace: 'nowrap' }}>{tt.projection}</label>
          <select value={projection} onChange={e => setProjection(e.target.value as 'first' | 'third')}
            style={{ fontSize: 10, background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)', color: 'var(--nx-text)', borderRadius: 4, padding: '2px 4px' }}>
            <option value="first">{tt.firstAngle}</option>
            <option value="third">{tt.thirdAngle}</option>
          </select>
        </div>
      </div>
      {/* Drawing sheet */}
      <div style={{
        border: '2px solid var(--nx-border)', borderRadius: 4, background: '#ffffff',
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        maxWidth: '100%', overflow: 'auto',
      }}>
        <svg
          ref={svgRef}
          className="drawing-view-svg"
          viewBox={`0 0 ${DRAWING_W} ${DRAWING_H}`}
          width={DRAWING_W}
          height={DRAWING_H}
          style={{ display: 'block', background: '#ffffff' }}
        >
          {/* Drawing border */}
          <rect x={MARGIN / 2} y={MARGIN / 2} width={DRAWING_W - MARGIN} height={DRAWING_H - MARGIN}
            fill="none" stroke="#000" strokeWidth={1.5} />

          {/* Front / Top / Right — HLR 모드면 실투영 패널로 교체(ISO·치수는 표준 모드 유지) */}
          {hlrViews ? (
            <>
              <HlrViewPanel data={hlrViews.front} cx={frontCX} cy={frontCY} w={Math.max(frontW, 60)} h={Math.max(frontH, 60)} label={tt.frontKo} view="front" ext={hlrExt} unitSystem={unitSystem} />
              <HlrViewPanel data={hlrViews.top} cx={topCX} cy={topCY} w={Math.max(frontW, 60)} h={Math.max(topH, 60)} label={tt.topKo} view="top" ext={hlrExt} unitSystem={unitSystem} />
              <HlrViewPanel data={hlrViews.right} cx={rightCX} cy={rightCY} w={Math.max(rightW, 60)} h={Math.max(frontH, 60)} label={tt.rightKo} view="right" ext={hlrExt} unitSystem={unitSystem} />
              <text x={MARGIN} y={DRAWING_H - MARGIN / 2 - 6} fontSize={10} fill="#666">{tt.hlrOn}</text>
            </>
          ) : (
            <>
              <ViewBlock view={views[0]} ox={frontCX} oy={frontCY} scale={scale} bbox3D={bbox} unitSystem={unitSystem} />
              <ViewBlock view={views[1]} ox={topCX} oy={topCY} scale={scale} bbox3D={bbox} unitSystem={unitSystem} />
              <ViewBlock view={views[2]} ox={rightCX} oy={rightCY} scale={scale} bbox3D={bbox} unitSystem={unitSystem} />
            </>
          )}

          {/* Iso View */}
          <ViewBlock view={views[3]} ox={isoCX} oy={isoCY} scale={scale * 0.7} bbox3D={bbox} unitSystem={unitSystem} />

          {/* Projection alignment lines (thin dashed) */}
          <line x1={frontCX - frontW / 2 - 5} y1={frontCY - frontH / 2}
            x2={rightCX + rightW / 2 + 5} y2={frontCY - frontH / 2}
            stroke="#bbb" strokeWidth={0.25} strokeDasharray="3,2" />
          <line x1={frontCX - frontW / 2 - 5} y1={frontCY + frontH / 2}
            x2={rightCX + rightW / 2 + 5} y2={frontCY + frontH / 2}
            stroke="#bbb" strokeWidth={0.25} strokeDasharray="3,2" />
          <line x1={frontCX - frontW / 2} y1={topCY - topH / 2 - 5}
            x2={frontCX - frontW / 2} y2={frontCY + frontH / 2 + 5}
            stroke="#bbb" strokeWidth={0.25} strokeDasharray="3,2" />
          <line x1={frontCX + frontW / 2} y1={topCY - topH / 2 - 5}
            x2={frontCX + frontW / 2} y2={frontCY + frontH / 2 + 5}
            stroke="#bbb" strokeWidth={0.25} strokeDasharray="3,2" />

          {/* Title block (KS B ISO 7200) */}
          <TitleBlock
            x={DRAWING_W - MARGIN / 2 - TITLE_BLOCK_W}
            y={DRAWING_H - MARGIN / 2 - TITLE_BLOCK_H}
            w={TITLE_BLOCK_W} h={TITLE_BLOCK_H}
            partName={partName || tt.untitledPart}
            partNumber={partNumber || '-'}
            date={today}
            scale={scaleLabel}
            material={material || 'N/A'}
            drawnBy={drawnBy || '-'}
            company={company || 'NexyFab'}
            generalRoughness={roughness}
            toleranceClass={tolerance}
            projectionAngle={projection}
            tt={tt}
          />
        </svg>
      </div>
    </div>
  );
}
