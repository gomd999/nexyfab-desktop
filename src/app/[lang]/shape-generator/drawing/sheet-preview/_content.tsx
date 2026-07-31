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
 *
 * Phase 4.2 demo: an "Add annotation" button opens DimensionAnnotationModal;
 * the result is spliced into the sheet's dimensions / gdtCallouts so it
 * renders immediately.
 */

import { useMemo, useState } from 'react';
import {
  standardThreeViewSheet,
  type Sheet,
  type Viewport,
} from '@/lib/drawing/sheet';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';
import { SheetRenderer } from '../SheetRenderer';
import DimensionAnnotationModal, { type DrawingAnnotation } from '../DimensionAnnotationModal';

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

const HEADING_DICT: Record<string, { title: string; subtitle: string; addAnnotation: string }> = {
  ko: {
    title: '도면 시트 미리보기 (Phase 1)',
    subtitle: 'Sheet IR → SVG 렌더링. 뷰포트 콘텐츠는 Phase 2에서 OCCT HLR 연결',
    addAnnotation: '주석 추가',
  },
  en: {
    title: 'Drawing Sheet Preview (Phase 1)',
    subtitle: 'Sheet IR → SVG render. Viewport contents wire in at Phase 2 (OCCT HLR)',
    addAnnotation: 'Add annotation',
  },
  ja: {
    title: '図面シートプレビュー (Phase 1)',
    subtitle: 'Sheet IR → SVGレンダリング。ビューポート内容はPhase 2でOCCT HLR接続',
    addAnnotation: '注釈を追加',
  },
  zh: {
    title: '图纸预览 (Phase 1)',
    subtitle: 'Sheet IR → SVG渲染。视口内容将在Phase 2接入OCCT HLR',
    addAnnotation: '添加注释',
  },
  es: {
    title: 'Vista previa de la hoja de plano (Fase 1)',
    subtitle: 'Sheet IR → render SVG. El contenido de la ventana gráfica se conecta en la Fase 2 (OCCT HLR)',
    addAnnotation: 'Añadir anotación',
  },
  ar: {
    title: 'معاينة ورقة الرسم (المرحلة ١)',
    subtitle: 'Sheet IR ← عرض SVG. يُربط محتوى منفذ العرض في المرحلة ٢ (OCCT HLR)',
    addAnnotation: 'إضافة تعليق',
  },
};

function pickHeading(lang: string): { title: string; subtitle: string; addAnnotation: string } {
  const key = lang === 'cn' ? 'zh' : lang;
  return HEADING_DICT[key] ?? HEADING_DICT.en;
}

function isDimension(a: DrawingAnnotation): a is Dimension {
  return 'kind' in a && (
    a.kind === 'linear' || a.kind === 'aligned' || a.kind === 'radial'
    || a.kind === 'diametric' || a.kind === 'angular'
  );
}

export function SheetPreviewPageContent({ lang }: { lang: string }): React.ReactElement {
  const [sheet, setSheet] = useState<Sheet>(() => buildDemoSheet());
  const [modalOpen, setModalOpen] = useState(false);
  const heading = pickHeading(lang);
  const firstViewportId = useMemo(() => sheet.viewports[0]?.id ?? '', [sheet.viewports]);

  function handleAdd(annotation: DrawingAnnotation): void {
    setSheet((prev) => {
      if (isDimension(annotation)) {
        return {
          ...prev,
          dimensions: [...(prev.dimensions ?? []), annotation],
        };
      }
      // W4-D — same routing as the production drawing page.
      if ('weldType' in annotation) {
        return { ...prev, weldSymbols: [...(prev.weldSymbols ?? []), annotation] };
      }
      if ('toleranceValue' in annotation) {
        return { ...prev, gdtCallouts: [...(prev.gdtCallouts ?? []), annotation] };
      }
      return {
        ...prev,
        surfaceFinishSymbols: [...(prev.surfaceFinishSymbols ?? []), annotation],
      };
    });
    setModalOpen(false);
  }

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
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{heading.title}</h1>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>{heading.subtitle}</p>
          </div>
          <button
            type="button"
            data-testid="sheet-preview-add-annotation"
            onClick={() => setModalOpen(true)}
            disabled={!firstViewportId}
            style={{
              padding: '8px 14px',
              background: '#1d4ed8',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {heading.addAnnotation}
          </button>
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
      {modalOpen && firstViewportId ? (
        <DimensionAnnotationModal
          lang={lang}
          sheet={sheet}
          viewportId={firstViewportId}
          onAdd={handleAdd}
          onClose={() => setModalOpen(false)}
        />
      ) : null}
    </main>
  );
}
