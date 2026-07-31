/**
 * materialImport — **재료 물성을 파일(CSV/표)로 인입**한다 (260801, 격차 항목 P6).
 *
 * ## 왜 「관대한 파서」를 만들면 안 되는가
 * 이 값들은 그대로 **FEA 로 들어가 안전율이 된다.** 그래서 흔한 파서 관행이 여기서는
 * 전부 위험하다:
 * ```
 *   빈 칸 → 0        항복강도 0 은 「무한히 약한 재료」다. 안전율이 0 이 되어
 *                    「위험」으로 보이지만, 실제로는 **입력이 없었을 뿐**이다.
 *   숫자 아님 → NaN   NaN 은 비교에서 전부 false 라 게이트를 **조용히 통과**한다.
 *   단위 추측        MPa 인지 psi 인지 모르면서 넘기면 6.9배 틀린 설계가 나간다.
 * ```
 * ⚠ 그래서 이 모듈은 **채우지 않는다.** 이상하면 **그 행을 거부하고 이유를 남긴다.**
 *   부분 성공을 허용하되, 무엇이 왜 빠졌는지 호출측이 반드시 볼 수 있게 한다.
 *
 * ## 단위
 * 헤더에 단위를 적게 하고, **모르는 단위는 거부한다**(추측 금지).
 * 지원: `MPa` · `GPa`(→MPa) · `kg/m3` · `g/cm3`(→kg/m³) · `W/mK` · `%` · `C`
 */

/** 최소 요구 물성 — 이게 없으면 FEA 에 못 쓴다. */
const REQUIRED = ['id', 'nameKo', 'densityKgM3', 'tensileStrengthMPa', 'yieldStrengthMPa'] as const;

/**
 * 물리적으로 말이 되는 범위. **벗어나면 거부한다.**
 * ⚠ 「넉넉하게 잡아 통과시키자」는 유혹을 막는다 — 오타 한 자리(2050 → 20500)가
 *   안전율을 10배로 만든다. 상한은 실제 공학 재료의 최대치보다 약간 위로만 둔다.
 */
const RANGE: Record<string, { min: number; max: number; unit: string }> = {
  densityKgM3: { min: 10, max: 25000, unit: 'kg/m³' },        // 폼 ~ 텅스텐
  tensileStrengthMPa: { min: 0.1, max: 8000, unit: 'MPa' },   // 고무 ~ 초고장력강
  yieldStrengthMPa: { min: 0.1, max: 8000, unit: 'MPa' },
  elongationPct: { min: 0, max: 2000, unit: '%' },
  thermalConductivity: { min: 0.005, max: 3000, unit: 'W/m·K' }, // 에어로젤 ~ 다이아몬드
  maxTempC: { min: -273, max: 4000, unit: '°C' },
  minTempC: { min: -273, max: 4000, unit: '°C' },
};

/** 단위 환산 — **아는 것만.** 모르는 단위는 여기 없고, 없으면 거부된다. */
const UNIT_FACTOR: Record<string, Record<string, number>> = {
  densityKgM3: { 'kg/m3': 1, 'kg/m³': 1, 'g/cm3': 1000, 'g/cm³': 1000, 't/m3': 1000 },
  tensileStrengthMPa: { mpa: 1, 'n/mm2': 1, 'n/mm²': 1, gpa: 1000, kpa: 0.001 },
  yieldStrengthMPa: { mpa: 1, 'n/mm2': 1, 'n/mm²': 1, gpa: 1000, kpa: 0.001 },
  thermalConductivity: { 'w/mk': 1, 'w/m·k': 1, 'w/(m·k)': 1 },
};

export interface ImportedMaterial {
  id: string;
  nameKo: string;
  nameEn?: string;
  densityKgM3: number;
  tensileStrengthMPa: number;
  yieldStrengthMPa: number;
  elongationPct?: number;
  thermalConductivity?: number;
  maxTempC?: number;
  minTempC?: number;
}

export interface MaterialImportReject {
  /** 1-기반 행 번호(헤더 제외) — 사용자가 파일에서 찾을 수 있게. */
  row: number;
  /** 어느 열이 문제인가. 행 전체 문제면 `'-'`. */
  field: string;
  reason: string;
}

export interface MaterialImportResult {
  accepted: ImportedMaterial[];
  rejected: MaterialImportReject[];
  /**
   * 요약 문구. ⚠ **거부가 0 건이어도 「전부 통과」라고 쓰지 않는다** —
   * 파일 자체가 비었을 수 있고, 그건 성공이 아니다.
   */
  summary: string;
}

/** `"항복강도(MPa)"` · `yieldStrengthMPa [GPa]` 같은 헤더에서 이름과 단위를 뗀다. */
function splitHeader(h: string): { key: string; unit: string | null } {
  const m = h.trim().match(/^(.*?)[\s_]*[([]([^)\]]+)[)\]]\s*$/);
  if (m) return { key: m[1]!.trim(), unit: m[2]!.trim().toLowerCase() };
  return { key: h.trim(), unit: null };
}

