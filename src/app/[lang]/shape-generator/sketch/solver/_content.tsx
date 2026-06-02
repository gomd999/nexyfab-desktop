'use client';

/**
 * Page-shell content split out from the Next.js page entry so tests can
 * mount it with a plain `lang` string instead of unwrapping the
 * `use(params)` Promise hook. Filename starts with `_` so Next.js
 * doesn't treat it as a route.
 */

import SolverSketchEditorWithExtrude from '../SolverSketchEditorWithExtrude';
import type { EditorLang } from '../SolverSketchEditor';

function normalizeLang(raw: string): EditorLang {
  if (raw === 'ko' || raw === 'en' || raw === 'ja' || raw === 'zh' || raw === 'es' || raw === 'ar') {
    return raw;
  }
  if (raw === 'cn') return 'zh';
  return 'en';
}

const HEADING_DICT: Record<EditorLang, { title: string; subtitle: string }> = {
  ko: { title: 'Solver Sketch + Extrude (베타)', subtitle: 'planegcs 솔버 기반 파라메트릭 스케치 + Extrude 3D 미리보기' },
  en: { title: 'Solver Sketch + Extrude (beta)', subtitle: 'planegcs-backed parametric sketch with Extrude 3D preview' },
  ja: { title: 'Solver Sketch + Extrude (ベータ)', subtitle: 'planegcsソルバーベースのパラメトリックスケッチ + 押し出し3Dプレビュー' },
  zh: { title: 'Solver Sketch + Extrude (测试版)', subtitle: 'planegcs求解器参数化草图 + 拉伸3D预览' },
  es: { title: 'Solver Sketch + Extrude (beta)', subtitle: 'Boceto paramétrico con solver planegcs + vista previa 3D' },
  ar: { title: 'Solver Sketch + Extrude (تجريبي)', subtitle: 'رسم بارامتري مع محلل planegcs + معاينة 3D' },
};

export function SolverSketchPageContent({ lang }: { lang: string }): React.ReactElement {
  const editorLang = normalizeLang(lang);
  const heading = HEADING_DICT[editorLang];
  return (
    <main style={{ padding: 24, minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <header>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{heading.title}</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>{heading.subtitle}</p>
        </header>
        <SolverSketchEditorWithExtrude lang={editorLang} />
      </div>
    </main>
  );
}
