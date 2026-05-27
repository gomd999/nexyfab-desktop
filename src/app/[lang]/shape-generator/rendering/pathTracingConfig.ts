/**
 * pathTracingConfig.ts — Render quality configuration.
 *
 * NexyFab uses Three.js for real-time preview but offers a higher-
 * quality "photo render" mode via a path tracer (three-gpu-pathtracer
 * or a similar). This module defines the user-facing config that
 * drives the offline render.
 *
 * Five presets cover most use cases:
 *   - "preview": fast feedback while tweaking material/lighting
 *   - "draft":   shareable inline preview
 *   - "standard": product shot for portfolio / marketing
 *   - "hero":    high-quality hero render for landing page
 *   - "production": maximum quality for print / cover image
 */

export type RenderPreset = 'preview' | 'draft' | 'standard' | 'hero' | 'production';

export interface PathTracingConfig {
  /** Spp = samples per pixel. Higher = less noise. */
  samplesPerPixel: number;
  /** Maximum ray bounces (path depth). */
  maxBounces: number;
  /** Output resolution (longer side, pixels). */
  resolution: number;
  /** Output aspect ratio (W:H). */
  aspectRatio: '1:1' | '4:3' | '16:9' | '21:9' | '9:16';
  /** Tone-map operator name. */
  toneMapping: 'aces' | 'reinhard' | 'reinhard-extended' | 'filmic' | 'linear';
  /** Exposure (EV stops, positive = brighter). */
  exposure: number;
  /** Denoise after rendering? Often acceptable to enable. */
  denoise: boolean;
  /** Anti-aliasing — multi-sample anti-aliasing inside the path tracer. */
  aa: 'off' | 'fxaa' | '4xmsaa' | 'temporal';
  /** Optional bloom toggle. */
  bloom: boolean;
  /** Background environment intensity multiplier. */
  envIntensity: number;
}

export const PRESETS: Record<RenderPreset, PathTracingConfig> = {
  preview: {
    samplesPerPixel: 16, maxBounces: 4, resolution: 720, aspectRatio: '16:9',
    toneMapping: 'aces', exposure: 0, denoise: true, aa: 'fxaa', bloom: false, envIntensity: 1.0,
  },
  draft: {
    samplesPerPixel: 64, maxBounces: 6, resolution: 1080, aspectRatio: '16:9',
    toneMapping: 'aces', exposure: 0, denoise: true, aa: 'fxaa', bloom: true, envIntensity: 1.0,
  },
  standard: {
    samplesPerPixel: 256, maxBounces: 8, resolution: 1920, aspectRatio: '16:9',
    toneMapping: 'aces', exposure: 0, denoise: true, aa: '4xmsaa', bloom: true, envIntensity: 1.0,
  },
  hero: {
    samplesPerPixel: 1024, maxBounces: 12, resolution: 2560, aspectRatio: '16:9',
    toneMapping: 'aces', exposure: 0.3, denoise: true, aa: '4xmsaa', bloom: true, envIntensity: 1.0,
  },
  production: {
    samplesPerPixel: 4096, maxBounces: 16, resolution: 4096, aspectRatio: '16:9',
    toneMapping: 'aces', exposure: 0.5, denoise: false, aa: '4xmsaa', bloom: true, envIntensity: 1.0,
  },
};

/** Compute output resolution as [width, height] given aspect + longer-side resolution. */
export function resolveResolution(config: PathTracingConfig): [number, number] {
  const [a, b] = config.aspectRatio.split(':').map(Number) as [number, number];
  if (a >= b) {
    return [config.resolution, Math.round(config.resolution * b / a)];
  }
  return [Math.round(config.resolution * a / b), config.resolution];
}

/** Estimate render time (seconds) — rough scaling for the UI. */
export function estimateRenderTime(config: PathTracingConfig): number {
  const [w, h] = resolveResolution(config);
  const pixels = w * h;
  // Rough empirical: 1e-6 sec per (pixel × spp × bounce) on mid-range GPU.
  return (pixels * config.samplesPerPixel * config.maxBounces) * 1e-7;
}

/** Validation — clamp absurd inputs to safe range. */
export function clampConfig(config: PathTracingConfig): PathTracingConfig {
  return {
    ...config,
    samplesPerPixel: Math.max(1, Math.min(16384, Math.round(config.samplesPerPixel))),
    maxBounces: Math.max(1, Math.min(32, Math.round(config.maxBounces))),
    resolution: Math.max(64, Math.min(8192, Math.round(config.resolution))),
    exposure: Math.max(-10, Math.min(10, config.exposure)),
    envIntensity: Math.max(0, Math.min(10, config.envIntensity)),
  };
}
