'use client';

/**
 * Direct preview route for the lite SketchEditor sibling.
 * Accessible at /[lang]/shape-generator/sketch/editor.
 *
 * The legacy `sketch/page.tsx` continues to serve the production
 * ShapeGeneratorClientPage (with the full 3,470-line SketchCanvas);
 * this route is isolated so the lite editor can be evaluated without
 * dragging in the rest of the shape-generator shell.
 */

import { use } from 'react';
import SketchEditor, { type EditorLang } from '../SketchEditor';

interface PageProps {
  params: Promise<{ lang: string }>;
}

function normalizeLang(raw: string): EditorLang {
  if (raw === 'ko' || raw === 'en' || raw === 'ja' || raw === 'zh' || raw === 'es' || raw === 'ar') {
    return raw;
  }
  // 'cn' alias used elsewhere → zh; fall back to en otherwise.
  if (raw === 'cn') return 'zh';
  return 'en';
}

export default function SketchEditorPreviewPage({ params }: PageProps): React.ReactElement {
  const { lang } = use(params);
  return (
    <main style={{ padding: 24, minHeight: '100vh', background: '#f3f4f6' }}>
      <SketchEditor lang={normalizeLang(lang)} />
    </main>
  );
}
