'use client';

import { useEffect, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { WebGLPathTracer } from 'three-gpu-pathtracer';

const MAX_SAMPLES = 256;

interface PathTracerProps {
  enabled: boolean;
  bounces?: number;
  onProgress?: (samples: number, max: number) => void;
}

export default function PathTracer({ enabled, bounces = 6, onProgress }: PathTracerProps) {
  const { gl, scene, camera } = useThree();
  const ptRef = useRef<WebGLPathTracer | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      ptRef.current?.dispose?.();
      ptRef.current = null;
      setReady(false);
      return;
    }

    const pt = new WebGLPathTracer(gl);
    pt.setBVHWorker?.({} as any); // optional BVH worker
    pt.bounces = bounces;
    pt.filterGlossyFactor = 0.5;
    pt.multipleImportanceSampling = true;
    pt.dynamicLowRes = true;
    pt.lowResScale = 0.25;

    try {
      const result = (pt.setScene as (s: typeof scene, c: typeof camera) => unknown)(scene, camera);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(() => {
          ptRef.current = pt;
          setReady(true);
        }).catch((e: unknown) => {
          console.warn('[PathTracer] setScene failed:', e);
        });
      } else {
        ptRef.current = pt;
        setReady(true);
      }
    } catch (e) {
      console.warn('[PathTracer] setScene failed:', e);
    }

    return () => {
      pt.dispose?.();
      ptRef.current = null;
      setReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, gl]);

  // Update camera / scene on changes
  useEffect(() => {
    if (!ptRef.current || !ready) return;
    ptRef.current.updateCamera();
  });

  useFrame(() => {
    const pt = ptRef.current;
    if (!pt || !enabled || !ready) return;
    if (pt.samples >= MAX_SAMPLES) return;

    pt.renderSample();
    onProgress?.(pt.samples, MAX_SAMPLES);
  });

  return null;
}

export function PathTracerHUD({ samples, max, isKo }: { samples: number; max: number; isKo: boolean }) {
  const pct = Math.round((samples / max) * 100);
  return (
    <div style={{
      position: 'absolute', bottom: 48, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(13,17,23,0.85)', border: '1px solid #30363d',
      borderRadius: 8, padding: '5px 14px', color: '#c9d1d9', fontSize: 11,
      fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 8,
      backdropFilter: 'blur(4px)', zIndex: 300, pointerEvents: 'none', whiteSpace: 'nowrap',
    }}>
      <span style={{ color: '#388bfd' }}>◉</span>
      {isKo ? `Path Tracing: ${samples}/${max} (${pct}%)` : `Path Tracing: ${samples}/${max} samples (${pct}%)`}
      {samples >= max && <span style={{ color: '#3fb950', marginLeft: 4 }}>✓ {isKo ? '완료' : 'Done'}</span>}
    </div>
  );
}
