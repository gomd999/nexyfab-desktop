/**
 * G-code emitter with pluggable post-processors.
 *
 * Consumes the polylines produced by `camLite.generateCAMToolpaths` and emits
 * a .nc program for the selected controller dialect (LinuxCNC, Fanuc, Mazak,
 * Haas). The controller-specific header/footer/tool-change ceremony lives in
 * `./postProcessors/*`; this file owns the toolpath walk.
 *
 * Coordinate system: millimetres, absolute, XY plane. Z is the tool axis
 * (pointing up, so "down into the work" = decreasing Z). Our toolpaths come
 * from Three.js where Y is up, so we map (x, z, y) → (X, Y, Z) at emit time.
 */

import * as THREE from 'three';
import type { CAMOperation, CAMResult } from './camLite';
import { getPostProcessor, type PostContext } from './postProcessors';
import type { PostProcessor } from './postProcessors/types';

export interface GcodeOptions {
  /** Safe rapid-travel plane above stock (mm). Default 5 mm above the highest Z. */
  safeZ?: number;
  /** Coolant on? M08 flood / M09 off. Default true. */
  coolant?: boolean;
  /** Program number header. Default 1. */
  programNumber?: number;
  /** Program name shown in controller DIR / header comment. */
  programName?: string;
  /** Units: 'mm' → G21, 'inch' → G20. Default 'mm'. */
  units?: 'mm' | 'inch';
  /** Pretty header comments. Default true. */
  comments?: boolean;
  /** Post-processor id — 'linuxcnc' | 'fanuc' | 'mazak' | 'haas'. Default 'linuxcnc'. */
  postProcessor?: string;
  /** Tool number in the carousel. Default 1. */
  toolNumber?: number;
}

export interface GcodeEmitResult {
  code: string;
  lineCount: number;
  /** Estimated number of distinct rapid + feed moves (not counting modal changes) */
  moveCount: number;
  /** Post-processor that generated this output. */
  postProcessorId: string;
  /** File extension recommended for this dialect. */
  fileExtension: string;
}

export function toGcode(
  result: CAMResult,
  operation: CAMOperation,
  options: GcodeOptions = {},
): GcodeEmitResult {
  const post: PostProcessor = getPostProcessor(options.postProcessor);

  const safeZ = options.safeZ ?? computeSafeZ(result.toolpaths);
  const ctx: PostContext = {
    programNumber: options.programNumber ?? 1,
    programName: options.programName ?? 'NEXYFAB',
    units: options.units ?? 'mm',
    safeZ,
    coolant: options.coolant ?? true,
    toolNumber: options.toolNumber ?? 1,
    toolDiameter: operation.toolDiameter,
    spindleSpeed: operation.spindleSpeed,
    feedRate: operation.feedRate,
    operationType: operation.type,
    totalLengthMm: result.totalLength,
    estimatedTimeMin: result.estimatedTime,
    warnings: [...result.warnings],
    comments: options.comments ?? true,
  };

  const lines: string[] = [];
  const push = (s: string) => lines.push(s);
  const pushAll = (xs: string[]) => { for (const x of xs) lines.push(x); };

  let moves = 0;

  pushAll(post.formatProgramNumber(ctx));
  pushAll(post.modalSetup(ctx));
  pushAll(post.toolChange(ctx));
  pushAll(post.spindleStart(ctx));
  pushAll(post.approachStart(ctx));

  let prevFeed: number | null = null;
  const feedRate = operation.feedRate;

  for (const path of result.toolpaths) {
    if (path.length === 0) continue;
    const first = mapPoint(path[0]);
    push(`G00 Z${fmt(safeZ)}`);
    push(`G00 X${fmt(first.x)} Y${fmt(first.y)}`);
    moves++;
    const plungeFeed = Math.max(50, Math.round(feedRate / 2));
    push(`G01 Z${fmt(first.z)} F${plungeFeed}`);
    prevFeed = plungeFeed;
    moves++;
    for (let i = 1; i < path.length; i++) {
      const p = mapPoint(path[i]);
      if (prevFeed !== feedRate) {
        push(`G01 X${fmt(p.x)} Y${fmt(p.y)} Z${fmt(p.z)} F${feedRate}`);
        prevFeed = feedRate;
      } else {
        push(`G01 X${fmt(p.x)} Y${fmt(p.y)} Z${fmt(p.z)}`);
      }
      moves++;
    }
    push(`G00 Z${fmt(safeZ)}`);
  }

  pushAll(post.programEnd(ctx));

  return {
    code: lines.join('\n'),
    lineCount: lines.length,
    moveCount: moves,
    postProcessorId: post.id,
    fileExtension: post.fileExtension,
  };
}

/** Browser / Tauri save — triggers download or native save of the emitted G-code. */
export async function downloadGcode(filename: string, code: string, extension: string = 'nc'): Promise<void> {
  const { downloadBlob } = await import('@/lib/platform');
  const name = (filename || 'nexyfab-program').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
  const blob = new Blob([code], { type: 'text/plain' });
  const ext = '.' + extension.replace(/^\.+/, '');
  const outName = name.toLowerCase().endsWith(ext) ? name : name + ext;
  await downloadBlob(outName, blob);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Three.js uses Y-up; map to CNC axes where Z is the tool axis. */
function mapPoint(v: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.z, z: v.y };
}

/** Pick a safe-Z at least 5 mm above the highest toolpath Z (post-axis-map). */
function computeSafeZ(paths: THREE.Vector3[][]): number {
  let maxZ = 0;
  for (const path of paths) {
    for (const v of path) {
      if (v.y > maxZ) maxZ = v.y;
    }
  }
  return maxZ + 5;
}

/** 3-decimal fixed output — typical CNC resolution; strips -0. */
function fmt(n: number): string {
  if (Object.is(n, -0)) n = 0;
  return n.toFixed(3);
}
