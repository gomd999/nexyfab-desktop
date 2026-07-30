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
    /** 임포트 box/cyl 근사 표시 — buildAssembly 가 간섭을 '근사 겹침'으로 분류(판정 비대상). */
    importedApprox?: boolean;
    parts: Array<{ id: string; type: 'box' | 'cylinder'; params: { width?: number; depth?: number; height?: number; diameter?: number; length?: number }; at: { tx: number; ty: number; tz: number; rx?: number; ry?: number }; role: string; material: string; qty?: number }>;
    note: string;
  };
  stats?: { partsIn: number; imported: number; skippedNoBounds: number; warnings: number; unsupported: number; cylinders?: number; splitParts?: number; representative?: { groups: number; instances: number } };
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

/** STEP 소스 → NexyFab 어셈블리(box 근사). 실패 = ok:false 정직.
 *  부품 수 > 예산(600)이면 **대표화 2-pass**(260718): 동일 partTemplateId(같은 부품 정의의
 *  다인스턴스)당 대표 1개만 임포트 — 그룹 수도 예산 초과면 정직 거부.
 *  대표 부품에 qty=인스턴스 수 부여 → BOQ·구조질량·IFC Count 에 정밀 반영(260718).
 *  배치 도해는 대표 1개 위치만(전 인스턴스 배치 도해는 예산 밖 — note 명시). */
