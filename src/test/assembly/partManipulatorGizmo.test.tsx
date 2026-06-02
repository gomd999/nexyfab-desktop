/** @vitest-environment jsdom */
/**
 * PartManipulatorGizmo — Phase 3.A.gizmo tests.
 *
 * The gizmo is a side-effectful Three.js component, so we mock both
 * `three` and the `TransformControls` ES module the same way
 * Assembly3DViewer does. The TransformControls stub records which
 * methods were called + remembers its last-attached object so we can
 * simulate a drag (set proxy pose, fire 'dragging-changed' false).
 *
 * Coverage (13 cases):
 *   1.  selectedPart=null → component renders nothing (no DOM marker).
 *   2.  selectedPart set + scene → DOM marker present + data-mode wired.
 *   3.  default mode is 'translate' (visible label + dataset).
 *   4.  mode='rotate' propagates to TransformControls.setMode and dataset.
 *   5.  TransformControls is constructed + attached to the proxy when
 *       camera + dom are supplied.
 *   6.  proxy.position / .quaternion are seeded from selectedPart.
 *   7.  drag-end (dragging-changed false) → onTransform fires with
 *       the proxy's pose snapped to the 5mm grid.
 *   8.  per-frame dragging-changed=true does NOT fire onTransform
 *       (commit happens on drag-end only).
 *   9.  ESC key while attached calls TransformControls.reset() and
 *       does NOT invoke onTransform (cancel-without-commit).
 *  10.  unmount detaches + disposes controls + removes proxy/helper
 *       from the scene without throwing.
 *  11.  jsdom without WebGL (no camera/domElement) → graceful render,
 *       no TransformControls construction, still no throw.
 *  12.  snapToGrid helper rounds to nearest multiple (and respects
 *       step=0 as "no snap").
 *  13.  snapVec3 helper quantises every axis.
 *  14.  readProxyPose reads position + quaternion off a proxy-like
 *       object even when shapes differ slightly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { IDENTITY_QUAT, type PartInstance } from '@/lib/assembly/assemblyState';

// ─── three mock ──────────────────────────────────────────────────────────

vi.mock('three', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number): this {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
  }
  class Quaternion {
    public x = 0;
    public y = 0;
    public z = 0;
    public w = 1;
    set(x: number, y: number, z: number, w: number): this {
      this.x = x;
      this.y = y;
      this.z = z;
      this.w = w;
      return this;
    }
  }
  class Object3D {
    public position = new Vector3();
    public quaternion = new Quaternion();
  }
  class Scene {
    public added: unknown[] = [];
    public removed: unknown[] = [];
    add(o: unknown): void {
      this.added.push(o);
    }
    remove(o: unknown): void {
      this.removed.push(o);
    }
  }
  class Camera {}
  return {
    Vector3,
    Quaternion,
    Object3D,
    Scene,
    Camera,
  };
});

// ─── TransformControls mock ──────────────────────────────────────────────

interface MockControls {
  mode: string;
  translationSnap: number | null;
  rotationSnap: number | null;
  attached: unknown;
  helper: { __helper: true };
  listeners: Map<string, Array<(e: unknown) => void>>;
  setMode: (m: string) => void;
  setTranslationSnap: (n: number) => void;
  setRotationSnap: (n: number) => void;
  attach: (o: unknown) => MockControls;
  detach: () => MockControls;
  getHelper: () => { __helper: true };
  reset: () => void;
  dispose: () => void;
  addEventListener: (t: string, cb: (e: unknown) => void) => void;
  removeEventListener: (t: string, cb: (e: unknown) => void) => void;
  __ctorCamera: unknown;
  __ctorDom: unknown;
  __resetCount: number;
  __detachCount: number;
  __disposeCount: number;
}

// Hand back the most-recently constructed mock so tests can simulate
// drag events directly against it.
let lastControls: MockControls | null = null;
const ctorSpy = vi.fn();

vi.mock('three/examples/jsm/controls/TransformControls.js', () => {
  class TransformControls {
    public mode = 'translate';
    public translationSnap: number | null = null;
    public rotationSnap: number | null = null;
    public attached: unknown = null;
    public helper = { __helper: true as const };
    public listeners = new Map<string, Array<(e: unknown) => void>>();
    public __ctorCamera: unknown;
    public __ctorDom: unknown;
    public __resetCount = 0;
    public __detachCount = 0;
    public __disposeCount = 0;
    constructor(camera: unknown, dom: unknown) {
      ctorSpy(camera, dom);
      this.__ctorCamera = camera;
      this.__ctorDom = dom;
      lastControls = this as unknown as MockControls;
    }
    setMode(m: string): void {
      this.mode = m;
    }
    setTranslationSnap(n: number): void {
      this.translationSnap = n;
    }
    setRotationSnap(n: number): void {
      this.rotationSnap = n;
    }
    attach(o: unknown): this {
      this.attached = o;
      return this;
    }
    detach(): this {
      this.attached = null;
      this.__detachCount += 1;
      return this;
    }
    getHelper(): { __helper: true } {
      return this.helper;
    }
    reset(): void {
      this.__resetCount += 1;
    }
    dispose(): void {
      this.__disposeCount += 1;
    }
    addEventListener(t: string, cb: (e: unknown) => void): void {
      const arr = this.listeners.get(t) ?? [];
      arr.push(cb);
      this.listeners.set(t, arr);
    }
    removeEventListener(t: string, cb: (e: unknown) => void): void {
      const arr = this.listeners.get(t) ?? [];
      this.listeners.set(t, arr.filter((c) => c !== cb));
    }
  }
  return { TransformControls };
});

// Pull AFTER the mocks register.
import PartManipulatorGizmo, {
  DEFAULT_TRANSLATION_SNAP_MM,
  DEFAULT_ROTATION_SNAP_RAD,
  MODE_LABELS,
  snapToGrid,
  snapVec3,
  readProxyPose,
} from '@/app/[lang]/shape-generator/assembly/PartManipulatorGizmo';
import * as THREE from 'three';

// ─── fixtures ────────────────────────────────────────────────────────────

function makePart(overrides: Partial<PartInstance> = {}): PartInstance {
  return {
    id: 'p_arm',
    name: 'Arm',
    partTemplateId: 'tpl_arm',
    position: { x: 12.4, y: 0, z: 0 },
    orientation: IDENTITY_QUAT,
    ...overrides,
  };
}

function makeScene(): THREE.Scene {
  return new THREE.Scene();
}

function dispatchDragEnd(value: boolean): void {
  expect(lastControls).not.toBeNull();
  const cbs = lastControls!.listeners.get('dragging-changed') ?? [];
  for (const cb of cbs) cb({ value });
}

beforeEach(() => {
  lastControls = null;
  ctorSpy.mockClear();
});

// ─── tests ───────────────────────────────────────────────────────────────

describe('PartManipulatorGizmo', () => {
  it('renders nothing when selectedPart is null', () => {
    const { container } = render(
      <PartManipulatorGizmo
        selectedPart={null}
        scene={makeScene()}
        onTransform={() => {}}
      />,
    );
    expect(container.querySelector('[data-testid="part-manipulator-gizmo"]')).toBeNull();
  });

  it('renders the DOM marker when selectedPart and scene are supplied', () => {
    render(
      <PartManipulatorGizmo
        selectedPart={makePart()}
        scene={makeScene()}
        onTransform={() => {}}
      />,
    );
    const root = screen.getByTestId('part-manipulator-gizmo');
    expect(root).toBeInTheDocument();
    expect(root.getAttribute('data-selected-part-id')).toBe('p_arm');
  });

  it('defaults to translate mode (label + dataset)', () => {
    render(
      <PartManipulatorGizmo
        selectedPart={makePart()}
        scene={makeScene()}
        onTransform={() => {}}
      />,
    );
    const root = screen.getByTestId('part-manipulator-gizmo');
    expect(root.getAttribute('data-mode')).toBe('translate');
    expect(root.textContent).toContain(MODE_LABELS.translate);
  });

  it('forwards mode="rotate" to dataset + TransformControls.setMode', () => {
    const scene = makeScene();
    const camera = new (THREE as unknown as { Camera: new () => unknown }).Camera();
    const dom = document.createElement('div');
    render(
      <PartManipulatorGizmo
        selectedPart={makePart()}
        scene={scene}
        camera={camera as unknown as THREE.Camera}
        domElement={dom}
        onTransform={() => {}}
        mode="rotate"
      />,
    );
    const root = screen.getByTestId('part-manipulator-gizmo');
    expect(root.getAttribute('data-mode')).toBe('rotate');
    expect(lastControls).not.toBeNull();
    expect(lastControls!.mode).toBe('rotate');
  });

  it('constructs + attaches TransformControls when camera + domElement supplied', () => {
    const scene = makeScene();
    const camera = new (THREE as unknown as { Camera: new () => unknown }).Camera();
    const dom = document.createElement('div');
    render(
      <PartManipulatorGizmo
        selectedPart={makePart()}
        scene={scene}
        camera={camera as unknown as THREE.Camera}
        domElement={dom}
        onTransform={() => {}}
      />,
    );
    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(lastControls!.attached).not.toBeNull();
    expect(lastControls!.translationSnap).toBe(DEFAULT_TRANSLATION_SNAP_MM);
    expect(lastControls!.rotationSnap).toBeCloseTo(DEFAULT_ROTATION_SNAP_RAD);
  });

  it('seeds the proxy position + quaternion from selectedPart', () => {
    const scene = makeScene();
    const camera = new (THREE as unknown as { Camera: new () => unknown }).Camera();
    const dom = document.createElement('div');
    const part = makePart({ position: { x: 7, y: 8, z: 9 }, orientation: { x: 0, y: 1, z: 0, w: 0 } });
    render(
      <PartManipulatorGizmo
        selectedPart={part}
        scene={scene}
        camera={camera as unknown as THREE.Camera}
        domElement={dom}
        onTransform={() => {}}
      />,
    );
    const attached = lastControls!.attached as {
      position: { x: number; y: number; z: number };
      quaternion: { x: number; y: number; z: number; w: number };
    };
    expect(attached.position.x).toBe(7);
    expect(attached.position.y).toBe(8);
    expect(attached.position.z).toBe(9);
    expect(attached.quaternion.x).toBe(0);
    expect(attached.quaternion.y).toBe(1);
    expect(attached.quaternion.w).toBe(0);
  });

  it('drag-end calls onTransform with the snapped proxy pose', () => {
    const scene = makeScene();
    const camera = new (THREE as unknown as { Camera: new () => unknown }).Camera();
    const dom = document.createElement('div');
    const onTransform = vi.fn();
    render(
      <PartManipulatorGizmo
        selectedPart={makePart()}
        scene={scene}
        camera={camera as unknown as THREE.Camera}
        domElement={dom}
        onTransform={onTransform}
      />,
    );
    // Move the proxy as if the user dragged it 12.4 units → snaps to 10
    // on the 5 mm grid.
    const proxy = lastControls!.attached as {
      position: { set: (x: number, y: number, z: number) => void; x: number; y: number; z: number };
    };
    proxy.position.set(12.4, 0, 0);
    dispatchDragEnd(false);
    expect(onTransform).toHaveBeenCalledTimes(1);
    const [pid, pos, ori] = onTransform.mock.calls[0]!;
    expect(pid).toBe('p_arm');
    expect(pos).toEqual({ x: 10, y: 0, z: 0 });
    expect(ori).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('does NOT fire onTransform on dragging-changed=true (drag start)', () => {
    const scene = makeScene();
    const camera = new (THREE as unknown as { Camera: new () => unknown }).Camera();
    const dom = document.createElement('div');
    const onTransform = vi.fn();
    render(
      <PartManipulatorGizmo
        selectedPart={makePart()}
        scene={scene}
        camera={camera as unknown as THREE.Camera}
        domElement={dom}
        onTransform={onTransform}
      />,
    );
    dispatchDragEnd(true);
    expect(onTransform).not.toHaveBeenCalled();
  });

  it('ESC key calls TransformControls.reset() and does NOT commit', () => {
    const scene = makeScene();
    const camera = new (THREE as unknown as { Camera: new () => unknown }).Camera();
    const dom = document.createElement('div');
    const onTransform = vi.fn();
    render(
      <PartManipulatorGizmo
        selectedPart={makePart()}
        scene={scene}
        camera={camera as unknown as THREE.Camera}
        domElement={dom}
        onTransform={onTransform}
      />,
    );
    const before = lastControls!.__resetCount;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(lastControls!.__resetCount).toBe(before + 1);
    expect(onTransform).not.toHaveBeenCalled();
  });

  it('unmount detaches + disposes controls + removes proxy/helper without throwing', () => {
    const scene = makeScene();
    const camera = new (THREE as unknown as { Camera: new () => unknown }).Camera();
    const dom = document.createElement('div');
    const { unmount } = render(
      <PartManipulatorGizmo
        selectedPart={makePart()}
        scene={scene}
        camera={camera as unknown as THREE.Camera}
        domElement={dom}
        onTransform={() => {}}
      />,
    );
    const ctrl = lastControls!;
    expect(() => unmount()).not.toThrow();
    expect(ctrl.__detachCount).toBeGreaterThanOrEqual(1);
    expect(ctrl.__disposeCount).toBeGreaterThanOrEqual(1);
    // helper + proxy both removed from the scene.
    const sceneAny = scene as unknown as { removed: unknown[] };
    expect(sceneAny.removed.length).toBeGreaterThanOrEqual(2);
  });

  it('graceful skip when no camera / domElement (jsdom no-WebGL path)', () => {
    expect(() =>
      render(
        <PartManipulatorGizmo
          selectedPart={makePart()}
          scene={makeScene()}
          onTransform={() => {}}
        />,
      ),
    ).not.toThrow();
    // No TransformControls constructed without camera + dom.
    expect(ctorSpy).not.toHaveBeenCalled();
    // DOM marker still visible.
    expect(screen.getByTestId('part-manipulator-gizmo')).toBeInTheDocument();
  });

  it('snapToGrid rounds to the nearest multiple (and step≤0 disables snap)', () => {
    expect(snapToGrid(0, 5)).toBe(0);
    expect(snapToGrid(2.4, 5)).toBe(0);
    expect(snapToGrid(2.5, 5)).toBe(5);
    expect(snapToGrid(12.4, 5)).toBe(10);
    expect(snapToGrid(12.6, 5)).toBe(15);
    expect(snapToGrid(-7.4, 5)).toBe(-5);
    // step disabled
    expect(snapToGrid(12.4, 0)).toBe(12.4);
    expect(snapToGrid(12.4, -1)).toBe(12.4);
  });

  it('snapVec3 quantises every axis independently', () => {
    const out = snapVec3({ x: 12.4, y: 7.6, z: -2.5 }, 5);
    expect(out.x).toBe(10);
    expect(out.y).toBe(10);
    // Math.round(-2.5/5)*5 = -0; treat as zero magnitude.
    expect(Math.abs(out.z)).toBe(0);
  });

  it('readProxyPose reads .position and .quaternion off a proxy-like object', () => {
    const p = {
      position: { x: 1, y: 2, z: 3 },
      quaternion: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
    };
    const out = readProxyPose(p);
    expect(out.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(out.orientation).toEqual({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 });
  });
});
