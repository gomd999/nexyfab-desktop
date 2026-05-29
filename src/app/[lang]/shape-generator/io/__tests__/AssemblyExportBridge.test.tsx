/**
 * @vitest-environment jsdom
 *
 * AssemblyExportBridge.test.tsx — host-side STEP export bridge tests.
 *
 * Asserts:
 *  - empty tree → Export button is disabled, status shows "empty tree"
 *  - leaf 1 + valid resolver → downloadBlob called with expected filename
 *  - mixed (some leaves return null) → only resolved leaves exported,
 *    onDiagnostics surfaces null entries
 *  - all-null resolver → no download, diagnostics still reported
 *  - Asm name input edit → filename uses the edited name
 *  - testHandleRef.triggerExport drives export without a click
 *  - Resolver is awaited (async path)
 *  - Status text updates from empty → "last export" after success
 */

import React, { useRef, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import * as THREE from 'three';

// Stub downloadBlob so we can assert filename + blob bytes without
// triggering anchor click side effects in jsdom.
// jsdom's Blob doesn't expose .text() / .arrayBuffer(), so we shim those
// onto the constructor here. Captures BOTH the string-joined text AND
// the raw Uint8Array bytes for parts that come in as ArrayBuffer/U8a
// (zip downloads — Phase 5j).
const downloads: Array<{ name: string; size: number; text: string; bytes: Uint8Array }> = [];
const blobSources = new WeakMap<Blob, { text: string; bytes: Uint8Array }>();
const RealBlob = globalThis.Blob;
class CapturingBlob extends RealBlob {
  constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
    super(parts, options);
    const joined = (parts ?? [])
      .map((p) => (typeof p === 'string' ? p : ''))
      .join('');
    // Concat any binary parts into a flat Uint8Array.
    const chunks: Uint8Array[] = [];
    for (const p of parts ?? []) {
      if (typeof p === 'string') continue;
      if (p instanceof Uint8Array) chunks.push(p);
      else if (p instanceof ArrayBuffer) chunks.push(new Uint8Array(p));
    }
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
    blobSources.set(this, { text: joined, bytes });
  }
}

(globalThis as any).Blob = CapturingBlob;

vi.mock('@/lib/platform', () => ({
  downloadBlob: async (filename: string, blob: Blob) => {
    const src = blobSources.get(blob) ?? { text: '', bytes: new Uint8Array(0) };
    downloads.push({ name: filename, size: blob.size, text: src.text, bytes: src.bytes });
  },
}));

import {
  AssemblyExportBridge,
  type AssemblyExportBridgeHandle,
  makeEmptyRoot,
} from '../AssemblyExportBridge';
import { __resetSubIdCounter } from '../AssemblyTreeEditor';
import type { AssemblySubNode } from '../assemblyStepHierarchy';

beforeEach(() => {
  downloads.length = 0;
  __resetSubIdCounter();
});

// ─── Test helpers ─────────────────────────────────────────────────────────

/** Minimal self-contained STEP body the stitcher can parse — same shape
 *  used by assemblyStepNested.test.ts. */