export function stepToNexyfabAssembly(source: string, { name = 'STEP import', material = 'steel' } = {}): StepBridgeResult {
  // 위장 확장자 감지(260718e — 코퍼스4 실측 2건): 내용 기반 정직 안내
  const head = source.slice(0, 200);
  if (!head.includes('ISO-10303')) {
    if (/^\s*solid\b/.test(head) || head.startsWith('STL file')) {
      return { ok: false, error: '이 파일은 STL 입니다(.step 확장자 오기 — eDrawings 내보내기 관례). STL 로 업로드하면 메시 실체적 임포트됩니다' };
    }
    if (head.startsWith('#UGC')) {
      return { ok: false, error: '지멘스 NX UGC 파트 파일(.step 위장) — NX 에서 파일→내보내기→STEP AP214 로 재내보내기 필요' };
    }
  }
  let r;
  let representative: { groups: number; instances: number } | null = null;
  let qtyOf: ((pid: string) => number) | null = null;
  try {
    // pass 1: 배치만(빠름) — 규모 파악
    const probe = importStepAssembly(source, { maxClassifyParts: 0, collectBounds: false });
    const partsIn0 = probe.state.parts.length;
    if (partsIn0 > MAX_PARTS) {
      // 대표화: partTemplateId 별 첫 인스턴스만 bounds 수집(화이트리스트 2-pass)
      const repIds = new Set<string>();
      const seenTpl = new Set<string>();
      const tplCount = new Map<string, number>(); // tplId → 인스턴스 수(물량 ×qty 반영용)
      const repTpl = new Map<string, string>(); // 대표 part.id → tplId
      for (const p of probe.state.parts) {
        const tplId = (p as { partTemplateId?: string }).partTemplateId ?? p.id;
        tplCount.set(tplId, (tplCount.get(tplId) ?? 0) + 1);
        if (!seenTpl.has(tplId)) { seenTpl.add(tplId); repIds.add(p.id); repTpl.set(p.id, tplId); }
      }
      qtyOf = (pid: string) => tplCount.get(repTpl.get(pid) ?? '') ?? 1;
      if (repIds.size > MAX_PARTS) {
        return { ok: false, error: `부품 정의 ${repIds.size}종 > 예산 ${MAX_PARTS} — 대표화로도 초과(부분 파일로 나눠주세요)`, stats: { partsIn: partsIn0, imported: 0, skippedNoBounds: 0, warnings: probe.warnings.length, unsupported: probe.unsupported.length } };
      }
      representative = { groups: repIds.size, instances: partsIn0 };
      r = importStepAssembly(source, { maxClassifyParts: 0, collectBounds: true, collectBoundsFor: repIds });
      // 대표 인스턴스만 남긴다(배치·경계 모두 대표 기준)
      r.state.parts = r.state.parts.filter((p) => repIds.has(p.id));
    } else {
      r = importStepAssembly(source, { maxClassifyParts: 0, collectBounds: true });
    }
  } catch (e) {
    return { ok: false, error: 'STEP 파싱 실패: ' + String((e as Error)?.message ?? e).slice(0, 160) };
  }
  const partsIn = representative?.instances ?? r.state.parts.length;
  if (r.state.parts.length === 0) return { ok: false, error: '부품 0 — 어셈블리/형상을 찾지 못함(곡선 전용·빈 모델 미지원)', stats: { partsIn, imported: 0, skippedNoBounds: 0, warnings: r.warnings.length, unsupported: r.unsupported.length } };
  const out: NonNullable<StepBridgeResult['assembly']>['parts'] = [];
  let skipped = 0;
  let cylCount = 0;
  let splitParts = 0;
  const used = new Set<string>();
  type B3 = { min: [number, number, number]; max: [number, number, number] };
  // 로컬 AABB 8코너 → 쿼터니언 회전 + 평행이동 → 월드 AABB + 원통 인식 방출(공용)
  const emitOne = (p: (typeof r.state.parts)[number], b: B3, idBase: string, radii: number[] | undefined, qn: number): boolean => {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const cx of [b.min[0], b.max[0]]) for (const cy of [b.min[1], b.max[1]]) for (const cz of [b.min[2], b.max[2]]) {
      const [wx, wy, wz] = rotByQuat(p.orientation, [cx, cy, cz]);
      const w: [number, number, number] = [wx + p.position.x, wy + p.position.y, wz + p.position.z];
      for (let k = 0; k < 3; k++) { if (w[k] < min[k]) min[k] = w[k]; if (w[k] > max[k]) max[k] = w[k]; }
    }
    const dims = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    if (!dims.every((d) => Number.isFinite(d) && d > 0.01)) return false;
    let id = idBase.replace(/[^\w가-힣-]/g, '_').slice(0, 40) || 'part';
    while (used.has(id)) id = `${id}_`;
    used.add(id);
    // 원통 인식(260718): CYLINDRICAL_SURFACE 반경 R + 월드 AABB 두 축=2R 폐형(축정렬)일 때만
    if (radii?.length) {
      const R = Math.max(...radii); // 외경 반경(tube 는 외경이 지배)
      const tol = Math.max(1, 2 * R * 0.02);
      const isDia = dims.map((d) => Math.abs(d - 2 * R) <= tol);
      const axis = isDia[0] && isDia[1] && !isDia[2] ? 2 : isDia[0] && isDia[2] && !isDia[1] ? 1 : isDia[1] && isDia[2] && !isDia[0] ? 0 : -1;
      if (axis >= 0 && dims[axis] > 0.01) {
        const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
        const at = axis === 2
          ? { tx: +cx.toFixed(2), ty: +cy.toFixed(2), tz: +min[2].toFixed(2) }
          : axis === 0
            ? { tx: +min[0].toFixed(2), ty: +cy.toFixed(2), tz: +((min[2] + max[2]) / 2).toFixed(2), ry: 90 }
            : { tx: +cx.toFixed(2), ty: +min[1].toFixed(2), tz: +((min[2] + max[2]) / 2).toFixed(2), rx: -90 };
        out.push({ id, type: 'cylinder', params: { diameter: +(2 * R).toFixed(2), length: +dims[axis].toFixed(2) }, at, role: 'imported', material, ...(qn > 1 ? { qty: qn } : {}) });
        cylCount++;
        return true;
      }
    }
    out.push({
      id,
      type: 'box',
      params: { width: +dims[0].toFixed(2), depth: +dims[1].toFixed(2), height: +dims[2].toFixed(2) },
      at: { tx: +min[0].toFixed(2), ty: +min[1].toFixed(2), tz: +min[2].toFixed(2) },
      role: 'imported',
      material,
      ...(qn > 1 ? { qty: qn } : {}),
    });
    return true;
  };
  for (const p of r.state.parts) {
    const qn = qtyOf ? qtyOf(p.id) : 1;
    const nameBase = String(p.name ?? p.id);
    // 멀티솔리드 분해(260718 — 참고파일들2): 1 PD 안의 솔리드 N개를 개별 box/cylinder 로.
    // 전체 예산(MAX_PARTS) 초과 시 병합 box 폴백(정직 — note 명시).
    const sArr = r.solidBounds?.[p.id];
    if (sArr && sArr.filter(Boolean).length > 1 && out.length + sArr.length <= MAX_PARTS) {
      let any = false;
      for (const [si, sb] of sArr.entries()) {
        if (!sb) continue;
        if (emitOne(p, sb, `${nameBase}_s${si + 1}`, r.solidCylRadii?.[p.id]?.[si], qn)) any = true;
      }
      if (any) { splitParts++; continue; }
    }
    const b = r.bounds?.[p.id];
    if (!b || !emitOne(p, b, nameBase, r.cylRadii?.[p.id], qn)) skipped++;
  }
  if (out.length === 0) {
    // 스켈레톤 감지(260718c — 참고파일들3 robotic-arm 실측): PD/NAUO 구조는 있는데 형상 0
    // = 외부 커널 파일(x_t 등) 참조 어셈블리 — 재내보내기 경로 안내(정직).
    const skeleton = partsIn >= 2 && skipped === r.state.parts.length;
    return {
      ok: false,
      error: skeleton
        ? `어셈블리 스켈레톤(부품 ${partsIn}·형상 0) — 지오메트리가 외부 파일(Parasolid .x_t 등)에 있는 배치 전용 STEP 입니다. 원본 CAD 에서 '지오메트리 포함(AP214/AP242 solids)' 옵션으로 STEP 재내보내기 필요`
        : '경계 추출 0건 — 포인트 없는 표현(테셀레이션 등) 미지원',
      stats: { partsIn, imported: 0, skippedNoBounds: skipped, warnings: r.warnings.length, unsupported: r.unsupported.length },
    };
  }
  return {
    ok: true,
    assembly: {
      name,
      domain: 'mech',
      importedApprox: true,
      parts: out,
      note: 'STEP 임포트 근사(월드 AABB box — 원기하 아님) · 축정렬 원통=CYLINDRICAL_SURFACE R+AABB 폐형 대조로 cylinder 방출(질량 정확) · 질량/물량=box 는 AABB 체적 기준(과대측) · 재질=미해석 기본값 · 배치=NAUO 해석(정확)'
        + (splitParts ? ` · 멀티솔리드 분해: ${splitParts}개 PD 를 솔리드별 부품으로 전개(260718)` : '')
        + (representative ? ` · 대표화: ${representative.instances}인스턴스→${representative.groups}종 대표 배치(질량·물량=인스턴스 수 qty 반영 — 260718. 배치 도해는 대표 1개 위치만)` : ''),
    },
    stats: { partsIn, imported: out.length, skippedNoBounds: skipped, warnings: r.warnings.length, unsupported: r.unsupported.length, ...(cylCount ? { cylinders: cylCount } : {}), ...(splitParts ? { splitParts } : {}), ...(representative ? { representative } : {}) },
  };
}

