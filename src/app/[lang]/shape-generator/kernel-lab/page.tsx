'use client';

/**
 * K-series Kernel Lab — the first in-app consumer of the K-series kernel-CEILING
 * ops (the ones replicad can't do). Standalone + self-contained on purpose: it
 * exercises the real opencascade.js worker (spawned in the production bundle,
 * 65 MB WASM) through the `thickenSurfaceKSeries` feature core and renders the
 * resulting solid — WITHOUT touching the parametric feature tree / preview, so
 * it can't desync the modeler. Route: /[lang]/shape-generator/kernel-lab
 *
 * This is the proof that the kernel-ceiling path works end-to-end in the
 * shipped app (not just headless tests / the e2e harness). The full in-modeler
 * "Thicken" feature (scene-body insertion, profile-from-sketch) builds on this.
 */
import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { ShapeResult } from '../shapes';
import { thickenSurfaceKSeries } from '../features/thickenKSeries';

// A 10×10 demo square sheet; thicken by 2 → a 10×10×2 slab (volume 200 mm³).
const DEMO_SQUARE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

type Phase = 'idle' | 'running' | 'done' | 'error';

export default function KernelLabPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [thickness, setThickness] = useState(2);
  const [result, setResult] = useState<ShapeResult | null>(null);
  const [message, setMessage] = useState('');

  const run = async () => {
    setPhase('running');
    setMessage('Booting OCCT worker + thickening…');
    setResult(null);
    const out = await thickenSurfaceKSeries({ loop: DEMO_SQUARE, thickness });
    if (out.ok) {
      setResult(out.result);
      setPhase('done');
      setMessage('');
    } else {
      setPhase('error');
      setMessage(out.error);
    }
  };

  const triCount = result ? result.geometry.getAttribute('position').count / 3 : 0;

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#0f172a', maxWidth: 720 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>K-series Kernel Lab</h1>
      <p style={{ fontSize: 13, color: '#475569', marginBottom: 16 }}>
        Thicken a flat surface into a solid via the real OpenCascade (K-series) worker — a
        kernel-ceiling op replicad cannot do. Runs in this page&apos;s own Web Worker; the
        parametric modeler is untouched.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>
          Thickness (mm)
          <input
            data-testid="kernel-lab-thickness"
            type="number"
            min={0.1}
            step={0.1}
            value={thickness}
            onChange={(e) => setThickness(parseFloat(e.target.value) || 0)}
            style={{ marginLeft: 8, width: 70, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4 }}
          />
        </label>
        <button
          data-testid="kernel-lab-thicken"
          onClick={run}
          disabled={phase === 'running'}
          style={{
            padding: '8px 14px', borderRadius: 6, border: '1px solid #2563eb',
            background: phase === 'running' ? '#93c5fd' : '#2563eb', color: '#fff',
            fontSize: 13, fontWeight: 700, cursor: phase === 'running' ? 'wait' : 'pointer',
          }}
        >
          {phase === 'running' ? 'Working…' : 'Thicken 10×10 demo surface'}
        </button>
      </div>

      <div data-testid="kernel-lab-status" data-phase={phase} style={{ fontSize: 13, marginBottom: 12 }}>
        {phase === 'idle' && 'Ready.'}
        {phase === 'running' && message}
        {phase === 'error' && <span style={{ color: '#dc2626' }}>Error: {message}</span>}
        {phase === 'done' && result && (
          <span data-testid="kernel-lab-result" style={{ color: '#16a34a', fontWeight: 600 }}>
            ✓ Solid generated — volume {result.volume_cm3.toFixed(3)} cm³ ({(result.volume_cm3 * 1000).toFixed(1)} mm³),
            {' '}{triCount} triangles, bbox {result.bbox.w.toFixed(1)}×{result.bbox.h.toFixed(1)}×{result.bbox.d.toFixed(1)} mm
          </span>
        )}
      </div>

      {result && (
        <div style={{ width: '100%', height: 360, border: '1px solid #e2e8f0', borderRadius: 8, background: '#0b1220' }}>
          <Canvas camera={{ position: [25, 20, 25], fov: 45 }}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 20, 10]} intensity={1.2} />
            <mesh geometry={result.geometry}>
              <meshStandardMaterial color="#58a6ff" roughness={0.4} metalness={0.1} />
            </mesh>
            <lineSegments geometry={result.edgeGeometry}>
              <lineBasicMaterial color="#cbd5e1" />
            </lineSegments>
            <OrbitControls />
          </Canvas>
        </div>
      )}
    </div>
  );
}
