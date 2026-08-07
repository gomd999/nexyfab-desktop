'use client';

import { useRef, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { LOCAL_LABELS } from './constants/labels';
import { getSuppressCadPerfToasts, setSuppressCadPerfToasts } from '@/lib/cadPerfHints';
import {
  evaluateViewportPerformance,
  percentile95,
  type ViewportPerformanceSnapshot,
} from '@/lib/viewportPerformance';
import * as THREE from 'three';

function collectSceneRenderStats(scene: THREE.Scene): { triangles: number; drawCalls: number } {
  let triangles = 0;
  let drawCalls = 0;
  scene.traverse((object) => {
    if (!object.visible || !(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    const elementCount = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
    triangles += Math.floor(elementCount / 3);
    drawCalls += Math.max(1, geometry.groups.length);
  });
  return { triangles, drawCalls };
}

function resolveLabelsLang(routeLang?: string): keyof typeof LOCAL_LABELS {
  if (!routeLang) return 'en';
  if (routeLang === 'zh') return 'cn';
  if (routeLang === 'kr') return 'ko';
  const k = routeLang as keyof typeof LOCAL_LABELS;
  if (k in LOCAL_LABELS) return k;
  return 'en';
}

interface PerfMonitorProps {
  visible: boolean;
  /** Locale key for LOCAL_LABELS (ko, en, ja, cn, es, ar). */
  lang?: string;
}

export default function PerfMonitor({ visible, lang = 'en' }: PerfMonitorProps) {
  const { gl, scene, invalidate } = useThree();
  const timesRef = useRef<number[]>([]);
  const [fps, setFps] = useState(0);
  const [triangles, setTriangles] = useState(0);
  const [calls, setCalls] = useState(0);
  const [textures, setTextures] = useState(0);
  const [geometries, setGeometries] = useState(0);
  const [frameTimeP95Ms, setFrameTimeP95Ms] = useState(0);
  const [budgetPassed, setBudgetPassed] = useState(true);
  const [complexityTier, setComplexityTier] = useState<'S' | 'M' | 'L' | 'XL'>('S');
  const frameCountRef = useRef(0);
  const lt = LOCAL_LABELS[resolveLabelsLang(lang)];
  const [suppressLoadToasts, setSuppressLoadToastsState] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSuppressLoadToastsState(getSuppressCadPerfToasts());
  }, [visible]);

  useFrame(() => {
    if (!visible) return;
    // The viewport normally renders on demand. A performance sample must run
    // continuously or idle gaps are incorrectly reported as multi-second frames.
    invalidate();

    const now = performance.now();
    const times = timesRef.current;
    times.push(now);
    if (times.length > 60) times.shift();

    frameCountRef.current++;
    if (frameCountRef.current % 10 !== 0) return;

    if (times.length >= 2) {
      const elapsed = times[times.length - 1] - times[0];
      const avgFps = ((times.length - 1) / elapsed) * 1000;
      setFps(Math.round(avgFps));
      const frameTimes = times.slice(1).map((time, index) => time - times[index]!);
      setFrameTimeP95Ms(Number(percentile95(frameTimes).toFixed(1)));
    }

    const info = gl.info;
    const sceneStats = collectSceneRenderStats(scene);
    setTriangles(sceneStats.triangles);
    setCalls(Math.max(info.render.calls, sceneStats.drawCalls));
    if (info.memory) {
      setTextures(info.memory.textures);
      setGeometries(info.memory.geometries);
    }

    if (frameCountRef.current % 60 === 0 && times.length >= 2) {
      const frameTimes = times.slice(1).map((time, index) => time - times[index]!);
      const elapsed = times[times.length - 1]! - times[0]!;
      const snapshot: ViewportPerformanceSnapshot = {
        sampledAt: Date.now(),
        fps: Math.round(((times.length - 1) / elapsed) * 1000),
        frameTimeP95Ms: Number(percentile95(frameTimes).toFixed(1)),
        triangles: sceneStats.triangles,
        drawCalls: Math.max(info.render.calls, sceneStats.drawCalls),
        geometries: info.memory?.geometries ?? 0,
        textures: info.memory?.textures ?? 0,
      };
      const verdict = evaluateViewportPerformance(snapshot);
      setBudgetPassed(verdict.passed);
      setComplexityTier(verdict.tier);
      window.dispatchEvent(new CustomEvent('nexyfab:viewport-performance', { detail: { snapshot, verdict } }));
    }
  });

  if (!visible) return null;

  const fpsColor = fps > 50 ? 'var(--nx-ok)' : fps >= 30 ? 'var(--nx-warn)' : 'var(--nx-error)';

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
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
        }}
      >
        <label
          style={{
            pointerEvents: 'auto',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            maxWidth: 280,
            margin: 0,
            padding: '8px 10px',
            background: 'rgba(22,27,34,0.95)',
            borderRadius: '8px',
            border: '1px solid rgba(48,54,61,0.8)',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '11px',
            lineHeight: 1.35,
            color: 'var(--nx-text)',
          }}
        >
          <input
            type="checkbox"
            checked={suppressLoadToasts}
            onChange={(e) => {
              const v = e.target.checked;
              setSuppressCadPerfToasts(v);
              setSuppressLoadToastsState(v);
            }}
            style={{ marginTop: 2, flexShrink: 0 }}
          />
          <span>{lt.perfSuppressLoadToasts}</span>
        </label>
        <div
          data-testid="viewport-performance"
          data-complexity-tier={complexityTier}
          data-budget-status={budgetPassed ? 'passed' : 'failed'}
          data-fps={fps}
          data-frame-p95-ms={frameTimeP95Ms}
          data-triangles={triangles}
          data-draw-calls={calls}
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
            background: 'rgba(13,17,23,0.8)',
            borderRadius: '8px',
            padding: '6px 10px',
            fontFamily: 'monospace',
            fontSize: '10px',
            lineHeight: '16px',
            color: 'var(--nx-text-2)',
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
          <span>{complexityTier} · p95 {frameTimeP95Ms}ms · {budgetPassed ? 'PASS' : 'OVER'}</span>
        </div>
      </div>
    </Html>
  );
}
