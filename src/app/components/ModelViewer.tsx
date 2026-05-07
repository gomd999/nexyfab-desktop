'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type DisplayMode = 'solid' | 'edges' | 'wireframe';

interface ModelStats {
  vertices: number;
  triangles: number;
  bbox: { w: number; h: number; d: number };
  center: THREE.Vector3;
  bottomY: number;
}

interface ModelViewerProps {
  url: string;
  filename: string;
  onClose: () => void;
}

// ─── Camera util ──────────────────────────────────────────────────────────────

function fitCamera(camera: THREE.Camera, box: THREE.Box3): THREE.Vector3 {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
  const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.9;
  camera.position.set(center.x + dist * 0.7, center.y + dist * 0.55, center.z + dist * 0.7);
  camera.lookAt(center);
  (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  return center;
}

// ─── STEP model ───────────────────────────────────────────────────────────────

function STEPModel({
  url, displayMode, fitKey, onLoad, onError,
}: {
  url: string;
  displayMode: DisplayMode;
  fitKey: number;
  onLoad: (s: ModelStats) => void;
  onError: (e: Error) => void;
}) {
  const [geos, setGeos] = useState<THREE.BufferGeometry[]>([]);
  const [edgeGeos, setEdgeGeos] = useState<THREE.BufferGeometry[]>([]);
  const [box, setBox] = useState<THREE.Box3 | null>(null);
  const { camera } = useThree();

  useEffect(() => {
    if (!box || box.isEmpty()) return;
    fitCamera(camera, box);
  }, [box, camera, fitKey]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const occtimportjs = (await import('occt-import-js')).default;
      const occt = await occtimportjs({
        locateFile: (p: string) => p.endsWith('.wasm') ? '/occt-import-js.wasm' : p,
      });
      const response = await fetch(url);
      const fileBuffer = new Uint8Array(await response.arrayBuffer());
      const result = occt.ReadStepFile(fileBuffer, null);

      if (!result?.meshes?.length) throw new Error('STEP 파일에서 메시를 찾을 수 없습니다.');

      const built: THREE.BufferGeometry[] = [];
      const edges: THREE.BufferGeometry[] = [];
      const combined = new THREE.Box3();
      let verts = 0, tris = 0;

      for (const mesh of result.meshes as any[]) {
        if (!mesh.attributes?.position?.array || !mesh.index?.array) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(mesh.attributes.position.array), 3));
        if (mesh.attributes.normal?.array)
          geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(mesh.attributes.normal.array), 3));
        geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.index.array), 1));
        geo.computeBoundingBox();
        geo.computeVertexNormals();
        if (geo.boundingBox) combined.union(geo.boundingBox);
        verts += geo.attributes.position.count;
        tris += geo.index ? geo.index.count / 3 : 0;
        built.push(geo);
        edges.push(new THREE.EdgesGeometry(geo, 20));
      }

      if (!built.length) throw new Error('렌더링 가능한 메시가 없습니다.');

      const size = combined.getSize(new THREE.Vector3());
      const center = combined.getCenter(new THREE.Vector3());

      if (!cancelled) {
        setGeos(built);
        setEdgeGeos(edges);
        setBox(combined);
        onLoad({
          vertices: verts,
          triangles: Math.round(tris),
          bbox: { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) },
          center,
          bottomY: combined.min.y,
        });
      }
    }
    load().catch(e => { if (!cancelled) onError(e instanceof Error ? e : new Error(String(e))); });
    return () => { cancelled = true; };
  }, [url, onLoad, onError]);

  const solidColor = '#8b9cf4';
  return (
    <group>
      {geos.map((geo, i) => (
        <group key={i}>
          {displayMode !== 'wireframe' && (
            <mesh geometry={geo} castShadow receiveShadow>
              <meshStandardMaterial color={solidColor} roughness={0.35} metalness={0.4} side={THREE.DoubleSide} />
            </mesh>
          )}
          {displayMode === 'wireframe' && (
            <mesh geometry={geo}>
              <meshBasicMaterial color="#22d3ee" wireframe />
            </mesh>
          )}
          {(displayMode === 'edges') && edgeGeos[i] && (
            <lineSegments geometry={edgeGeos[i]}>
              <lineBasicMaterial color="#60a5fa" />
            </lineSegments>
          )}
        </group>
      ))}
    </group>
  );
}

// ─── STL model ────────────────────────────────────────────────────────────────

