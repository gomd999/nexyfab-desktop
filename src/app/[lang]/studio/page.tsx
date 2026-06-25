import type { Metadata } from 'next';
import StudioInner from './StudioInner';

export const metadata: Metadata = {
  title: 'NexyFab Studio — text/image → 3D',
  description: 'Describe or photograph a part and get a parametric 3D model you can tune with sliders, export as STL, or refine in the expert CAD modeler.',
};

export default function StudioPage() {
  return <StudioInner />;
}