/**
 * ★260802 — STEP → 어셈블리, **커널 우선 · AABB 폴백**.
 *
 * ## 왜 바꾸나 — 실측
 * 종전 경로는 전 부품을 **월드 AABB 상자**로 받았다. 코퍼스 실측:
 * ```
 * 파일 성공률       35/35 (실패하지 않는다)
 * AABB/커널 부피 비  0.02 ~ 26.63  ← **양방향**
 * 한 파일 대조      주력 box 28.56×31.5×1.93  vs  커널 경계 63×63×3.0
 * ```
 * 상자가 형상을 **감싸지도 못한다.** 치우친 오차는 보수적으로 쓸 수 있지만 **양방향 오차는
 * 신뢰 구간을 줄 수 없고**, 질량이 작게 나오면 구조 검토가 안전측이 아니다.
 *
 * 커널 경로는 솔리드 단위로 쪼개고 **부피·표면적·무게중심을 정확값**으로 낸다
 * (실측: 트롤리 7.35MB → **205부품 · 전부 정확값** · 표면적 33.17m² · 20.6초).
 *
 * ## ⚠ 섞지 않는다
 * · 커널 성공 → 부품 = 커널 솔리드(`fidelity: 'kernel-solid'`)
 * · 커널 실패 → **종전 AABB 경로로 폴백** + 「경계 근사이며 오차가 **양방향**」 고지
 * · **총질량 한 줄에 두 충실도를 합산해 적지 않는다** — 부품마다 `fidelity` 가 붙는다.
 */
export async function stepToNexyfabAssemblyPreferKernel(
  source: string,
  opts: { name?: string; material?: string } = {},
): Promise<StepBridgeResult & { fidelity?: 'kernel-solid' | 'aabb-approx'; kernelReason?: string | null; warnings?: string[] }> {
  const fallback = (): StepBridgeResult & { fidelity: 'aabb-approx'; kernelReason: string | null; warnings: string[] } => {
    const r = stepToNexyfabAssembly(source, opts);
    return {
      ...r, fidelity: 'aabb-approx', kernelReason: reason,
      warnings: [
        '형상은 **월드 AABB 상자 근사**다(원기하 아님). 질량·물량은 그 상자 기준이며 '
        + '**오차가 양방향**이다 — 실측 대비 0.02~26.6배 범위가 관측됐다. 과대만이 아니라 **과소**도 난다.',
        ...(reason ? [`커널 경로를 쓰지 못했다: ${reason}`] : []),
      ],
    };
  };
  let reason: string | null = null;
  try {
    const { importStepWithKernel } = await import('./stepKernelImport');
    const k = await importStepWithKernel(source, { idPrefix: 'part' });
    if (!k.ok || !k.parts.length) { reason = k.reason ?? '커널이 부품을 내지 못했다'; return fallback(); }
    return {
      ok: true,
      assembly: {
        name: opts.name ?? 'STEP import',
        domain: 'mech',
        // ⚠ `importedApprox` 를 붙이지 않는다 — 이 경로는 근사가 아니다.
        parts: k.parts as unknown as StepBridgeResult['assembly'] extends undefined ? never
          : NonNullable<StepBridgeResult['assembly']>['parts'],
        note: `커널(OCCT) 실측 — 솔리드 ${k.parts.length}개. 부피·표면적·무게중심은 정확값이고 `
          + '표시 메시는 근사다. **파라메트릭이 아니다**(치수를 고쳐 재생성할 수 없다).',
      } as NonNullable<StepBridgeResult['assembly']>,
      stats: { partsIn: k.parts.length, imported: k.parts.length, skippedNoBounds: 0, warnings: k.warnings.length, unsupported: 0 },
      fidelity: 'kernel-solid',
      kernelReason: null,
      warnings: k.warnings,
    };
  } catch (e) {
    reason = String((e as Error)?.message ?? e).slice(0, 160);
    return fallback();
  }
}
