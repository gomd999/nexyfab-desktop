/**
 * webgpuComputeScaffold.ts — WebGPU compute pipeline scaffolding.
 *
 * Generates and runs WGSL compute shaders for tasks that benefit
 * from GPU parallelism: voxel boolean ops, mesh smoothing, marching
 * cubes, FEA matrix multiply, lattice density baking.
 *
 * This module ships the *scaffold* — the dispatch helpers and buffer
 * management — not domain-specific shaders. Callers provide their
 * own WGSL source.
 *
 * Lifecycle:
 *
 *   1. **Acquire adapter + device** (browser only; in a Node test
 *      environment we fall back to no-op stubs).
 *   2. **Create buffers** for input / output / uniforms.
 *   3. **Compile shader module** from WGSL source.
 *   4. **Build pipeline + bind groups**.
 *   5. **Dispatch** with workgroup count.
 *   6. **Read back** results via map-async on a staging buffer.
 *
 * Helpers handle padding, alignment (storage buffers must be
 * 4-byte aligned), and bind-group layout selection.
 */

export type ComputeBufferKind = 'storage' | 'storage-read' | 'uniform';

export interface ComputeBufferSpec {
  /** Binding index in the WGSL shader (must match `@binding(N)`). */
  binding: number;
  /** Buffer kind. */
  kind: ComputeBufferKind;
  /** Optional initial CPU data; sets the buffer size if `sizeBytes` is omitted. */
  data?: Uint8Array | Float32Array | Uint32Array | Int32Array;
  /** Explicit size override. */
  sizeBytes?: number;
}

export interface ComputeDispatchSpec {
  /** WGSL shader source. */
  source: string;
  /** Entry point in the shader (defaults to `main`). */
  entryPoint?: string;
  /** Buffer specs. */
  buffers: ComputeBufferSpec[];
  /** Workgroup count along each dimension. */
  workgroups: [number, number, number];
  /** Bind-group index used by the shader. Defaults to 0. */
  bindGroup?: number;
}

export interface ComputeResult {
  /** Per-binding output bytes (only filled for `storage` / `storage-read` buffers). */
  outputs: Map<number, ArrayBuffer>;
  /** Wall-clock time spent dispatching (ms). */
  dispatchTimeMs: number;
}

// ── WebGPU availability check ──────────────────────────────────

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

// ── Top-level entry ─────────────────────────────────────────────

export async function dispatchCompute(spec: ComputeDispatchSpec): Promise<ComputeResult> {
  if (!isWebGpuAvailable()) {
    throw new Error('WebGPU not available — fall back to CPU path');
  }
  const navAny = navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } };
  const adapter = await navAny.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const adapterAny = adapter as { requestDevice: () => Promise<GpuDevice> };
  const device = await adapterAny.requestDevice();
  const t0 = nowMs();
  const outputs = await runWithDevice(device, spec);
  return { outputs, dispatchTimeMs: nowMs() - t0 };
}

function nowMs(): number {
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

// Generic GPU type stubs (we don't depend on @webgpu/types).
type GpuDevice = {
  createBuffer: (desc: { size: number; usage: number; mappedAtCreation?: boolean }) => GpuBuffer;
  createShaderModule: (desc: { code: string }) => GpuShader;
  createBindGroupLayout: (desc: unknown) => GpuLayout;
  createPipelineLayout: (desc: { bindGroupLayouts: GpuLayout[] }) => GpuLayout;
  createComputePipeline: (desc: unknown) => GpuPipeline;
  createBindGroup: (desc: unknown) => GpuBindGroup;
  createCommandEncoder: () => GpuEncoder;
  queue: { submit: (cmds: unknown[]) => void; writeBuffer: (buf: GpuBuffer, off: number, data: ArrayBuffer | ArrayBufferView) => void };
};
type GpuBuffer = { mapAsync: (mode: number) => Promise<void>; getMappedRange: () => ArrayBuffer; unmap: () => void; size: number };
type GpuShader = unknown;
type GpuLayout = unknown;
type GpuPipeline = { getBindGroupLayout: (i: number) => GpuLayout };
type GpuBindGroup = unknown;
type GpuEncoder = {
  beginComputePass: () => { setPipeline: (p: GpuPipeline) => void; setBindGroup: (i: number, g: GpuBindGroup) => void; dispatchWorkgroups: (x: number, y: number, z: number) => void; end: () => void };
  copyBufferToBuffer: (src: GpuBuffer, srcOff: number, dst: GpuBuffer, dstOff: number, size: number) => void;
  finish: () => unknown;
};

// WebGPU flag constants (must match the spec).
const GPUBufferUsage = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  STORAGE: 0x0080,
  UNIFORM: 0x0040,
};
const GPUMapMode = { READ: 0x0001, WRITE: 0x0002 };

