'use client';

// Real WebGL2 PBR sphere preview that live-reacts to the material library +
// PBR sliders + HDRI environment. Replaces the static SVG placeholder so the
// Render route actually behaves like the mockup #18 "Live PBR preview" chip.
// Loaded dynamically so it stays out of the modeler's main bundle.

import dynamic from 'next/dynamic';

interface PbrProps {
  color: string;
  roughness: number;
  metalness: number;
  exposure: number;
  hdri: string;
}

// SSR-disabled because @react-three/fiber needs WebGL2.
const PbrSphereImpl = dynamic(() => import('./PbrSphereImpl').then(m => m.PbrSphereImpl), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--nx-text-3)',
        fontSize: 12,
      }}
    >
      Loading PBR…
    </div>
  ),
});

export function PbrSpherePreview(props: PbrProps) {
  return <PbrSphereImpl {...props} />;
}
