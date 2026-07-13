'use client';

/**
 * ChatCadViewer — 랜딩 챗의 인라인 3D 뷰어 (읽기전용).
 *
 * 렌더 소스 우선순위:
 *  1) stepBase64 — export-step(replicad/OCCT B-rep)의 STEP. occt-import-js(WASM,
 *     /occt-import-js.wasm on 'self')로 파싱 → 정확한 형상. CSP-safe.
 *  2) stlBase64  — openscad 계열 STL 메시.
 *  3) intent     — compose/scad-intent 의 프리미티브 근사(box/cylinder/sphere/…).
 * 모두 실패/부재 시 null → 부모가 안내 표시.
 *
 * three/R3F 는 SSR 불가라 부모(ChatHero)에서 next/dynamic ssr:false 로 로드.
 */

import React, { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Bounds, Center } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export interface CadIntent { shapeId: string; params: Record<string, number> }

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function primitiveGeometry(shapeId: string, p: Record<string, number>): THREE.BufferGeometry | null {
  const n = (k: string): number | undefined => (typeof p[k] === 'number' ? p[k] : undefined);
  const radius = (n('radius') ?? (n('diameter') !== undefined ? n('diameter')! / 2 : undefined)) ?? 20;
  switch (shapeId) {
    case 'box': case 'plate': case 'plateBend':
      return new THREE.BoxGeometry(n('width') ?? 50, n('height') ?? 50, n('depth') ?? n('thickness') ?? 50);
    case 'cylinder': case 'pipe':
      return new THREE.CylinderGeometry(radius, radius, n('height') ?? 50, 48);
    case 'sphere':
      return new THREE.SphereGeometry(radius, 40, 28);
    case 'cone':
      return new THREE.ConeGeometry(radius, n('height') ?? 50, 48);
    case 'torus':
      return new THREE.TorusGeometry(n('radius') ?? 30, n('tube') ?? Math.max(4, (n('radius') ?? 30) * 0.25), 24, 56);
    default:
      return null;
  }
}

/** occt-import-js STEP(텍스트) → BufferGeometry[] (메시별). ModelViewer.tsx 와 동일 로더. */
interface OcctMesh { attributes?: { position?: { array: number[] }; normal?: { array: number[] } }; index?: { array: number[] } }
async function stepToGeometries(stepText: string): Promise<THREE.BufferGeometry[]> {
  const occtimportjs = (await import('occt-import-js')).default as unknown as (opts: { locateFile: (p: string) => string }) => Promise<{ ReadStepFile: (buf: Uint8Array, cfg: unknown) => { success?: boolean; meshes?: OcctMesh[] } }>;
  const occt = await occtimportjs({ locateFile: (p: string) => (p.endsWith('.wasm') ? '/occt-import-js.wasm' : p) });
  const buf = new TextEncoder().encode(stepText);
  const result = occt.ReadStepFile(buf, null);
  const out: THREE.BufferGeometry[] = [];
  for (const m of result?.meshes ?? []) {
    if (!m.attributes?.position?.array || !m.index?.array) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(m.attributes.position.array), 3));
    if (m.attributes.normal?.array) geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(m.attributes.normal.array), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(m.index.array), 1));
    if (!m.attributes.normal?.array) geo.computeVertexNormals();
    out.push(geo);
  }
  return out;
}

export default function ChatCadViewer({ stepText, stlBase64, intent, accent = '#3b82f6', onReady }: {
  stepText?: string; stlBase64?: string; intent?: CadIntent | null; accent?: string;
  onReady?: (geometries: THREE.BufferGeometry[]) => void;
}) {
  const [geometries, setGeometries] = useState<THREE.BufferGeometry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setGeometries(null); setFailed(false);
    (async () => {
      try {
        if (stepText) {
          const gs = await stepToGeometries(stepText);
          if (alive) { if (gs.length) { setGeometries(gs); onReady?.(gs); } else setFailed(true); }
          return;
        }
        if (stlBase64) {
          const g = new STLLoader().parse(base64ToArrayBuffer(stlBase64));
          g.computeVertexNormals();
          if (alive) { setGeometries([g]); onReady?.([g]); }
          return;
        }
        if (intent) {
          const g = primitiveGeometry(intent.shapeId, intent.params || {});
          if (alive) { if (g) { setGeometries([g]); onReady?.([g]); } else setFailed(true); }
          return;
        }
        if (alive) setFailed(true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [stepText, stlBase64, intent]);

  if (failed) return null;

  return (
    <div style={{ width: '100%', height: 260, borderRadius: 10, overflow: 'hidden', background: '#0b1020', border: '1px solid rgba(255,255,255,0.08)', position: 'relative' }}>
      {!geometries && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 12 }}>3D…</div>
      )}
      {geometries && (
        <Canvas camera={{ position: [1.6, 1.2, 1.6], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true }}>
          <ambientLight intensity={0.65} />
          <directionalLight position={[4, 6, 3]} intensity={1.15} />
          <directionalLight position={[-3, -2, -4]} intensity={0.35} />
          <Bounds fit clip observe margin={1.25}>
            <Center>
              {geometries.map((g, i) => (
                <mesh key={i} geometry={g}>
                  <meshStandardMaterial color={accent} metalness={0.15} roughness={0.55} />
                </mesh>
              ))}
            </Center>
          </Bounds>
          <OrbitControls enablePan={false} enableDamping />
        </Canvas>
      )}
    </div>
  );
}
