'use client';

/**
 * Drawing → production entry (Phase 4.4 Drawing UI track).
 *
 * Route: /[lang]/shape-generator/drawing/
 *
 * This is the production-grade drawing page that promotes the SheetRenderer
 * stack out of the /sheet-preview demo route. It builds a standard 3-view
 * sheet (front / top / right / iso) from a selected sample part, lets the
 * user adjust paper size + scale, and exposes the DimensionAnnotationModal
 * for authoring dimensions + GD&T callouts. Export buttons emit PNG (via
 * SVG → canvas rasterisation) and JSON (sheet IR dump).
 *
 * The /sheet-preview/ demo route is preserved verbatim for regression
 * snapshots.
 */

import { use } from 'react';
import { DrawingPageContent } from './_content';

interface PageProps {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{
    handoff?: string | string[];
    project?: string | string[];
    storage?: string | string[];
  }>;
}

export default function DrawingPage({ params, searchParams }: PageProps): React.ReactElement {
  const { lang } = use(params);
  const query = use(searchParams);
  const handoffId = typeof query.handoff === 'string' ? query.handoff : undefined;
  const handoffProjectId = typeof query.project === 'string' ? query.project : undefined;
  const handoffStorage = query.storage === 'server' ? 'server' as const : 'session' as const;
  return (
    <DrawingPageContent
      lang={lang}
      {...(handoffId ? { handoffId, handoffStorage } : {})}
      {...(handoffProjectId ? { handoffProjectId } : {})}
    />
  );
}
