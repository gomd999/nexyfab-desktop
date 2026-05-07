'use client';

/**
 * WebXR AR Viewer
 *
 * Renders the current shape in an immersive-ar WebXR session.
 * Falls back to a "not supported" message when the browser/device lacks WebXR.
 *
 * Usage: mount this component outside the main Canvas when AR mode is active.
 * It creates its own full-screen Canvas with AR camera passthrough.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

interface ARViewerProps {
  geometry: THREE.BufferGeometry;
  color?: string;
  onClose?: () => void;
  lang?: string;
}

type ARState = 'idle' | 'checking' | 'unsupported' | 'starting' | 'active' | 'error';

export default function ARViewer({ geometry, color = '#8b9cf4', onClose, lang = 'ko' }: ARViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [arState, setArState] = useState<ARState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const sessionRef = useRef<XRSession | null>(null);
  const rafIdRef = useRef<number>(0);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const isKo = lang === 'ko';

  const T = {
    checkingSupport: isKo ? 'AR 지원 확인 중...' : 'Checking AR support…',
    notSupported:    isKo ? '이 기기/브라우저는 WebXR AR을 지원하지 않습니다. Chrome on Android 또는 iOS Safari (WebXR 지원) 를 사용하세요.' : 'WebXR AR is not supported on this device/browser. Try Chrome on Android or Safari on iOS (with WebXR support).',
    starting:        isKo ? 'AR 세션 시작 중...' : 'Starting AR session…',
    active:          isKo ? 'AR 활성 — 평면에 탭하여 배치' : 'AR active — tap a surface to place',
    close:           isKo ? 'AR 닫기' : 'Close AR',
    startAR:         isKo ? 'AR로 보기' : 'View in AR',
    error:           isKo ? 'AR 오류: ' : 'AR error: ',
    placementHint:   isKo ? '화면을 탭하면 3D 형상이 배치됩니다' : 'Tap the screen to place the 3D shape',
  };

  const startAR = useCallback(async () => {
    if (!navigator.xr) { setArState('unsupported'); return; }
    setArState('checking');
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      if (!supported) { setArState('unsupported'); return; }
    } catch {
      setArState('unsupported');
      return;
    }

    setArState('starting');
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Three.js setup
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.xr.enabled = true;
      rendererRef.current = renderer;

      const scene = new THREE.Scene();
      sceneRef.current = scene;

      scene.add(new THREE.HemisphereLight('#ffffff', '#444444', 1.2));
      const dirLight = new THREE.DirectionalLight('#ffffff', 0.8);
      dirLight.position.set(0, 8, 4);
      scene.add(dirLight);

      const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
      cameraRef.current = camera;

      // Build shape mesh
      const geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      if (!geo.attributes.normal) geo.computeVertexNormals();
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const scale = 0.2 / Math.max(
        bb.max.x - bb.min.x,
        bb.max.y - bb.min.y,
        bb.max.z - bb.min.z,
      );
      geo.scale(scale, scale, scale);
      geo.computeBoundingBox();
      const center = new THREE.Vector3();
      geo.boundingBox!.getCenter(center);
      geo.translate(-center.x, -center.y, -center.z);

      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }),
      );
      // Start slightly in front of camera
      mesh.position.set(0, -0.1, -0.5);
      scene.add(mesh);

      // Reticle for hit-test placement
      const reticleGeo = new THREE.RingGeometry(0.05, 0.06, 32).rotateX(-Math.PI / 2);
      const reticle = new THREE.Mesh(
        reticleGeo,
        new THREE.MeshBasicMaterial({ color: '#3fb950' }),
      );
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;
      scene.add(reticle);

      // Request AR session
      const session = await navigator.xr!.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
      });
      sessionRef.current = session;

      await renderer.xr.setSession(session);

      let hitTestSource: XRHitTestSource | null = null;
      let hitTestSourceRequested = false;
      let placed = false;

      session.addEventListener('end', () => {
        setArState('idle');
        renderer.dispose();
        geo.dispose();
        rendererRef.current = null;
      });

      // Place on tap
      session.addEventListener('select', () => {
        if (reticle.visible && !placed) {
          placed = true;
          mesh.position.setFromMatrixPosition(reticle.matrix);
          reticle.visible = false;
        } else if (placed) {
          // Allow re-placement
          placed = false;
          reticle.visible = true;
        }
      });

      renderer.setAnimationLoop(async (_time, frame) => {
        if (!frame) return;

        const referenceSpace = renderer.xr.getReferenceSpace();
        const xrSession = renderer.xr.getSession();

        if (!hitTestSourceRequested && xrSession && referenceSpace) {
          hitTestSourceRequested = true;
          try {
            const viewerSpace = await xrSession.requestReferenceSpace('viewer');
            hitTestSource = await xrSession.requestHitTestSource!({ space: viewerSpace }) ?? null;
          } catch { /* hit-test not available */ }
        }

        if (hitTestSource && referenceSpace) {
          const hitTestResults = frame.getHitTestResults(hitTestSource);
          if (hitTestResults.length > 0) {
            const hit = hitTestResults[0];
            const pose = hit.getPose(referenceSpace);
            if (pose && !placed) {
              reticle.visible = true;
              reticle.matrix.fromArray(pose.transform.matrix);
            }
          } else if (!placed) {
            reticle.visible = false;
          }
        }

        // Slow rotation when not placed
        if (!placed) mesh.rotation.y += 0.01;

        renderer.render(scene, camera);
      });

      setArState('active');
    } catch (e) {
      setArState('error');
      setErrorMsg(String(e));
    }
  }, [geometry, color]);

  const stopAR = useCallback(() => {
    rendererRef.current?.setAnimationLoop(null);
    sessionRef.current?.end().catch(() => {});
    sessionRef.current = null;
    rendererRef.current?.dispose();
    rendererRef.current = null;
    setArState('idle');
    onClose?.();
  }, [onClose]);

  // Cleanup on unmount
  useEffect(() => () => {
    rendererRef.current?.setAnimationLoop(null);
    sessionRef.current?.end().catch(() => {});
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900,
      background: arState === 'active' ? 'transparent' : 'rgba(13,17,23,0.95)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Hidden canvas used by WebXR renderer */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          display: arState === 'active' ? 'block' : 'none',
        }}
      />

      {arState === 'idle' && (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📱</div>
          <p style={{ color: '#c9d1d9', fontSize: 15, marginBottom: 24, maxWidth: 320 }}>
            {T.placementHint}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={startAR}
              style={{
                padding: '10px 28px', borderRadius: 8, border: 'none',
                background: '#3fb950', color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {T.startAR}
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '10px 20px', borderRadius: 8, border: '1px solid #30363d',
                background: 'transparent', color: '#8b949e', fontSize: 14, cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {(arState === 'checking' || arState === 'starting') && (
        <div style={{ color: '#c9d1d9', fontSize: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none"
            style={{ animation: 'spin 0.8s linear infinite' }}>
            <circle cx={12} cy={12} r={9} stroke="#30363d" strokeWidth={2} />
            <path d="M12 3a9 9 0 019 9" stroke="#388bfd" strokeWidth={2} strokeLinecap="round" />
          </svg>
          {arState === 'checking' ? T.checkingSupport : T.starting}
        </div>
      )}

      {arState === 'unsupported' && (
        <div style={{ textAlign: 'center', padding: 24, maxWidth: 360 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <p style={{ color: '#f85149', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>{T.notSupported}</p>
          <button onClick={onClose} style={{
            padding: '8px 24px', borderRadius: 8, border: '1px solid #30363d',
            background: '#21262d', color: '#c9d1d9', fontSize: 13, cursor: 'pointer',
          }}>
            {isKo ? '닫기' : 'Close'}
          </button>
        </div>
      )}

      {arState === 'error' && (
        <div style={{ textAlign: 'center', padding: 24, maxWidth: 360 }}>
          <p style={{ color: '#f85149', fontSize: 13 }}>{T.error}{errorMsg}</p>
          <button onClick={onClose} style={{
            marginTop: 16, padding: '8px 24px', borderRadius: 8, border: '1px solid #30363d',
            background: '#21262d', color: '#c9d1d9', fontSize: 13, cursor: 'pointer',
          }}>
            {isKo ? '닫기' : 'Close'}
          </button>
        </div>
      )}

      {arState === 'active' && (
        <button
          onClick={stopAR}
          style={{
            position: 'absolute', top: 16, right: 16, zIndex: 910,
            padding: '8px 20px', borderRadius: 8, border: 'none',
            background: 'rgba(13,17,23,0.85)', color: '#e6edf3',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            backdropFilter: 'blur(4px)',
          }}
        >
          {T.close}
        </button>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
