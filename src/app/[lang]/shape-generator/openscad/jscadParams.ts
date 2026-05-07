/**
 * jscadParams.ts — JSCAD 코드에서 숫자 파라미터를 추출하고 슬라이더 UI용 메타데이터를 생성
 *
 * 추출 대상: `const width = 50;` 또는 `const r = 3.3;` 형태
 * 편집 결과: 원래 코드에서 해당 숫자값을 교체해서 반환
 */

export interface JscadParam {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string; // 'mm' | ''
}

const UNIT_HINT: Record<string, string> = {
  width: 'mm', height: 'mm', depth: 'mm', length: 'mm', thickness: 'mm',
  radius: 'mm', diameter: 'mm', r: 'mm', d: 'mm', w: 'mm', h: 'mm',
  teeth: '', segments: '', count: '', n: '', module: 'mm', pitch: 'mm',
  angle: '°', draft: '°',
};

function inferRange(name: string, value: number): { min: number; max: number; step: number } {
  const lower = name.toLowerCase();
  if (lower.includes('angle') || lower.includes('draft')) {
    return { min: 0, max: 180, step: 1 };
  }
  if (lower === 'segments' || lower === 'count' || lower === 'n' || lower === 'teeth') {
    return { min: 3, max: 128, step: 1 };
  }
  // Dimensional params: allow 10%–500% of current value, minimum 0.5
  const lo = Math.max(0.5, Math.round(value * 0.1 * 10) / 10);
  const hi = Math.round(value * 5 * 10) / 10;
  const step = value >= 10 ? 1 : value >= 1 ? 0.5 : 0.1;
  return { min: lo, max: hi, step };
}

/**
 * Extract top-level `const <name> = <number>;` declarations from JSCAD code.
 * Returns at most 12 params to keep the UI manageable.
 */
export function extractParams(code: string): JscadParam[] {
  const params: JscadParam[] = [];
  // Match: const <identifier> = <number>;
  const re = /\bconst\s+([a-zA-Z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;/g;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = re.exec(code)) !== null) {
    const name = match[1];
    const value = parseFloat(match[2]);
    if (seen.has(name) || isNaN(value)) continue;
    seen.add(name);

    const unit = UNIT_HINT[name] ?? (value > 0.5 ? 'mm' : '');
    const range = inferRange(name, value);
    params.push({ name, value, unit, ...range });
    if (params.length >= 12) break;
  }

  return params;
}

/**
 * Replace the value of a specific `const <name> = ...;` declaration in the code.
 */
export function updateParam(code: string, name: string, newValue: number): string {
  // Only replace top-level const declarations (non-greedy)
  const re = new RegExp(`(\\bconst\\s+${name}\\s*=\\s*)(-?\\d+(?:\\.\\d+)?)(\\s*;)`, 'g');
  return code.replace(re, `$1${newValue}$3`);
}
