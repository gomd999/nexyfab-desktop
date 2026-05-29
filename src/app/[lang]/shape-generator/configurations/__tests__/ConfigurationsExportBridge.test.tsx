/**
 * @vitest-environment jsdom
 *
 * ConfigurationsExportBridge.test.tsx — host-side configurations
 * bundle export bridge tests.
 *
 * Asserts:
 *  - empty configs → Export button disabled + empty-state message
 *  - 3 configs all OK → bundle built + downloadBlob + onBundleReady fired
 *  - 1/3 fails (exportConfigStep returns null) → bundle still ships,
 *    diagnostics rendered
 *  - resolveConfigDrawing called once per config
 *  - testHandleRef.triggerExport drives export without a click
 *  - Status icons update from pending → ok / failed per row
 */

import React, { useRef, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';

// jsdom's Blob doesn't expose .text() / .arrayBuffer(); shim onto the
// constructor so the mocked downloadBlob can capture the raw input
// bytes passed to `new Blob([...])`. Mirrors the AssemblyExportBridge
// test capture pattern.
const downloads: Array<{
  name: string;
  size: number;
  bytes: Uint8Array | null;
}> = [];
const blobSources = new WeakMap<Blob, Uint8Array | null>();
const RealBlob = globalThis.Blob;
class CapturingBlob extends RealBlob {
  constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
    super(parts, options);
    // Bundle path passes an ArrayBuffer (from `zipBytes.buffer`).
    // Capture as a Uint8Array view for test assertions.
    let captured: Uint8Array | null = null;
    for (const p of parts ?? []) {
      if (p instanceof Uint8Array) {
        captured = p;
        break;
      }
      if (p instanceof ArrayBuffer) {
        captured = new Uint8Array(p);
        break;
      }
    }
    blobSources.set(this, captured);
  }
}
 
(globalThis as any).Blob = CapturingBlob;

vi.mock('@/lib/platform', () => ({
  downloadBlob: async (filename: string, blob: Blob) => {
    downloads.push({
      name: filename,
      size: blob.size,
      bytes: blobSources.get(blob) ?? null,
    });
  },
}));

import {
  ConfigurationsExportBridge,
  type ConfigurationsExportBridgeHandle,
} from '../ConfigurationsExportBridge';

beforeEach(() => {
  downloads.length = 0;
});

// ─── Test helpers ─────────────────────────────────────────────────────────

const fakeStep = (id: string) => `ISO-10303-21;
HEADER;
FILE_NAME('${id}.step','2026-05-29',(''),(''),'','','');
ENDSEC;
DATA;
ENDSEC;
END-ISO-10303-21;
`;

const THREE_CONFIGS = [
  { id: 'c1', name: 'baseline' },
  { id: 'c2', name: 'tall' },
  { id: 'c3', name: 'short' },
] as const;

/** Wrapper that exposes the imperative handle *ref* (not a snapshot)
 *  so tests can read the freshest `ref.current` after every render. */
