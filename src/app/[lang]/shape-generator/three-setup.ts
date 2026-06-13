import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// Globally extend Three.js prototypes for BVH acceleration
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ── Render-target teardown guard ───────────────────────────────────────────
// three.js `deallocateRenderTarget` (WebGLRenderer) crashes with
// "Cannot read properties of undefined (reading '0')" at its
// `__webglFramebuffer[i]` loop when a WebGLCubeRenderTarget is disposed before
// it was ever rendered to — `__webglFramebuffer` is never allocated and three
// doesn't guard that branch.
//
// drei's procedural <Environment> (used by the photorealistic RenderMode)
// builds a cube render target; switching the modeler from the 3D viewport to
// Drawing view unmounts the Canvas and disposes that target before its first
// render, hitting the unguarded path. React catches it so the UI keeps working,
// but it spams the console + Sentry on every 3D→Drawing switch.
//
// The GPU resources were never allocated when this fires, so nothing leaks.
// WebGLCubeRenderTarget inherits this dispose(), so patching the base prototype
// covers it; dispatchEvent('dispose') runs synchronously inside dispose(), so
// the try/catch captures the renderer-side listener throw.
const _renderTargetDispose = THREE.WebGLRenderTarget.prototype.dispose;
THREE.WebGLRenderTarget.prototype.dispose = function dispose(this: THREE.WebGLRenderTarget) {
  try {
    _renderTargetDispose.call(this);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
       
      console.warn('[three-setup] swallowed render-target dispose teardown error (unrendered target):', err);
    }
  }
};