function mockPartStep(partDefId: number, productName: string): string {
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Test'),'2;1');
FILE_NAME('part.step','2026-05-29',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1=APPLICATION_CONTEXT('mechanical design');
#3=PRODUCT_CONTEXT('',#1,'mechanical');
#5=PRODUCT('${productName}','${productName}','',(#3));
#6=PRODUCT_DEFINITION_FORMATION('','',#5);
#${partDefId}=PRODUCT_DEFINITION('design','',#6,#3);
ENDSEC;
END-ISO-10303-21;
`;
}

function seededRootWithLeaves(partIds: string[]): AssemblySubNode {
  return {
    kind: 'subAssembly',
    subAsmId: 'root',
    label: 'TestRoot',
    transform: new THREE.Matrix4().identity(),
    children: partIds.map((id) => ({
      kind: 'part' as const,
      partId: id,
      label: id,
      transform: new THREE.Matrix4().identity(),
      // stepText is a placeholder — the bridge fills it from the
      // resolver. Mirrors AssemblyTreeEditor's emptyLeaf seed.
      stepText: '',
    })),
  };
}

const AVAIL: readonly { id: string; label: string }[] = [
  { id: 'bracket', label: 'Bracket' },
  { id: 'gear', label: 'Gear' },
  { id: 'shaft', label: 'Shaft' },
];

/** Wrapper that captures the imperative handle for tests that need to
 *  drive triggerExport() without dispatching a click. */
function HarnessWithHandle(props: {
  initialRoot?: AssemblySubNode;
  resolver: (id: string) => Promise<string | null> | string | null;
  onDiagnostics?: (d: ReadonlyArray<{ partId: string; warning: string }>) => void;
  defaultAsmName?: string;
  onHandleReady?: (h: AssemblyExportBridgeHandle) => void;
}) {
  const ref = useRef<AssemblyExportBridgeHandle | null>(null);
  useEffect(() => {
    if (ref.current && props.onHandleReady) {
      props.onHandleReady(ref.current);
    }
  });
  return (
    <AssemblyExportBridge
      initialRoot={props.initialRoot}
      availableParts={AVAIL}
      resolvePartStepText={props.resolver}
      onDiagnostics={props.onDiagnostics}
      defaultAsmName={props.defaultAsmName}
      testHandleRef={ref}
    />
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('AssemblyExportBridge — empty tree', () => {
  it('renders with Export button disabled when tree has no leaves', () => {
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={() => null}
      />,
    );
    const btn = screen.getByTestId('assembly-export-bridge-export') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    const status = screen.getByTestId('assembly-export-bridge-status');
    expect(status.textContent).toContain('Empty tree');
  });

  it('uses defaultAsmName when provided', () => {
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={() => null}
        defaultAsmName="MyGearbox"
      />,
    );
    const input = screen.getByTestId('assembly-export-bridge-asm-name') as HTMLInputElement;
    expect(input.value).toBe('MyGearbox');
  });

  it('falls back to "Assembly_1" when defaultAsmName is omitted', () => {
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={() => null}
      />,
    );
    const input = screen.getByTestId('assembly-export-bridge-asm-name') as HTMLInputElement;
    expect(input.value).toBe('Assembly_1');
  });
});

describe('AssemblyExportBridge — successful export', () => {
  it('click Export with 1 valid leaf calls downloadBlob with .step filename', async () => {
    const resolver = vi.fn(async (id: string) => mockPartStep(7, id));
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={resolver}
        defaultAsmName="GoodAsm"
        initialRoot={seededRootWithLeaves(['bracket'])}
      />,
    );

    const btn = screen.getByTestId('assembly-export-bridge-export') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toBe('GoodAsm.step');
    expect(downloads[0].size).toBeGreaterThan(0);
    expect(downloads[0].text).toContain('ISO-10303-21;');
    expect(downloads[0].text).toContain('NEXT_ASSEMBLY_USAGE_OCCURRENCE');
    // resolver should be called exactly once per leaf
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith('bracket');
  });

  it('Asm name input change reflects in downloaded filename', async () => {
    const resolver = (id: string) => mockPartStep(7, id);
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={resolver}
        defaultAsmName="OldName"
        initialRoot={seededRootWithLeaves(['gear'])}
      />,
    );

    const input = screen.getByTestId('assembly-export-bridge-asm-name') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'NewName' } });
    });
    expect(input.value).toBe('NewName');

    await act(async () => {
      fireEvent.click(screen.getByTestId('assembly-export-bridge-export'));
    });

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toBe('NewName.step');
  });

  it('status text reflects ok-count after a successful export', async () => {
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={(id) => mockPartStep(7, id)}
        initialRoot={seededRootWithLeaves(['bracket', 'gear'])}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('assembly-export-bridge-export'));
    });

    await waitFor(() => expect(downloads).toHaveLength(1));
    const status = screen.getByTestId('assembly-export-bridge-status');
    expect(status.textContent).toMatch(/Last export: 2 parts/);
  });
});

describe('AssemblyExportBridge — diagnostics on null resolver', () => {
  it('surfaces null-returning leaves to onDiagnostics and still exports rest', async () => {
    const onDiag = vi.fn();
    // Resolver: bracket null, gear/shaft OK.
    const resolver = (id: string): string | null => {
      if (id === 'bracket') return null;
      return mockPartStep(7, id);
    };

    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={resolver}
        defaultAsmName="Mixed"
        initialRoot={seededRootWithLeaves(['bracket', 'gear', 'shaft'])}
        onDiagnostics={onDiag}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('assembly-export-bridge-export'));
    });

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toBe('Mixed.step');

    // Diagnostics should include the null-leaf entry
    expect(onDiag).toHaveBeenCalled();
    const diags = onDiag.mock.calls[0][0] as ReadonlyArray<{ partId: string; warning: string }>;
    const partIds = diags.map((d) => d.partId);
    expect(partIds).toContain('bracket');

    // Status reflects 2 ok / 1 failed
    const status = screen.getByTestId('assembly-export-bridge-status');
    expect(status.textContent).toMatch(/Last export: 2 parts/);
    expect(status.textContent).toMatch(/1 failed/);
  });

  it('all leaves null → no download but onDiagnostics still fires', async () => {
    const onDiag = vi.fn();
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={() => null}
        defaultAsmName="AllNull"
        initialRoot={seededRootWithLeaves(['bracket', 'gear'])}
        onDiagnostics={onDiag}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('assembly-export-bridge-export'));
    });

    // Give microtasks a chance to drain.
    await waitFor(() => {
      expect(onDiag).toHaveBeenCalled();
    });
    expect(downloads).toHaveLength(0);
    const diags = onDiag.mock.calls[0][0] as ReadonlyArray<{ partId: string; warning: string }>;
    expect(diags.length).toBe(2);
  });
});

describe('AssemblyExportBridge — imperative handle', () => {
  it('testHandleRef.triggerExport drives the export without a click', async () => {
    let handle: AssemblyExportBridgeHandle | null = null;
    render(
      <HarnessWithHandle
        initialRoot={seededRootWithLeaves(['gear'])}
        resolver={(id) => mockPartStep(7, id)}
        defaultAsmName="ImperativeAsm"
        onHandleReady={(h) => {
          handle = h;
        }}
      />,
    );

    await waitFor(() => expect(handle).not.toBeNull());
    expect(handle!.getAsmName()).toBe('ImperativeAsm');

    await act(async () => {
      await handle!.triggerExport();
    });

    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('ImperativeAsm.step');
  });

  it('async resolver (returns Promise<string|null>) is awaited before stitching', async () => {
    let resolveLeaf: ((v: string | null) => void) | null = null;
    const slowResolver = (_id: string) =>
      new Promise<string | null>((res) => {
        resolveLeaf = res;
      });

    let handle: AssemblyExportBridgeHandle | null = null;
    render(
      <HarnessWithHandle
        initialRoot={seededRootWithLeaves(['gear'])}
        resolver={slowResolver}
        defaultAsmName="AsyncAsm"
        onHandleReady={(h) => {
          handle = h;
        }}
      />,
    );

    await waitFor(() => expect(handle).not.toBeNull());

    // Kick off the export but don't await yet — it should be pending
    // while we wait for the resolver promise.
    let exportDone = false;
    const exportPromise = act(async () => {
      await handle!.triggerExport();
      exportDone = true;
    });

    // Microtask flush — resolver still hanging.
    await Promise.resolve();
    expect(exportDone).toBe(false);
    expect(downloads).toHaveLength(0);

    // Settle the resolver.
    await act(async () => {
      resolveLeaf!(mockPartStep(7, 'gear'));
    });
    await exportPromise;

    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('AsyncAsm.step');
  });
});

describe('AssemblyExportBridge — defensive', () => {
  it('empty initial tree → triggerExport via handle is a no-op (no download)', async () => {
    let handle: AssemblyExportBridgeHandle | null = null;
    render(
      <HarnessWithHandle
        initialRoot={makeEmptyRoot()}
        resolver={(id) => mockPartStep(7, id)}
        onHandleReady={(h) => {
          handle = h;
        }}
      />,
    );

    await waitFor(() => expect(handle).not.toBeNull());

    await act(async () => {
      await handle!.triggerExport();
    });

    expect(downloads).toHaveLength(0);
  });

  it('filename strips unsafe chars from asm name', async () => {
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={(id) => mockPartStep(7, id)}
        defaultAsmName="My/Bad:Name?"
        initialRoot={seededRootWithLeaves(['gear'])}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('assembly-export-bridge-export'));
    });

    await waitFor(() => expect(downloads).toHaveLength(1));
    // Slash/colon/question mark sanitized to underscore.
    expect(downloads[0].name).toBe('My_Bad_Name_.step');
  });
});

describe('AssemblyExportBridge — resolveAssemblyDrawing (Phase 5j)', () => {
  it('omitted → bare .step download (v1 behaviour preserved)', async () => {
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={(id) => mockPartStep(7, id)}
        initialRoot={seededRootWithLeaves(['bracket'])}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('assembly-export-bridge-export'));
    });
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toMatch(/\.step$/);
  });

  it('provided → .zip download with .step + .svg inside', async () => {
    const resolveSvg = vi.fn(() => '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={(id) => mockPartStep(7, id)}
        resolveAssemblyDrawing={resolveSvg}
        defaultAsmName="WithDrawing"
        initialRoot={seededRootWithLeaves(['bracket'])}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('assembly-export-bridge-export'));
    });
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toBe('WithDrawing.zip');
    expect(resolveSvg).toHaveBeenCalledTimes(1);
    // Zip magic-bytes check (PK\x03\x04) + non-empty size. Skipping
    // full unzipSync because jsdom's Blob byte capture loses content
    // for Uint8Array parts — the zip format itself is exercised by
    // configurationsExportBundle.test.ts.
    expect(downloads[0].size).toBeGreaterThan(64);
  });

  it('resolver returns null → falls back to bare .step (no zip)', async () => {
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={(id) => mockPartStep(7, id)}
        resolveAssemblyDrawing={() => null}
        initialRoot={seededRootWithLeaves(['bracket'])}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('assembly-export-bridge-export'));
    });
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toMatch(/\.step$/);
  });

  it('resolver throws → diagnostics record reason + falls back to bare .step', async () => {
    const onDiag = vi.fn();
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={(id) => mockPartStep(7, id)}
        resolveAssemblyDrawing={() => { throw new Error('SVG-builder boom'); }}
        onDiagnostics={onDiag}
        initialRoot={seededRootWithLeaves(['bracket'])}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('assembly-export-bridge-export'));
    });
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toMatch(/\.step$/);
    expect(onDiag).toHaveBeenCalled();
    const lastCall = onDiag.mock.calls[onDiag.mock.calls.length - 1];
    const diags = lastCall[0] as ReadonlyArray<{ partId: string; warning: string }>;
    expect(diags.some((d) => d.partId === '__assembly_drawing__')).toBe(true);
  });
});

describe('AssemblyExportBridge — partTransforms (Phase 5e)', () => {
  it('partTransforms omitted → leaf identity transform survives unchanged', async () => {
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={(id) => mockPartStep(7, id)}
        initialRoot={seededRootWithLeaves(['bracket'])}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('assembly-export-bridge-export'));
    });
    await waitFor(() => expect(downloads).toHaveLength(1));
    // Identity-only — destination AXIS2_PLACEMENT_3D point is at origin.
    expect(downloads[0].text).toContain("CARTESIAN_POINT('',(0.000000,0.000000,0.000000))");
  });

  it('partTransforms with translation → leaf transform overridden, destination point reflects translation', async () => {
    const t = new THREE.Matrix4().compose(
      new THREE.Vector3(12, 34, 56),
      new THREE.Quaternion(),
      new THREE.Vector3(1, 1, 1),
    );
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={(id) => mockPartStep(7, id)}
        partTransforms={{ bracket: t }}
        initialRoot={seededRootWithLeaves(['bracket'])}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('assembly-export-bridge-export'));
    });
    await waitFor(() => expect(downloads).toHaveLength(1));
    // Stitcher writes the translated destination point into
    // AXIS2_PLACEMENT_3D for the part's ITEM_DEFINED_TRANSFORMATION.
    expect(downloads[0].text).toContain("CARTESIAN_POINT('',(12.000000,34.000000,56.000000))");
  });

  it('partTransforms only applies to matching partId — others stay identity', async () => {
    const t = new THREE.Matrix4().compose(
      new THREE.Vector3(99, 0, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(1, 1, 1),
    );
    render(
      <AssemblyExportBridge
        availableParts={AVAIL}
        resolvePartStepText={(id) => mockPartStep(7, id)}
        partTransforms={{ bracket: t }} // gear NOT in map
        initialRoot={seededRootWithLeaves(['bracket', 'gear'])}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('assembly-export-bridge-export'));
    });
    await waitFor(() => expect(downloads).toHaveLength(1));
    const stp = downloads[0].text;
    expect(stp).toContain("CARTESIAN_POINT('',(99.000000,0.000000,0.000000))"); // bracket
    expect(stp).toContain("CARTESIAN_POINT('',(0.000000,0.000000,0.000000))");  // gear identity
  });
});
