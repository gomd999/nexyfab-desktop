export type DesignExecutionLane = 'ai-design' | 'precision-cad' | 'agentic-cad';
export type RasterDesignKind = 'drawing' | 'photo';

export interface RasterDesignMetrics {
  brightRatio: number;
  lowSaturationRatio: number;
  edgeRatio: number;
  luminanceVariance: number;
}

export interface RasterDesignClassification {
  kind: RasterDesignKind;
  confidence: number;
  metrics: RasterDesignMetrics;
}

const AGENTIC = /(agentic|cad\s*agent|에이전트|자동(?:으로)?\s*(?:수정|실행)|계획.*승인.*실행|エージェント|智能体|agente|وكيل)/i;
const PRECISION = /(정밀\s*cad|정확(?:한|하게)?\s*(?:치수|수정|모델)|기존\s*(?:cad|3d|모델).*수정|step|stp|iges|igs|dxf|precision\s*cad|exact\s*(?:dimension|edit|model)|精密cad|精准cad|cad\s*de\s*precisi[oó]n|cad\s*دقيق)/i;
const COMPLEX = /(복잡|제품\s*구조|조립체|부품\s*(?:구성|구조)|요구사항부터|complex\s*product|assembly|product\s*structure|複雑|复杂产品|producto\s*complejo|منتج\s*معقد)/i;

export function recommendDesignExecutionLane(input: {
  prompt: string;
  hasRasterAttachment?: boolean;
  hasAuthoritativeCad?: boolean;
}): DesignExecutionLane {
  const prompt = input.prompt.trim();
  if (AGENTIC.test(prompt)) return 'agentic-cad';
  if (input.hasAuthoritativeCad || PRECISION.test(prompt)) return 'precision-cad';
  if (input.hasRasterAttachment || COMPLEX.test(prompt)) return 'ai-design';
  return 'ai-design';
}

function bounded(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Deterministic first-pass classifier. It is deliberately conservative:
 * uncertain images are treated as photos, and a drawing pipeline failure is
 * downgraded to the photo/reference path by the caller.
 */
export function classifyRasterDesignMetrics(metrics: RasterDesignMetrics): RasterDesignClassification {
  const bright = bounded(metrics.brightRatio);
  const mono = bounded(metrics.lowSaturationRatio);
  const edges = bounded(metrics.edgeRatio);
  const variance = bounded(metrics.luminanceVariance);
  const usefulEdges = Math.min(1, edges / 0.16);
  const excessiveTexturePenalty = edges > 0.34 ? Math.min(0.35, (edges - 0.34) * 1.5) : 0;
  const drawingScore = bounded(bright * 0.34 + mono * 0.34 + usefulEdges * 0.24 + (1 - variance) * 0.08 - excessiveTexturePenalty);
  const kind: RasterDesignKind = drawingScore >= 0.66 ? 'drawing' : 'photo';
  return {
    kind,
    confidence: Number((kind === 'drawing' ? drawingScore : 1 - drawingScore).toFixed(3)),
    metrics: { brightRatio: bright, lowSaturationRatio: mono, edgeRatio: edges, luminanceVariance: variance },
  };
}

/** Browser-only pixel probe; raw image bytes never leave the selected-file flow. */
export async function classifyRasterDataUrl(dataUrl: string): Promise<RasterDesignClassification> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return classifyRasterDesignMetrics({ brightRatio: 0, lowSaturationRatio: 0, edgeRatio: 0, luminanceVariance: 1 });
  }
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const candidate = new Image();
    candidate.onload = () => resolve(candidate);
    candidate.onerror = () => reject(new Error('RASTER_CLASSIFICATION_DECODE_FAILED'));
    candidate.src = dataUrl;
  });
  const maxSide = 192;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight, 1));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('RASTER_CLASSIFICATION_CANVAS_UNAVAILABLE');
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const luminance = new Float32Array(width * height);
  let bright = 0;
  let lowSaturation = 0;
  let sum = 0;
  let sumSquares = 0;
  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
    const red = pixels[index] ?? 0;
    const green = pixels[index + 1] ?? 0;
    const blue = pixels[index + 2] ?? 0;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const value = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    luminance[pixel] = value;
    if (value >= 224) bright += 1;
    if (saturation <= 0.12) lowSaturation += 1;
    sum += value;
    sumSquares += value * value;
  }
  let edges = 0;
  let edgeSamples = 0;
  for (let y = 1; y < height; y += 1) for (let x = 1; x < width; x += 1) {
    const index = y * width + x;
    const gradient = Math.abs(luminance[index] - luminance[index - 1])
      + Math.abs(luminance[index] - luminance[index - width]);
    if (gradient >= 58) edges += 1;
    edgeSamples += 1;
  }
  const count = Math.max(1, width * height);
  const mean = sum / count;
  const variance = Math.max(0, sumSquares / count - mean * mean) / (255 * 255 * 0.25);
  return classifyRasterDesignMetrics({
    brightRatio: bright / count,
    lowSaturationRatio: lowSaturation / count,
    edgeRatio: edges / Math.max(1, edgeSamples),
    luminanceVariance: variance,
  });
}