function STLScene({
  url, displayMode, fitKey, onLoad, onError,
}: {
  url: string;
  displayMode: DisplayMode;
  fitKey: number;
  onLoad: (s: ModelStats) => void;
  onError: (e: Error) => void;
}) {
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);
  const [edgeGeo, setEdgeGeo] = useState<THREE.BufferGeometry | null>(null);
  const [box, setBox] = useState<THREE.Box3 | null>(null);
  const { camera } = useThree();

  useEffect(() => {
    if (!box || box.isEmpty()) return;
    fitCamera(camera, box);
  }, [box, camera, fitKey]);

  useEffect(() => {
    let cancelled = false;
    const loader = new STLLoader();
    loader.load(url, (geometry) => {
      if (cancelled) return;
      geometry.computeBoundingBox();
      geometry.computeVertexNormals();
      const b = geometry.boundingBox!;
      const size = b.getSize(new THREE.Vector3());
      const center = b.getCenter(new THREE.Vector3());
      setGeo(geometry);
      setEdgeGeo(new THREE.EdgesGeometry(geometry, 20));
      setBox(b);
      onLoad({
        vertices: geometry.attributes.position.count,
        triangles: Math.round(geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3),
        bbox: { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) },
        center, bottomY: b.min.y,
      });
    }, undefined, e => { if (!cancelled) onError(new Error(String(e))); });
    return () => { cancelled = true; };
  }, [url, onLoad, onError]);

  if (!geo) return null;
  return (
    <group>
      {displayMode !== 'wireframe' && (
        <mesh geometry={geo} castShadow receiveShadow>
          <meshStandardMaterial color="#8b9cf4" roughness={0.35} metalness={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}
      {displayMode === 'wireframe' && (
        <mesh geometry={geo}><meshBasicMaterial color="#22d3ee" wireframe /></mesh>
      )}
      {displayMode === 'edges' && edgeGeo && (
        <lineSegments geometry={edgeGeo}><lineBasicMaterial color="#60a5fa" /></lineSegments>
      )}
    </group>
  );
}

// ─── Scene content ────────────────────────────────────────────────────────────

function SceneContent({ url, ext, displayMode, fitKey, onLoad, onError }: {
  url: string; ext: string; displayMode: DisplayMode; fitKey: number;
  onLoad: (s: ModelStats) => void; onError: (e: Error) => void;
}) {
  if (ext === 'stl') return <STLScene url={url} displayMode={displayMode} fitKey={fitKey} onLoad={onLoad} onError={onError} />;
  if (['step', 'stp', 'iges', 'igs'].includes(ext))
    return <STEPModel url={url} displayMode={displayMode} fitKey={fitKey} onLoad={onLoad} onError={onError} />;
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ModelViewer({ url, filename, onClose }: ModelViewerProps) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const [displayMode, setDisplayMode] = useState<DisplayMode>('solid');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleLoad = useCallback((s: ModelStats) => { setStats(s); setLoading(false); }, []);
  const handleError = useCallback((e: Error) => { setError(e.message); setLoading(false); }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
  const PDF_EXTS = ['pdf'];
  const CAD2D_EXTS = ['dwg', 'dxf'];
  const MODEL_EXTS = ['stl', 'step', 'stp', 'iges', 'igs'];
  const kind: 'model' | 'image' | 'pdf' | 'cad2d' | 'unsupported' =
    MODEL_EXTS.includes(ext) ? 'model'
    : IMAGE_EXTS.includes(ext) ? 'image'
    : PDF_EXTS.includes(ext) ? 'pdf'
    : CAD2D_EXTS.includes(ext) ? 'cad2d'
    : 'unsupported';
  const isSupported = kind === 'model';

  const MODES: { key: DisplayMode; label: string; icon: string }[] = [
    { key: 'solid',     label: '솔리드',   icon: '⬛' },
    { key: 'edges',     label: '엣지',     icon: '◻' },
    { key: 'wireframe', label: '와이어',   icon: '⬡' },
  ];

  return (
    <>
      <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0d1117', borderRadius: 'inherit' }}>

        {/* ── 툴바 ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: '#161b22', borderBottom: '1px solid #30363d', flexShrink: 0 }}>
          {/* 파일명 */}
          <span style={{ color: '#7d8590', fontSize: '11px' }}>🧊</span>
          <span style={{ color: '#c9d1d9', fontSize: '12px', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {filename}
          </span>
          {loading && isSupported && !error && (
            <span style={{ fontSize: '11px', color: '#388bfd', animation: 'nf-pulse 1.5s infinite', flexShrink: 0 }}>로딩 중...</span>
          )}

          {/* 디스플레이 모드 */}
          {isSupported && !error && (
            <div style={{ display: 'flex', gap: '2px', background: '#21262d', borderRadius: '6px', padding: '2px', flexShrink: 0 }}>
              {MODES.map(({ key, label, icon }) => (
                <button key={key} onClick={() => setDisplayMode(key)} title={label} style={{
                  padding: '3px 9px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: displayMode === key ? '#388bfd' : 'transparent',
                  color: displayMode === key ? '#fff' : '#6e7681',
                  display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                  <span style={{ fontSize: '10px' }}>{icon}</span>{label}
                </button>
              ))}
            </div>
          )}

          {/* 리셋 + 전체화면 */}
          {isSupported && !error && (
            <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
              <button onClick={() => setFitKey(k => k + 1)} title="카메라 초기화" style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', background: '#21262d', color: '#6e7681', fontSize: '14px', cursor: 'pointer', lineHeight: 1 }}>⟳</button>
              <button onClick={toggleFullscreen} title={isFullscreen ? '전체화면 종료' : '전체화면'} style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', background: '#21262d', color: '#6e7681', fontSize: '12px', cursor: 'pointer', lineHeight: 1 }}>
                {isFullscreen ? '⊡' : '⛶'}
              </button>
            </div>
          )}
        </div>

        {/* ── Canvas 영역 ── */}
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {kind === 'image' ? (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: '12px' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={filename} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', background: '#fff', borderRadius: 4 }} />
            </div>
          ) : kind === 'pdf' ? (
            <iframe src={url} title={filename} style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} />
          ) : kind === 'cad2d' ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '8px', padding: '0 20px' }}>
              <p style={{ color: '#c9d1d9', fontSize: '14px', fontWeight: 600 }}>📐 2D 도면 파일 <code style={{ color: '#f0883e' }}>.{ext}</code></p>
              <p style={{ color: '#8b949e', fontSize: '12px', textAlign: 'center' }}>브라우저에서는 직접 미리보기가 제공되지 않습니다. 다운로드 후 CAD 뷰어로 열어주세요.</p>
              <a href={url} download={filename} style={{ marginTop: 6, padding: '6px 14px', background: '#238636', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: '12px', fontWeight: 600 }}>⬇ 다운로드</a>
            </div>
          ) : kind === 'unsupported' ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '4px' }}>
              <p style={{ color: '#8b949e', fontSize: '13px' }}>지원되지 않는 형식: <code style={{ color: '#f0883e' }}>.{ext}</code></p>
              <p style={{ color: '#484f58', fontSize: '12px' }}>지원: STL, STEP, STP, 이미지, PDF, DWG/DXF</p>
            </div>
          ) : error ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '6px', padding: '0 20px' }}>
              <p style={{ color: '#f85149', fontSize: '13px', fontWeight: 700 }}>모델 로딩 실패</p>
              <p style={{ color: '#6e7681', fontSize: '12px', textAlign: 'center' }}>{error}</p>
            </div>
          ) : (
            <>
              {/* 로딩 오버레이 */}
              {loading && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', background: 'rgba(13,17,23,0.85)', backdropFilter: 'blur(4px)' }}>
                  <div style={{ width: '34px', height: '34px', border: '3px solid #21262d', borderTopColor: '#388bfd', borderRadius: '50%', animation: 'nf-spin 0.7s linear infinite' }} />
                  <span style={{ color: '#8b949e', fontSize: '13px' }}>WASM 파싱 중...</span>
                </div>
              )}

              <Canvas camera={{ position: [50, 50, 50], fov: 50 }} shadows gl={{ antialias: true }} style={{ width: '100%', height: '100%' }}>
                <color attach="background" args={['#0d1117']} />
                <hemisphereLight args={['#c8d8ff', '#0a0a1a', 0.7]} />
                <ambientLight intensity={0.25} />
                <directionalLight position={[20, 30, 15]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
                <directionalLight position={[-15, 10, -10]} intensity={0.5} color="#c8d8ff" />
                <pointLight position={[0, 50, 0]} intensity={0.3} color="#ffffff" />
                <Suspense fallback={null}>
                  <SceneContent
                    url={url} ext={ext} displayMode={displayMode}
                    fitKey={fitKey} onLoad={handleLoad} onError={handleError}
                  />
                  <OrbitControls makeDefault enableDamping dampingFactor={0.07} minDistance={1} maxDistance={5000} />
                </Suspense>
                <Grid
                  args={[2000, 2000]}
                  position={[0, (stats?.bottomY ?? 0) - 2, 0]}
                  cellSize={10}
                  cellThickness={0.4}
                  cellColor="#1c2128"
                  sectionSize={50}
                  sectionThickness={0.8}
                  sectionColor="#30363d"
                  fadeDistance={600}
                  fadeStrength={3}
                  infiniteGrid
                />
              </Canvas>
            </>
          )}
        </div>

        {/* ── 하단 스탯 바 ── */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 10px', background: '#161b22', borderTop: '1px solid #30363d', fontSize: '11px', flexShrink: 0, gap: '10px', flexWrap: 'wrap' }}>
          {stats && !loading ? (
            <>
              <span style={{ color: '#58a6ff', fontWeight: 700 }}>
                {stats.bbox.w} × {stats.bbox.h} × {stats.bbox.d} mm
              </span>
              <span style={{ color: '#30363d' }}>│</span>
              <span style={{ color: '#6e7681' }}>△ {stats.triangles.toLocaleString()}</span>
              <span style={{ color: '#30363d' }}>│</span>
              <span style={{ color: '#6e7681' }}>◦ {stats.vertices.toLocaleString()}</span>
              <span style={{ marginLeft: 'auto', color: '#484f58' }}>드래그 회전 · 우클릭 이동 · 스크롤 줌</span>
            </>
          ) : (
            <span style={{ color: '#484f58' }}>드래그 회전 · 우클릭 이동 · 스크롤 줌</span>
          )}
        </div>

      </div>
    </>
  );
}
