/**
 * stepToNexyfabAssembly — 실물 STEP → NexyFab 어셈블리 브리지 (260717).
 *
 * "STEP 을 열면 도면·물량이 나온다": importStepAssembly(배치+로컬 AABB)를
 * drawing-to-3d 어셈블리(box 근사)로 변환 — GA·BOM·XLSX·IFC·3D 전 파이프라인 재사용.
 *
 * 정직 경계(전부 명시):
 *   - 부품 형상 = **월드 AABB box 근사**(회전 쿼터니언을 로컬 AABB 8코너에 적용 후
 *     축정렬 포락) — 원기하 아님. 질량·BOQ 는 AABB 체적 기준(과대측) → note 로 명시.
 *   - 재질 = STEP 미해석(기본 steel — material 필드로 덮어쓰기 가능) 명시.
 *   - 부품 수 상한 = PARTS_BUDGET(600) — 초과 파일은 정직 거부(대표화는 후속).
 *   - 표면 모델·형상 없는 PD = 제외 집계(unsupported 승계).
 */
import { importStepAssembly } from './stepAssemblyImport';

export interface StepBridgeResult {
  ok: boolean;
  error?: string;
  assembly?: {
    name: string;
    domain: string;
    parts: Array<{ id: string; type: 'box'; params: { width: number; depth: number; height: number }; at: { tx: number; ty: number; tz: number }; role: string; material: string }>;
    note: string;
  };
  stats?: { partsIn: number; imported: number; skippedNoBounds: number; warnings: number; unsupported: number };
}

const MAX_PARTS = 600; // drawing-to-3d PARTS_BUDGET 과 동일 예산

function rotByQuat(q: { x: number; y: number; z: number; w: number }, v: [number, number, number]): [number, number, number] {
  // v' = v + 2·qv×(qv×v + w·v)
  const [vx, vy, vz] = v;
  const { x, y, z, w } = q;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

/** STEP 소스 → NexyFab 어셈블리(box 근사). 실패/상한 초과 = ok:false 정직. */
export function stepToNexyfabAssembly(source: string, { name = 'STEP import', material = 'steel' } = {}): StepBridgeResult {
  let r;
  try {
    r = importStepAssembly(source, { maxClassifyParts: 0, collectBounds: true });
  } catch (e) {
    return { ok: false, error: 'STEP 파싱 실패: ' + String((e as Error)?.message ?? e).slice(0, 160) };
  }
  const partsIn = r.state.parts.length;
  if (partsIn === 0) return { ok: false, error: '부품 0 — 어셈블리/솔리드를 찾지 못함(표면 모델 미지원)', stats: { partsIn, imported: 0, skippedNoBounds: 0, warnings: r.warnings.length, unsupported: r.unsupported.length } };
  if (partsIn > MAX_PARTS) return { ok: false, error: `부품 ${partsIn}개 > 예산 ${MAX_PARTS} — 대형 어셈블리 대표화는 후속(부분 파일로 나눠주세요)`, stats: { partsIn, imported: 0, skippedNoBounds: 0, warnings: r.warnings.length, unsupported: r.unsupported.length } };
  const out: NonNullable<StepBridgeResult['assembly']>['parts'] = [];
  let skipped = 0;
  const used = new Set<string>();
  for (const p of r.state.parts) {
    const b = r.bounds?.[p.id];
    if (!b) { skipped++; continue; }
    // 로컬 AABB 8코너 → 쿼터니언 회전 + 평행이동 → 월드 AABB
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const cx of [b.min[0], b.max[0]]) for (const cy of [b.min[1], b.max[1]]) for (const cz of [b.min[2], b.max[2]]) {
      const [wx, wy, wz] = rotByQuat(p.orientation, [cx, cy, cz]);
      const w: [number, number, number] = [wx + p.position.x, wy + p.position.y, wz + p.position.z];
      for (let k = 0; k < 3; k++) { if (w[k] < min[k]) min[k] = w[k]; if (w[k] > max[k]) max[k] = w[k]; }
    }
    const dims = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    if (!dims.every((d) => Number.isFinite(d) && d > 0.01)) { skipped++; continue; }
    let id = String(p.name ?? p.id).replace(/[^\w가-힣-]/g, '_').slice(0, 40) || p.id;
    while (used.has(id)) id = `${id}_`;
    used.add(id);
    out.push({
      id,
      type: 'box',
      params: { width: +dims[0].toFixed(2), depth: +dims[1].toFixed(2), height: +dims[2].toFixed(2) },
      at: { tx: +min[0].toFixed(2), ty: +min[1].toFixed(2), tz: +min[2].toFixed(2) },
      role: 'imported',
      material,
    });
  }
  if (out.length === 0) return { ok: false, error: '경계 추출 0건 — 포인트 없는 표현(테셀레이션 등) 미지원', stats: { partsIn, imported: 0, skippedNoBounds: skipped, warnings: r.warnings.length, unsupported: r.unsupported.length } };
  return {
    ok: true,
    assembly: {
      name,
      domain: 'mech',
      parts: out,
      note: 'STEP 임포트 근사(월드 AABB box — 원기하 아님) · 질량/물량=AABB 체적 기준(과대측) · 재질=미해석 기본값 · 배치=NAUO 해석(정확)',
    },
    stats: { partsIn, imported: out.length, skippedNoBounds: skipped, warnings: r.warnings.length, unsupported: r.unsupported.length },
  };
}
