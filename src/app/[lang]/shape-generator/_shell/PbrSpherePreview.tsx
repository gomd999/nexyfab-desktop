'use client';

// Real WebGL2 PBR sphere preview that live-reacts to the material library +
// PBR sliders + HDRI environment. Replaces the static SVG placeholder so the
// Render route actually behaves like the mockup #18 "Live PBR preview" chip.
// Loaded dynamically so it stays out of the modeler's main bundle.

import React from 'react';
import dynamic from 'next/dynamic';

interface PbrProps {
  color: string;
  roughness: number;
  metalness: number;
  exposure: number;
  hdri: string;
  projectId?: string;
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

// Error boundary so a WebGL / HDRI load failure inside the canvas doesn't
// take down the whole Render route (and trigger shape-generator/error.tsx).
// We instead fall back to a static gradient sphere — the route stays usable.
class PbrErrorBoundary extends React.Component<
  { color: string; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { color: string; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.warn('PBR sphere render failed; using SVG fallback', error);
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return <PbrFallback color={this.props.color} />;
  }
}

function PbrFallback({ color }: { color: string }) {
  const stop1 = color.startsWith('var(') || color.startsWith('rgb') ? '#cccccc' : color;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg viewBox="-100 -100 200 200" width="60%" height="60%" style={{ filter: 'drop-shadow(0 12px 32px rgba(0,0,0,0.45))' }}>
        <defs>
          <radialGradient id="pbr-fallback-grad" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor={stop1} />
            <stop offset="100%" stopColor="#222" />
          </radialGradient>
        </defs>
        <circle cx="0" cy="0" r="72" fill="url(#pbr-fallback-grad)" />
        <ellipse cx="-22" cy="-26" rx="22" ry="10" fill="rgba(255,255,255,0.3)" />
      </svg>
    </div>
  );
}

export function PbrSpherePreview(props: PbrProps) {
  return (
    <PbrErrorBoundary color={props.color}>
      <PbrSphereImpl {...props} />
    </PbrErrorBoundary>
  );
}