export const DESIGN_ENTRY_COPY = {
  kr: {
    recommended: '추천 실행 경로', ai: 'AI 설계', precision: '정밀 CAD 직접', agentic: '에이전트 정밀 CAD',
    drawing: '도면으로 자동 판정', photo: '이미지로 자동 판정', attach: '파일 첨부',
    continue: '선택 경로로 시작', signIn: '로그인 후 계속', opening: '작업공간 준비 중…', reattach: '로그인 후 첨부 파일을 다시 선택해 주세요.',
  },
  en: { recommended: 'Recommended path', ai: 'AI design', precision: 'Direct precision CAD', agentic: 'Agentic precision CAD', drawing: 'Detected as drawing', photo: 'Detected as image', attach: 'Attach file', continue: 'Start selected path', signIn: 'Sign in to continue', opening: 'Preparing workspace…', reattach: 'Select the attachment again after signing in.' },
  ja: { recommended: '推奨実行経路', ai: 'AI設計', precision: '精密CADへ直接', agentic: 'エージェント精密CAD', drawing: '図面として自動判定', photo: '画像として自動判定', attach: 'ファイル添付', continue: '選択した経路で開始', signIn: 'ログインして続行', opening: '作業空間を準備中…', reattach: 'ログイン後、添付ファイルをもう一度選択してください。' },
  cn: { recommended: '推荐执行路径', ai: 'AI设计', precision: '直接进入精密CAD', agentic: '智能体精密CAD', drawing: '自动识别为图纸', photo: '自动识别为图像', attach: '附加文件', continue: '按所选路径开始', signIn: '登录后继续', opening: '正在准备工作区…', reattach: '登录后请重新选择附件。' },
  es: { recommended: 'Ruta recomendada', ai: 'Diseño con IA', precision: 'CAD de precisión directo', agentic: 'CAD de precisión agéntico', drawing: 'Detectado como plano', photo: 'Detectado como imagen', attach: 'Adjuntar archivo', continue: 'Iniciar ruta seleccionada', signIn: 'Inicia sesión para continuar', opening: 'Preparando espacio de trabajo…', reattach: 'Vuelve a seleccionar el archivo después de iniciar sesión.' },
  ar: { recommended: 'مسار التنفيذ المقترح', ai: 'تصميم بالذكاء الاصطناعي', precision: 'CAD دقيق مباشر', agentic: 'CAD دقيق وكيلي', drawing: 'تم اكتشافه كمخطط', photo: 'تم اكتشافه كصورة', attach: 'إرفاق ملف', continue: 'بدء المسار المحدد', signIn: 'سجّل الدخول للمتابعة', opening: 'جارٍ إعداد مساحة العمل…', reattach: 'أعد تحديد الملف المرفق بعد تسجيل الدخول.' },
} as const;