function HarnessWithHandle(props: {
  partName?: string;
  configs: readonly { id: string; name: string }[];
  exportConfigStep: (id: string) => Promise<string | null>;
  resolveConfigDrawing?: (
    id: string,
  ) => Promise<string | null> | string | null;
  onBundleReady?: (r: {
    zipBytes: Uint8Array;
    manifest: unknown;
    diagnostics: unknown[];
  }) => void;
  onRefReady?: (
    ref: React.RefObject<ConfigurationsExportBridgeHandle | null>,
  ) => void;
}) {
  const ref = useRef<ConfigurationsExportBridgeHandle | null>(null);
  useEffect(() => {
    if (props.onRefReady) {
      props.onRefReady(ref);
    }
    // Only publish the ref once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <ConfigurationsExportBridge
      partName={props.partName ?? 'bracket'}
      configs={props.configs}
      exportConfigStep={props.exportConfigStep}
      resolveConfigDrawing={props.resolveConfigDrawing}
      onBundleReady={props.onBundleReady}
      testHandleRef={ref}
    />
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ConfigurationsExportBridge — empty configs', () => {
  it('Export button is disabled and empty-state message rendered', () => {
    render(
      <ConfigurationsExportBridge
        partName="bracket"
        configs={[]}
        exportConfigStep={async () => fakeStep('x')}
      />,
    );
    const btn = screen.getByTestId(
      'configurations-export-bridge-export',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    const empty = screen.getByTestId('configurations-export-bridge-empty');
    expect(empty.textContent).toContain('No configurations available');

    // No row list rendered when empty.
    expect(
      screen.queryByTestId('configurations-export-bridge-list'),
    ).toBeNull();
  });

  it('count badge reflects 0 configs', () => {
    render(
      <ConfigurationsExportBridge
        partName="bracket"
        configs={[]}
        exportConfigStep={async () => null}
      />,
    );
    const count = screen.getByTestId('configurations-export-bridge-count');
    expect(count.textContent).toMatch(/0/);
  });
});

describe('ConfigurationsExportBridge — happy path (3 configs all OK)', () => {
  it('builds bundle, calls downloadBlob, fires onBundleReady', async () => {
    const exporter = vi.fn(async (id: string) => fakeStep(id));
    const onBundle = vi.fn();

    render(
      <ConfigurationsExportBridge
        partName="bracket"
        configs={THREE_CONFIGS}
        exportConfigStep={exporter}
        onBundleReady={onBundle}
      />,
    );

    const btn = screen.getByTestId(
      'configurations-export-bridge-export',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => expect(downloads).toHaveLength(1));

    // Filename is `${partName}_configs.zip` (slug rule applied).
    expect(downloads[0].name).toBe('bracket_configs.zip');
    expect(downloads[0].size).toBeGreaterThan(0);
    expect(downloads[0].bytes).toBeInstanceOf(Uint8Array);

    // Exporter called once per config.
    expect(exporter).toHaveBeenCalledTimes(3);

    // onBundleReady received the full result.
    await waitFor(() => expect(onBundle).toHaveBeenCalledTimes(1));
    const arg = onBundle.mock.calls[0][0] as {
      zipBytes: Uint8Array;
      manifest: { configCount: number; entries: { status: string }[] };
      diagnostics: unknown[];
    };
    expect(arg.zipBytes).toBeInstanceOf(Uint8Array);
    expect(arg.manifest.configCount).toBe(3);
    expect(arg.manifest.entries.every((e) => e.status === 'ok')).toBe(true);
    expect(arg.diagnostics.length).toBe(0);

    // Status rows all show OK.
    for (const c of THREE_CONFIGS) {
      const row = screen.getByTestId(
        `configurations-export-bridge-row-${c.id}`,
      );
      expect(row.getAttribute('data-status')).toBe('ok');
    }

    // Banner shows 3 ok / 0 failed.
    const banner = screen.getByTestId('configurations-export-bridge-banner');
    expect(banner.textContent).toMatch(/3 ok/);
    expect(banner.textContent).toMatch(/0 failed/);

    // No diagnostics list when nothing failed.
    expect(
      screen.queryByTestId('configurations-export-bridge-diagnostics'),
    ).toBeNull();
  });
});

describe('ConfigurationsExportBridge — partial failure (1/3 returns null)', () => {
  it('bundle still ships, failed row marked, diagnostics rendered', async () => {
    const exporter = vi.fn(async (id: string) => {
      if (id === 'c2') return null; // simulate per-config failure
      return fakeStep(id);
    });
    const onBundle = vi.fn();

    render(
      <ConfigurationsExportBridge
        partName="mix"
        configs={THREE_CONFIGS}
        exportConfigStep={exporter}
        onBundleReady={onBundle}
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('configurations-export-bridge-export'),
      );
    });

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toBe('mix_configs.zip');

    // onBundleReady fired with one failed entry.
    await waitFor(() => expect(onBundle).toHaveBeenCalledTimes(1));
    const arg = onBundle.mock.calls[0][0] as {
      diagnostics: { configId: string; failureReason?: string }[];
    };
    expect(arg.diagnostics).toHaveLength(1);
    expect(arg.diagnostics[0].configId).toBe('c2');
    expect(arg.diagnostics[0].failureReason).toMatch(/null/);

    // Row statuses: c1 ok, c2 failed, c3 ok.
    expect(
      screen
        .getByTestId('configurations-export-bridge-row-c1')
        .getAttribute('data-status'),
    ).toBe('ok');
    expect(
      screen
        .getByTestId('configurations-export-bridge-row-c2')
        .getAttribute('data-status'),
    ).toBe('failed');
    expect(
      screen
        .getByTestId('configurations-export-bridge-row-c3')
        .getAttribute('data-status'),
    ).toBe('ok');

    // Banner counts.
    const banner = screen.getByTestId('configurations-export-bridge-banner');
    expect(banner.textContent).toMatch(/2 ok/);
    expect(banner.textContent).toMatch(/1 failed/);

    // Diagnostics list rendered with c2's row.
    const diags = screen.getByTestId(
      'configurations-export-bridge-diagnostics',
    );
    expect(diags).toBeTruthy();
    expect(
      screen.getByTestId('configurations-export-bridge-diag-c2'),
    ).toBeTruthy();
  });
});

