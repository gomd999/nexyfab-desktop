'use client';

/**
 * Drawing → SheetRenderer demo route.
 *
 * Route: /[lang]/shape-generator/drawing/sheet-preview/
 *
 * Why this lives at /drawing/sheet-preview/ rather than /drawing/:
 *   The existing /drawing/ route already hosts the shell-v2 DrawingFrame
 *   (Phase 3 drafting shell — see ../page.tsx). To avoid silently breaking
 *   that route while the Phase 4 Drawing UI track is bootstrapped, the
 *   SheetRenderer demo gets its own sub-route. Once the SheetRenderer is
 *   ready to replace the legacy frame, this can be promoted to /drawing/.
 *
 * Mounts SheetRenderer with a demo Sheet built from standardThreeViewSheet
 * (A3 paper, front/top/right/iso) plus two extra viewports demonstrating
 * the section and detail projection adornments.
 */

import { use } from 'react';
import { SheetPreviewPageContent } from './_content';

interface PageProps {
  params: Promise<{ lang: string }>;
}

export default function DrawingSheetPreviewPage({ params }: PageProps): React.ReactElement {
  const { lang } = use(params);
  return <SheetPreviewPageContent lang={lang} />;
}
