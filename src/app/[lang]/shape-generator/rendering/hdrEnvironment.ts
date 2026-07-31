/**
 * hdrEnvironment.ts — HDR environment-map catalogue + IBL helpers.
 *
 * Image-Based Lighting (IBL) is the standard "studio lighting" approach
 * for product visualisation: instead of placing individual lights, a
 * spherical HDR photograph wraps the scene and the renderer integrates
 * incoming radiance from every direction. For a CAD viewer this means
 * the user can pick "showroom", "outdoor noon", "softbox studio" from
 * a dropdown and get believable specular reflections + ambient light
 * automatically.
 *
 * Module scope:
 *   - Static catalogue of curated environment presets with metadata
 *     (preview thumbnail URL, exposure hint, mood tag).
 *   - HDR loading helpers — fetch a `.hdr` URL into a tone-mappable
 *     texture, with size caps so a 8k HDR doesn't OOM mobile.
 *   - Convolution placeholders — the actual prefiltering happens via
 *     three.js's PMREMGenerator at the renderer layer; this module
 *     just exposes the input parameters so callers can pre-build them.
 *
 * The actual texture loading uses RGBELoader (three.js stdlib) at
 * import time on the renderer side; we keep this module loader-free
 * so it stays unit-testable without a DOM / WebGL context.
 */

export type EnvironmentMood = 'studio' | 'outdoor' | 'sunset' | 'indoor' | 'industrial' | 'neutral';

export interface HdrEnvironmentPreset {
  /** Stable id used in URL params + serialised render settings. */
  id: string;
  /** Display name. */
  name: { ko: string; en: string; ja: string; zh: string; es: string; ar: string };
  /** Path to the HDR file (relative to /public). */
  hdrUrl: string;
  /** Path to a 256×128 LDR preview thumbnail. */
  thumbUrl: string;
  /** Mood tag for the picker's filter chips. */
  mood: EnvironmentMood;
  /** Recommended exposure offset (in EV stops) for this preset. */
  defaultExposure: number;
  /** Whether the environment should be drawn as the scene background.
   *  False = environment is light-only (no skybox shown). */
  showAsBackground: boolean;
  /** Approximate dominant colour for the UI swatch / instant preview. */
  swatch: string;
}

/** Curated catalogue. Replace `*.hdr` paths with real assets at deploy
 *  time; the module just publishes the catalogue shape. */
export const HDR_PRESETS: HdrEnvironmentPreset[] = [
  {
    id: 'studio-softbox',
    name: { ko: '스튜디오 (소프트박스)', en: 'Studio (Softbox)', ja: 'スタジオ (ソフトボックス)', zh: '影棚（柔光箱）', es: 'Estudio (softbox)', ar: 'استوديو (صندوق إضاءة)' },
    hdrUrl: '/hdr/studio_softbox_1k.hdr',
    thumbUrl: '/hdr/studio_softbox_thumb.png',
    mood: 'studio',
    defaultExposure: 0,
    showAsBackground: false,
    swatch: '#f0f0f0',
  },
  {
    id: 'showroom',
    name: { ko: '쇼룸', en: 'Showroom', ja: 'ショールーム', zh: '展厅', es: 'Sala de exposición', ar: 'صالة عرض' },
    hdrUrl: '/hdr/showroom_1k.hdr',
    thumbUrl: '/hdr/showroom_thumb.png',
    mood: 'indoor',
    defaultExposure: 0.5,
    showAsBackground: true,
    swatch: '#e8e8ed',
  },
  {
    id: 'outdoor-noon',
    name: { ko: '실외 정오', en: 'Outdoor (Noon)', ja: '屋外 (正午)', zh: '室外（正午）', es: 'Exterior (mediodía)', ar: 'خارجي (الظهيرة)' },
    hdrUrl: '/hdr/outdoor_noon_1k.hdr',
    thumbUrl: '/hdr/outdoor_noon_thumb.png',
    mood: 'outdoor',
    defaultExposure: -1.0,
    showAsBackground: true,
    swatch: '#a3c8ff',
  },
  {
    id: 'sunset',
    name: { ko: '석양', en: 'Sunset', ja: '夕焼け', zh: '日落', es: 'Atardecer', ar: 'الغروب' },
    hdrUrl: '/hdr/sunset_1k.hdr',
    thumbUrl: '/hdr/sunset_thumb.png',
    mood: 'sunset',
    defaultExposure: -0.5,
    showAsBackground: true,
    swatch: '#ffb274',
  },
  {
    id: 'industrial-warehouse',
    name: { ko: '산업 창고', en: 'Industrial Warehouse', ja: '工業倉庫', zh: '工业仓库', es: 'Nave industrial', ar: 'مستودع صناعي' },
    hdrUrl: '/hdr/warehouse_1k.hdr',
    thumbUrl: '/hdr/warehouse_thumb.png',
    mood: 'industrial',
    defaultExposure: 0,
    showAsBackground: false,
    swatch: '#7a7a82',
  },
  {
    id: 'neutral-grey',
    name: { ko: '중성 회색', en: 'Neutral Grey', ja: 'ニュートラルグレー', zh: '中性灰', es: 'Gris neutro', ar: 'رمادي محايد' },
    hdrUrl: '/hdr/neutral_grey_1k.hdr',
    thumbUrl: '/hdr/neutral_grey_thumb.png',
    mood: 'neutral',
    defaultExposure: 0,
    showAsBackground: false,
    swatch: '#808080',
  },
  {
    id: 'cloudy-sky',
    name: { ko: '흐린 하늘', en: 'Cloudy Sky', ja: '曇り空', zh: '阴天', es: 'Cielo nublado', ar: 'سماء غائمة' },
    hdrUrl: '/hdr/cloudy_sky_1k.hdr',
    thumbUrl: '/hdr/cloudy_sky_thumb.png',
    mood: 'outdoor',
    defaultExposure: -0.5,
    showAsBackground: true,
    swatch: '#c2c8d0',
  },
];

/** Lookup by id. */
export function findHdrPreset(id: string): HdrEnvironmentPreset | null {
  return HDR_PRESETS.find(p => p.id === id) ?? null;
}

/** Filter the catalogue by mood (or 'all'). */
export function listHdrPresets(mood?: EnvironmentMood | 'all'): HdrEnvironmentPreset[] {
  if (!mood || mood === 'all') return HDR_PRESETS.slice();
  return HDR_PRESETS.filter(p => p.mood === mood);
}

/** Cap on HDR texture size in pixels per axis. Anything larger gets
 *  downsampled at load time to prevent OOM on mobile / low-end GPUs. */
export const MAX_HDR_DIMENSION = 2048;

/** Reasonable PMREM (prefiltered mipmap) settings per quality preset.
 *  The renderer feeds these into THREE.PMREMGenerator. */
export interface PmremConfig {
  /** Number of roughness levels to bake. Lower = faster, blockier reflections. */
  levels: number;
  /** Cubemap resolution per face. */
  cubeSize: number;
}

export const PMREM_PRESETS: Record<'preview' | 'standard' | 'hiQuality', PmremConfig> = {
  preview:    { levels: 5, cubeSize: 128 },
  standard:   { levels: 7, cubeSize: 256 },
  hiQuality:  { levels: 8, cubeSize: 512 },
};

/** Pick a PMREM config given a quality preset key — falls back to
 *  `standard` for unknown keys. */
export function pmremConfigFor(quality: string): PmremConfig {
  if (quality === 'preview' || quality === 'standard' || quality === 'hiQuality') {
    return PMREM_PRESETS[quality];
  }
  return PMREM_PRESETS.standard;
}
