'use client';

import { useEffect, useRef } from 'react';

interface Bend { edge: string; angle: number; height: number }
interface Props { base: { W: number; L: number; thickness: number }; bends: Bend[] }

/**
 * Client-side Three.js preview of the FOLDED sheet-metal part. The flat pattern
 * is parametric, so we fold it deterministically: a base panel + one box per
 * flange, each pivoted at its base edge and rotated up by the bend angle. Sharp
 * folds (bend radius is small at this scale) — drag to rotate, auto-spins idle.
 */
export default function SheetMetal3D({ base, bends }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0, disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import('three');
      if (disposed || !el) return;

      const W = base.W, L = base.L, T = Math.max(base.thickness, 0.8);
      const height = 360;
      const width = el.clientWidth || 600;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#0d1117');
      const camera = new THREE.PerspectiveCamera(42, width / height, 1, 8000);
      const maxDim = Math.max(W, L, ...bends.map(b => b.height), 50);
      camera.position.set(maxDim * 0.6, maxDim * 1.0, maxDim * 1.5);
      camera.lookAt(0, T, 0);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      el.appendChild(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 0.65));
      const d1 = new THREE.DirectionalLight(0xffffff, 0.85); d1.position.set(1, 2, 1.2); scene.add(d1);
      const d2 = new THREE.DirectionalLight(0xffffff, 0.3); d2.position.set(-1.2, 0.8, -1); scene.add(d2);

      const mat = new THREE.MeshStandardMaterial({ color: '#aab2bd', metalness: 0.55, roughness: 0.42, side: THREE.DoubleSide });
      const edgeMat = new THREE.LineBasicMaterial({ color: '#2b3340' });
      const part = new THREE.Group();

      const panel = (geo: import('three').BoxGeometry) => {
        const m = new THREE.Mesh(geo, mat);
        m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
        return m;
      };

      const baseMesh = panel(new THREE.BoxGeometry(W, T, L));
      baseMesh.position.y = T / 2;
      part.add(baseMesh);

      for (const f of bends) {
        const H = Math.max(f.height, 2);
        const ang = ((f.angle || 90) * Math.PI) / 180;
        const g = new THREE.Group();
        if (f.edge === 'back') { g.position.set(0, T / 2, L / 2); const m = panel(new THREE.BoxGeometry(W, T, H)); m.position.z = H / 2; g.add(m); g.rotation.x = -ang; }
        else if (f.edge === 'front') { g.position.set(0, T / 2, -L / 2); const m = panel(new THREE.BoxGeometry(W, T, H)); m.position.z = -H / 2; g.add(m); g.rotation.x = ang; }
        else if (f.edge === 'right') { g.position.set(W / 2, T / 2, 0); const m = panel(new THREE.BoxGeometry(H, T, L)); m.position.x = H / 2; g.add(m); g.rotation.z = ang; }
        else { g.position.set(-W / 2, T / 2, 0); const m = panel(new THREE.BoxGeometry(H, T, L)); m.position.x = -H / 2; g.add(m); g.rotation.z = -ang; }
        part.add(g);
      }
      // grid floor for ground reference
      const grid = new THREE.GridHelper(maxDim * 3, 12, 0x30363d, 0x21262d);
      grid.position.y = 0;
      scene.add(grid);
      scene.add(part);

      // interaction: drag to rotate, auto-spin when idle
      let dragging = false, lastX = 0, lastY = 0, idle = 0;
      part.rotation.y = -0.5;
      const dom = renderer.domElement;
      const onDown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY; idle = 0; };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        part.rotation.y += (e.clientX - lastX) * 0.01;
        part.rotation.x = Math.max(-1.2, Math.min(1.2, part.rotation.x + (e.clientY - lastY) * 0.01));
        lastX = e.clientX; lastY = e.clientY; idle = 0;
      };
      const onUp = () => { dragging = false; };
      dom.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);

      const onResize = () => { const w = el.clientWidth || width; renderer.setSize(w, height); camera.aspect = w / height; camera.updateProjectionMatrix(); };
      window.addEventListener('resize', onResize);

      const loop = () => {
        if (!dragging) { idle += 1; if (idle > 30) part.rotation.y += 0.004; }
        renderer.render(scene, camera);
        raf = requestAnimationFrame(loop);
      };
      loop();

      cleanup = () => {
        cancelAnimationFrame(raf);
        dom.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('resize', onResize);
        renderer.dispose();
        if (dom.parentNode === el) el.removeChild(dom);
      };
    })();

    return () => { disposed = true; cleanup(); };
  }, [base, bends]);

  return <div ref={ref} style={{ width: '100%', height: 360, borderRadius: 8, overflow: 'hidden', background: '#0d1117', cursor: 'grab' }} />;
}
