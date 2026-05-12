'use client';

import dynamic from 'next/dynamic';
import { WorkspaceLoading } from './WorkspaceLoading';

const ShapeGeneratorApp = dynamic(() => import('./ShapeGeneratorApp'), {
  ssr: false,
  loading: () => <WorkspaceLoading variant="page" />,
});

/** Shared entry for `/shape-generator` and focused sub-routes (sketch / 3d-edit / analysis). */
export default function ShapeGeneratorClientPage() {
  return <ShapeGeneratorApp />;
}