async function runWithDevice(device: GpuDevice, spec: ComputeDispatchSpec): Promise<Map<number, ArrayBuffer>> {
  const buffers = new Map<number, GpuBuffer>();
  const stagingBuffers = new Map<number, GpuBuffer>();
  for (const b of spec.buffers) {
    const usage = b.kind === 'uniform'
      ? GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const size = paddedSize(b.sizeBytes ?? (b.data ? b.data.byteLength : 4));
    const gpu = device.createBuffer({ size, usage });
    buffers.set(b.binding, gpu);
    if (b.data) device.queue.writeBuffer(gpu, 0, b.data);
    if (b.kind !== 'uniform') {
      const staging = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      stagingBuffers.set(b.binding, staging);
    }
  }

  const shader = device.createShaderModule({ code: spec.source });

  // Layout: derive from spec buffers.
  const bindGroupLayoutEntries = spec.buffers.map(b => ({
    binding: b.binding,
    visibility: 0x4, // GPUShaderStage.COMPUTE
    buffer: { type: b.kind === 'uniform' ? 'uniform' : 'storage' },
  }));
  const bindGroupLayout = device.createBindGroupLayout({ entries: bindGroupLayoutEntries });

  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: { module: shader, entryPoint: spec.entryPoint ?? 'main' },
  } as unknown);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(spec.bindGroup ?? 0),
    entries: spec.buffers.map(b => ({ binding: b.binding, resource: { buffer: buffers.get(b.binding)! } })),
  } as unknown);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(spec.bindGroup ?? 0, bindGroup);
  pass.dispatchWorkgroups(spec.workgroups[0], spec.workgroups[1], spec.workgroups[2]);
  pass.end();
  // Copy storage outputs into staging buffers for readback.
  for (const b of spec.buffers) {
    const staging = stagingBuffers.get(b.binding);
    if (staging) encoder.copyBufferToBuffer(buffers.get(b.binding)!, 0, staging, 0, staging.size);
  }
  device.queue.submit([encoder.finish()]);

  const outputs = new Map<number, ArrayBuffer>();
  for (const [binding, staging] of stagingBuffers) {
    await staging.mapAsync(GPUMapMode.READ);
    const range = staging.getMappedRange();
    outputs.set(binding, range.slice(0));
    staging.unmap();
  }
  return outputs;
}

// ── Size padding ───────────────────────────────────────────────

export function paddedSize(bytes: number, alignment: number = 4): number {
  return Math.ceil(bytes / alignment) * alignment;
}

// ── Workgroup helper ───────────────────────────────────────────

/** Convenience: compute workgroup count for a 1D problem given total
 *  element count and workgroup size declared in shader. */
export function workgroupCount1D(totalElements: number, workgroupSize: number): [number, number, number] {
  return [Math.ceil(totalElements / workgroupSize), 1, 1];
}

export function workgroupCount3D(
  total: [number, number, number],
  size: [number, number, number],
): [number, number, number] {
  return [
    Math.ceil(total[0] / size[0]),
    Math.ceil(total[1] / size[1]),
    Math.ceil(total[2] / size[2]),
  ];
}

// ── Common WGSL snippet builders ────────────────────────────────

/** Generate a WGSL "elementwise" shader: takes input + output arrays and
 *  applies a per-element transform `expr`. */
export function buildElementwiseShader(opts: {
  inputBinding: number;
  outputBinding: number;
  /** WGSL type (e.g. "f32", "u32"). */
  elementType: string;
  /** Workgroup size. */
  workgroupSize: number;
  /** WGSL expression on input[i]. e.g. "input[i] * 2.0". */
  expression: string;
}): string {
  return `
@group(0) @binding(${opts.inputBinding}) var<storage, read> input : array<${opts.elementType}>;
@group(0) @binding(${opts.outputBinding}) var<storage, read_write> output : array<${opts.elementType}>;

@compute @workgroup_size(${opts.workgroupSize})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&input)) { return; }
  output[i] = ${opts.expression};
}
`;
}

/** Build a 3D index helper for processing a voxel grid in WGSL. */
export function buildVoxelGridShader(opts: {
  inputBinding: number;
  outputBinding: number;
  /** Workgroup size (8,8,8 typical). */
  workgroupSize: [number, number, number];
  /** Expression on `input[k * dimX * dimY + j * dimX + i]`. */
  expression: string;
  /** Uniform binding for grid dimensions. */
  uniformBinding: number;
}): string {
  return `
struct Uniforms {
  dimX : u32,
  dimY : u32,
  dimZ : u32,
};
@group(0) @binding(${opts.uniformBinding}) var<uniform> u : Uniforms;
@group(0) @binding(${opts.inputBinding}) var<storage, read> input : array<f32>;
@group(0) @binding(${opts.outputBinding}) var<storage, read_write> output : array<f32>;

@compute @workgroup_size(${opts.workgroupSize[0]},${opts.workgroupSize[1]},${opts.workgroupSize[2]})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= u.dimX || gid.y >= u.dimY || gid.z >= u.dimZ) { return; }
  let idx = gid.z * u.dimX * u.dimY + gid.y * u.dimX + gid.x;
  output[idx] = ${opts.expression};
}
`;
}

// ── Capability detection ───────────────────────────────────────

export interface GpuCapabilities {
  available: boolean;
  /** Max workgroup size (X dimension). */
  maxWorkgroupSizeX?: number;
  /** Max storage buffer binding size. */
  maxStorageBufferBindingSize?: number;
  /** Adapter name if exposed. */
  adapterName?: string;
}

export async function detectGpuCapabilities(): Promise<GpuCapabilities> {
  if (!isWebGpuAvailable()) return { available: false };
  const navAny = navigator as unknown as { gpu: { requestAdapter: () => Promise<{ limits?: Record<string, number>; info?: { description?: string } } | null> } };
  const adapter = await navAny.gpu.requestAdapter();
  if (!adapter) return { available: false };
  const out: GpuCapabilities = { available: true };
  if (adapter.limits) {
    if (adapter.limits.maxComputeWorkgroupSizeX !== undefined) out.maxWorkgroupSizeX = adapter.limits.maxComputeWorkgroupSizeX;
    if (adapter.limits.maxStorageBufferBindingSize !== undefined) out.maxStorageBufferBindingSize = adapter.limits.maxStorageBufferBindingSize;
  }
  if (adapter.info?.description) out.adapterName = adapter.info.description;
  return out;
}