describe('ConfigurationsExportBridge — resolveConfigDrawing', () => {
  it('is called once per config when supplied', async () => {
    const exporter = vi.fn(async (id: string) => fakeStep(id));
    const resolveDrawing = vi.fn(
      async (id: string) => `<svg id="${id}"/>`,
    );

    render(
      <ConfigurationsExportBridge
        partName="drawn"
        configs={THREE_CONFIGS}
        exportConfigStep={exporter}
        resolveConfigDrawing={resolveDrawing}
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('configurations-export-bridge-export'),
      );
    });

    await waitFor(() => expect(downloads).toHaveLength(1));

    expect(resolveDrawing).toHaveBeenCalledTimes(3);
    // Verify each config id passed.
    const calledWith = resolveDrawing.mock.calls.map((c) => c[0]).sort();
    expect(calledWith).toEqual(['c1', 'c2', 'c3']);
  });

  it('handles sync return values from resolveConfigDrawing', async () => {
    const exporter = vi.fn(async (id: string) => fakeStep(id));
    const resolveDrawing = vi.fn((id: string) => `<svg id="${id}"/>`);

    render(
      <ConfigurationsExportBridge
        partName="drawn"
        configs={[THREE_CONFIGS[0]]}
        exportConfigStep={exporter}
        resolveConfigDrawing={resolveDrawing}
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('configurations-export-bridge-export'),
      );
    });

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(resolveDrawing).toHaveBeenCalledTimes(1);
  });
});

describe('ConfigurationsExportBridge — imperative handle', () => {
  it('testHandleRef.triggerExport drives the export without a click', async () => {
    let handleRef: React.RefObject<ConfigurationsExportBridgeHandle | null> | null =
      null;
    const exporter = vi.fn(async (id: string) => fakeStep(id));
    const onBundle = vi.fn();

    render(
      <HarnessWithHandle
        partName="hostmount"
        configs={THREE_CONFIGS}
        exportConfigStep={exporter}
        onBundleReady={onBundle}
        onRefReady={(r) => {
          handleRef = r;
        }}
      />,
    );

    await waitFor(() => expect(handleRef?.current).not.toBeNull());

    await act(async () => {
      await handleRef!.current!.triggerExport();
    });

    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('hostmount_configs.zip');
    expect(onBundle).toHaveBeenCalledTimes(1);

    // Statuses on the *current* ref reflect the final state after the
    // post-export render flushes.
    await waitFor(() => {
      expect(handleRef!.current!.getStatuses().c1).toBe('ok');
    });
    const finalStatuses = handleRef!.current!.getStatuses();
    expect(finalStatuses.c1).toBe('ok');
    expect(finalStatuses.c2).toBe('ok');
    expect(finalStatuses.c3).toBe('ok');
  });

  it('empty configs → triggerExport via handle is a no-op (no download)', async () => {
    let handleRef: React.RefObject<ConfigurationsExportBridgeHandle | null> | null =
      null;
    render(
      <HarnessWithHandle
        configs={[]}
        exportConfigStep={async () => fakeStep('x')}
        onRefReady={(r) => {
          handleRef = r;
        }}
      />,
    );

    await waitFor(() => expect(handleRef?.current).not.toBeNull());

    await act(async () => {
      await handleRef!.current!.triggerExport();
    });

    expect(downloads).toHaveLength(0);
  });
});
