'use client';

import dynamic from 'next/dynamic';
import { WorkspaceLoading } from './WorkspaceLoading';

const ShapeGeneratorApp = dynamic(() => import('./ShapeGeneratorApp'), {
  ssr: false,
  loading: () => <WorkspaceLoading variant="page" />,
});

export default function ShapeGeneratorPage() {
  return <ShapeGeneratorApp />;
}