/** 한국어/영어 헤더를 표준 필드명으로. 모르는 헤더는 **무시하지 않고 그대로 둔다.** */
const ALIAS: Record<string, string> = {
  id: 'id', 코드: 'id', 재료코드: 'id',
  nameko: 'nameKo', 이름: 'nameKo', 재료명: 'nameKo', 명칭: 'nameKo',
  nameen: 'nameEn', englishname: 'nameEn',
  densitykgm3: 'densityKgM3', density: 'densityKgM3', 밀도: 'densityKgM3',
  tensilestrengthmpa: 'tensileStrengthMPa', tensilestrength: 'tensileStrengthMPa', 인장강도: 'tensileStrengthMPa',
  yieldstrengthmpa: 'yieldStrengthMPa', yieldstrength: 'yieldStrengthMPa', 항복강도: 'yieldStrengthMPa',
  elongationpct: 'elongationPct', elongation: 'elongationPct', 연신율: 'elongationPct',
  thermalconductivity: 'thermalConductivity', 열전도율: 'thermalConductivity', 열전도도: 'thermalConductivity',
  maxtempc: 'maxTempC', 최대온도: 'maxTempC',
  mintempc: 'minTempC', 최소온도: 'minTempC',
};

const norm = (s: string) => s.toLowerCase().replace(/[\s_·/()]/g, '');

/**
 * CSV 텍스트 → 재료 목록.
 *
 * @param csv 첫 줄이 헤더. 구분자는 쉼표 또는 탭.
 *
 * ⚠ 한 행이 거부돼도 **나머지는 계속 처리한다** — 한 줄 오타로 전체를 버리면
 *   사용자가 100줄짜리 파일을 못 쓴다. 대신 거부 목록을 반드시 돌려준다.
 */
export function importMaterialsCsv(csv: string): MaterialImportResult {
  const lines = String(csv).split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { accepted: [], rejected: [], summary: '파일이 비어 있다 — 인입할 행이 없다(성공이 아니다).' };
  }
  const sep = lines[0]!.includes('\t') ? '\t' : ',';
  const rawHeaders = lines[0]!.split(sep).map((h) => h.trim());
  const cols = rawHeaders.map((h) => {
    const { key, unit } = splitHeader(h);
    return { field: ALIAS[norm(key)] ?? null, raw: h, unit };
  });

  const accepted: ImportedMaterial[] = [];
  const rejected: MaterialImportReject[] = [];

  const known = new Set(cols.map((c) => c.field).filter(Boolean) as string[]);
  const missingRequired = REQUIRED.filter((f) => !known.has(f));
  if (missingRequired.length) {
    return {
      accepted: [], rejected: [{ row: 0, field: missingRequired.join(','), reason: '필수 열이 헤더에 없다' }],
      summary: `필수 열 누락: ${missingRequired.join(' · ')} — 한 행도 인입하지 않았다.`,
    };
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(sep);
    const rowNo = i;
    const rec: Record<string, unknown> = {};
    let bad = false;

    for (let c = 0; c < cols.length; c++) {
      const col = cols[c]!;
      if (!col.field) continue; // 모르는 열은 무시 — 거부 사유가 아니다
      const cell = (cells[c] ?? '').trim();

      if (col.field === 'id' || col.field === 'nameKo' || col.field === 'nameEn') {
        if (!cell && col.field !== 'nameEn') {
          rejected.push({ row: rowNo, field: col.field, reason: '필수 값이 비어 있다' });
          bad = true;
        } else rec[col.field] = cell;
        continue;
      }

      // ── 수치 필드 ──
      if (cell === '') {
        // ⚠ 빈 칸을 0 으로 채우지 않는다. 필수면 거부, 선택이면 **없는 채로 둔다.**
        if ((REQUIRED as readonly string[]).includes(col.field)) {
          rejected.push({ row: rowNo, field: col.field, reason: '필수 수치가 비어 있다 — 0 으로 채우지 않는다' });
          bad = true;
        }
        continue;
      }
      const n = Number(cell.replace(/,/g, ''));
      if (!Number.isFinite(n)) {
        rejected.push({ row: rowNo, field: col.field, reason: `숫자가 아니다: "${cell}"` });
        bad = true;
        continue;
      }

      // 단위 환산 — 모르는 단위는 거부(추측 금지)
      let v = n;
      const factors = UNIT_FACTOR[col.field];
      if (col.unit && factors) {
        const f = factors[col.unit];
        if (f === undefined) {
          rejected.push({ row: rowNo, field: col.field, reason: `모르는 단위 "${col.unit}" — 추측하지 않는다` });
          bad = true;
          continue;
        }
        v = n * f;
      }

      const range = RANGE[col.field];
      if (range && (v < range.min || v > range.max)) {
        rejected.push({
          row: rowNo, field: col.field,
          reason: `값 ${v} ${range.unit} 가 물리적 범위(${range.min}~${range.max})를 벗어난다 — 단위나 자릿수를 확인하라`,
        });
        bad = true;
        continue;
      }
      rec[col.field] = v;
    }

    if (bad) continue;
    // 항복 > 인장은 물리적으로 불가능 — 조용히 넘기면 안전율이 과대평가된다.
    const ys = rec.yieldStrengthMPa as number, ts = rec.tensileStrengthMPa as number;
    if (Number.isFinite(ys) && Number.isFinite(ts) && ys > ts) {
      rejected.push({ row: rowNo, field: 'yieldStrengthMPa', reason: `항복강도(${ys})가 인장강도(${ts})보다 크다 — 물리적으로 불가능` });
      continue;
    }
    accepted.push(rec as unknown as ImportedMaterial);
  }

  const total = lines.length - 1;
  const summary = total === 0
    ? '헤더만 있고 데이터 행이 없다 — 인입한 재료가 없다(성공이 아니다).'
    : `${total}행 중 ${accepted.length}행 인입 · ${rejected.length}건 거부`
      + (rejected.length ? ' — 거부 사유는 rejected 목록 참조(값을 채워 통과시키지 않았다).' : '');
  return { accepted, rejected, summary };
}
