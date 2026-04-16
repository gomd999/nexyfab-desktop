'use client';

import { useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';

interface PerfMonitorProps {
  visible: boolean;
}

export default function PerfMonitor({ visible }: PerfMonitorProps) {
  const { gl } = useThree();
  const timesRef = useRef<number[]>([]);
  const [fps, setFps] = useState(0);
  const [triangles, setTriangles] = useState(0);
  const [calls, setCalls] = useState(0);
  const [textures, setTextures] = useState(0);
  const [geometries, setGeometries] = useState(0);
  const frameCountRef = useRef(0);

  useFrame(() => {
    if (!visible) return;

    const now = performance.now();
    const times = timesRef.current;
    times.push(now);
    // Keep last 60 frame timestamps
    if (times.length > 60) times.shift();

    frameCountRef.current++;
    // Update display every 10 frames to avoid excessive re-renders
    if (frameCountRef.current % 10 !== 0) return;

    if (times.length >= 2) {
      const elapsed = times[times.length - 1] - times[0];
      const avgFps = ((times.length - 1) / elapsed) * 1000;
      setFps(Math.round(avgFps));
    }

    const info = gl.info;
    setTriangles(info.render.triangles);
    setCalls(info.render.calls);
    if (info.memory) {
      setTextures(info.memory.textures);
      setGeometries(info.memory.geometries);
    }
  });

  if (!visible) return null;

  const fpsColor = fps > 50 ? '#3fb950' : fps >= 30 ? '#d29922' : '#f85149';

  const formatTris = (n: number): string => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
  };

  return (
    <Html
      center={false}
      style={{
        position: 'fixed',
        bottom: '40px',
        right: '10px',
        pointerEvents: 'none',
        zIndex: 50,
      }}
      calculatePosition={() => [0, 0, 0]}
    >
      <div
        style={{
          position: 'fixed',
          bottom: '40px',
          right: '10px',
          background: 'rgba(13,17,23,0.8)',
          borderRadius: '8px',
          padding: '6px 10px',
          fontFamily: 'monospace',
          fontSize: '10px',
          lineHeight: '16px',
          color: '#8b949e',
          pointerEvents: 'none',
          userSelect: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: '1px',
          border: '1px solid rgba(48,54,61,0.6)',
          backdropFilter: 'blur(4px)',
        }}
      >
        <span>
          <span style={{ color: fpsColor, fontWeight: 700 }}>{fps}</span> FPS
        </span>
        <span>{formatTris(triangles)} tris</span>
        <span>{calls} draws</span>
        <span>{geometries} geo / {textures} tex</span>
      </div>
    </Html>
  );
}
