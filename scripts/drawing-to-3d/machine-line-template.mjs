/**
 * machine-line-template — A-L2 of the complex-scale plan (260808).
 *
 * 기계 서브어셈블리 계층의 첫 실전: 모듈형 롤러 컨베이어 라인.
 *  line ─ conveyor_module ×N (linear)
 *          ├─ leg ×2 (모듈 시점에만 — 경계 중복 방지, 끝단은 end_legs 로 봉합)
 *          ├─ side_rail ×2
 *          └─ roller ×k (rx=90 눕힌 원통 — OBB 내로우페이즈 경로 사용)
 *        + end_legs(라인 말단) + drive_unit(구동부)
 *
 * A-L2 게이트(결과 검증): ① 레일 연속(인접 모듈 레일 접촉, 틈/겹침 0)
 * ② 롤러 피치 균일 — **모듈 경계를 가로질러도** 균일(인스턴싱 이음매 검증)
 * ③ 레그 피치 균일(시점 레그 + 말단 봉합) ④ BOQ 패턴곱 교차.
 */
import { expandHierarchy, hierarchyCounts } from './hierarchy-ir.mjs';

const box = (id, w, d, h, at = {}, extra = {}) =>
  ({ id, type: 'box', params: { width: w, depth: d, height: h }, at, ...extra });

export function buildMachineLineIR(p = {}) {
  const modules = Math.round(p.modules ?? 4);
  const moduleLen = p.moduleLen ?? 2000;
  const width = p.width ?? 600;
  const rollerPitch = p.rollerPitch ?? 250;
  const railH = p.railH ?? 880, railT = 80, legW = 60, rollerDia = p.rollerDia ?? 60;
  if (!(modules >= 1 && modules <= 50)) throw new Error('line: modules 1..50');
  if (!(moduleLen % rollerPitch === 0)) throw new Error('line: moduleLen 은 rollerPitch 의 배수여야 피치가 경계에서 균일하다');
  const rollersPerModule = moduleLen / rollerPitch;
  const legH = railH - railT;
  const rollerLen = width - 2 * legW - 20; // 레일 내측 여유 10mm/측
  const rollerZ = railH - railT / 2;       // 레일 중심 높이에 롤러 축

  const definitions = [
    { defId: 'leg', system: 'structure', parts: [box('leg', legW, legW, legH, {}, { material: 'steel', role: 'leg' })] },
    { defId: 'side_rail', system: 'structure', parts: [box('rail', moduleLen, legW, railT, { tz: legH }, { material: 'steel', role: 'rail' })] },
    {
      defId: 'roller', system: 'mech',
      // cylinder 로컬축 z → rx=-90 으로 y축 정렬(+y 로 눕힘): OBB 경로 검증 겸용
      parts: [{ id: 'rl', type: 'cylinder', params: { diameter: rollerDia, length: rollerLen }, at: { rx: -90, ty: legW + 10, tz: rollerZ }, material: 'steel', role: 'roller' }],
    },
    {
      defId: 'conveyor_module', system: 'mech',
      children: [
        { ref: 'leg', id: 'legL', at: { ty: 0 } },
        { ref: 'leg', id: 'legR', at: { ty: width - legW } },
        { ref: 'side_rail', id: 'railL', at: { ty: 0 } },
        { ref: 'side_rail', id: 'railR', at: { ty: width - legW } },
        { ref: 'roller', id: 'rol', at: { tx: rollerPitch / 2 }, pattern: { kind: 'linear', count: rollersPerModule, dx: rollerPitch } },
      ],
    },
    {
      defId: 'end_legs', system: 'structure',
      children: [
        { ref: 'leg', id: 'legL', at: { ty: 0 } },
        { ref: 'leg', id: 'legR', at: { ty: width - legW } },
      ],
    },
    {
      defId: 'drive_unit', system: 'mech',
      parts: [
        { ...box('motor_house', 400, width, 500, { tz: legH - 500 + railT }), material: 'steel', role: 'drive' },
      ],
    },
  ];

  return {
    schema: 'nexyfab.assembly-hierarchy.v1',
    name: `conveyor_line_${modules}m`, domain: 'mech', kind: 'machine_line',
    meta: { modules, moduleLen, width, rollerPitch, rollersPerModule, railH, legW, lineLen: modules * moduleLen },
    definitions,
    root: [
      { ref: 'conveyor_module', id: 'mod', pattern: { kind: 'linear', count: modules, dx: moduleLen } },
      { ref: 'end_legs', id: 'end', at: { tx: modules * moduleLen - legW } },
      { ref: 'drive_unit', id: 'drv', at: { tx: modules * moduleLen } },
    ],
  };
}

/** A-L2 결정론 게이트 — 모듈 인터페이스 연속성(전개 결과 검증). */
export function gateMachineLine(ir, expanded) {
  const errs = [];
  const { modules, moduleLen, rollerPitch, legW, lineLen } = ir.meta;
  const parts = expanded.parts ?? [];
  const counts = hierarchyCounts(ir);

  // ① 레일 연속: 각 측 레일 세그먼트가 빈틈/겹침 없이 이어진다
  for (const side of ['railL', 'railR']) {
    const xs = parts.filter(pp => pp._occ.leaf === 'rail' && pp._occ.path.includes(`/${side}`))
      .map(pp => pp.at.tx).sort((a, b) => a - b);
    if (xs.length !== modules) { errs.push(`rail_count:${side}: ${xs.length} ≠ ${modules}`); continue; }
    for (let k = 1; k < xs.length; k++) {
      const joint = xs[k] - (xs[k - 1] + moduleLen);
      if (Math.abs(joint) > 0.01) { errs.push(`rail_continuity:${side}: 경계 ${k} 이격 ${joint.toFixed(2)}mm`); break; }
    }
  }

  // ② 롤러 피치 균일 — 모듈 경계 가로질러 검사(인스턴싱 이음매)
  const rollerXs = parts.filter(pp => pp._occ.leaf === 'rl').map(pp => pp.at.tx).sort((a, b) => a - b);
  if (rollerXs.length !== counts.get('roller')) errs.push(`boq_roller: 전개 ${rollerXs.length} ≠ 패턴곱 ${counts.get('roller')}`);
  for (let k = 1; k < rollerXs.length; k++) {
    const pitch = rollerXs[k] - rollerXs[k - 1];
    if (Math.abs(pitch - rollerPitch) > 0.01) { errs.push(`roller_pitch: ${k}번째 간격 ${pitch.toFixed(2)} ≠ ${rollerPitch} (모듈 경계 이음매 확인)`); break; }
  }

  // ③ 레그: 시점 레그 N쌍 + 말단 봉합 1쌍, 마지막 레그가 라인 끝을 봉한다
  const legXs = [...new Set(parts.filter(pp => pp._occ.leaf === 'leg').map(pp => pp.at.tx))].sort((a, b) => a - b);
  if (legXs.length !== modules + 1) errs.push(`leg_stations: ${legXs.length} ≠ ${modules + 1}`);
  const lastLeg = legXs[legXs.length - 1];
  if (Math.abs(lastLeg - (lineLen - legW)) > 0.01) errs.push(`end_leg_seal: 말단 레그 ${lastLeg} ≠ ${lineLen - legW}`);
  return errs;
}

export function buildMachineLine(params = {}, opts = {}) {
  const ir = buildMachineLineIR(params);
  const expanded = expandHierarchy(ir, opts);
  if (!expanded.ok) return { ok: false, gateErrors: expanded.gateErrors, ir };
  const errs = gateMachineLine(ir, expanded);
  return { ok: errs.length === 0, gateErrors: errs, ir, expanded };
}
