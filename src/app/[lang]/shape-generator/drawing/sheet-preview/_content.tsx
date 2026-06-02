'use client';

/**
 * Page-shell content split out from the Next.js page entry so tests can
 * mount it with a plain `lang` string instead of unwrapping the
 * `use(params)` Promise hook. Filename starts with `_` so Next.js
 * doesn't treat it as a route.
 *
 * Builds a demo Sheet IR (A3, four standard views + a section + a detail
 * view) and renders it via SheetRenderer. Phase-1 viewport contents are
 * intentionally empty rectangles — the OCCT HLR projection wires in at
 * Phase 2.
 */

import { useMemo } from 'react';
import {
  standardThreeViewSheet,
  type Sheet,
  type Viewport,
} from '@/lib/drawing/sheet';
import { SheetRenderer } from '../SheetRenderer';

function buildDemoSheet(): Sheet {
  const base = standardThreeViewSheet({
    id: 'demo-sheet-1',
    name: 'Demo Sheet — SheetRenderer Phase 1',
    sourceId: 'demo-part-1',
    paperSize: 'A3',
    scale: 1,
  });
  // Tack on a section view + a detail view (sourced from FRONT) to exercise
  // the section-arrow and detail-circle adornments. Coordinates picked to
  // fit inside A3 (420 × 297 mm) without overlapping the standard views.
  const sectionVp: Viewport = {
    id: 'section-A',
    sourceId: 'demo-part-1',
    projection: { kind: 'section', cuttingPlaneId: 'A' },
    centerOnSheet: { x: 210, y: 150 },
    widthOnSheet: 80,
    scale: 1,
    label: 'SECTION A-A',
  };
  const detailVp: Viewport = {
    id: 'detail-B',
    sourceId: 'demo-part-1',
    projection: {
      kind: 'detail',
      sourceViewportId: 'front',
      center: { x: 0, y: 0 },
      radius: 10,
      scaleFactor: 2,
    },
    centerOnSheet: { x: 360, y: 80 },
    widthOnSheet: 60,
    scale: 2,
    label: 'DETAIL B (2:1)',
  };
  return {
    ...base,
    viewports: [...base.viewports, sectionVp, detailVp],
  };
}

const HEADING_DICT: Record<string, { title: string; subtitle: string }> = {
  ko: {
    title: '도면 시트 미리보기 (Phase 1)',
    subtitle: 'Sheet IR → SVG 렌더링. 뷰포트 콘텐츠는 Phase 2에서 OCCT HLR 연결',
  },
  en: {
    title: 'Drawing Sheet Preview (Phase 1)',
    subtitle: 'Sheet IR → SVG render. Viewport contents wire in at Phase 2 (OCCT HLR)',
  },
  ja: {
    title: '図面シートプレビュー (Phase 1)',
    subtitle: 'Sheet IR → SVGレンダリング。ビューポート内容はPhase 2でOCCT HLR接続',
  },
  zh: {
    title: '图纸预览 (Phase 1)',
    subtitle: 'Sheet IR → SVG渲染。视口内容将在Phase 2接入OCCT HLR',
  },
};

function pickHeading(lang: string): { title: string; subtitle: string } {
  const key = lang === 'cn' ? 'zh' : lang;
  return HEADING_DICT[key] ?? HEADING_DICT.en;
}

export function SheetPreviewPageContent({ lang }: { lang: string }): React.ReactElement {
  const sheet = useMemo(() => buildDemoSheet(), []);
  const heading = pickHeading(lang);
  return (
    <main
      style={{
        padding: 24,
        minHeight: '100vh',
        background: '#f3f4f6',
        fontFamily: 'system-ui, sans-serif',
      }}
      data-testid="sheet-preview-page-root"
    >
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <header>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{heading.title}</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>{heading.subtitle}</p>
        </header>
        <div
          style={{
            background: '#e5e7eb',
            padding: 12,
            borderRadius: 6,
            overflow: 'auto',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <SheetRenderer sheet={sheet} />
        </div>
      </div>
    </main>
  );
}
