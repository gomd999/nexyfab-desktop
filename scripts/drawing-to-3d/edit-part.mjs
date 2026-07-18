/**
 * edit-part.mjs — 선택 부품 단위 수정 루프(260719, 사용자 방향: 픽킹→대상만 수정).
 *
 * 계약(edit-intent 와 동일 사상): AI 는 「지시문 → 부품 패치 JSON」 이해만 담당.
 * 적용·게이트(어휘 검증·간섭·지지·구조)는 buildAssembly 결정론이 처리 — AI 가
 * 어셈블리 전체를 다시 만들지 않는다(대상 외 부품 불변 보장 = 코드가 강제).
 *
 * 면 선택: 프리미티브는 파라메트릭이라 위상 명명 없이 월드 노멀 → 명명 면
 * (box=6면, 회전체=축단±/원통면)으로 사상 — 픽킹 UI 가 노멀만 넘기면 된다.
 */
import { buildAssembly, placedAabb } from './assembly.mjs';
import { PARAMS } from './reconstruct.mjs';
import { callGeminiJson } from './from-text.mjs';
import { GEN_REGISTRY } from './gen-macros.mjs';

/** 허용 패치 필드 — id 는 불변, 그 외는 화이트리스트만. gen=자유곡면 생성기 스펙. */
const PATCHABLE = new Set(['type', 'params', 'at', 'material', 'system', 'detail', 'role', 'gen']);

/**
 * 결정론 적용: 부품 하나에 패치 병합 → 전체 재빌드·게이트.
 * @returns { ok, assembly?, built?, error?, gateErrors?, interferences? }
 */
export function applyPartPatch(asm, partId, patch) {
  const idx = (asm.parts ?? []).findIndex((p) => p.id === partId);
  if (idx < 0) return { ok: false, error: `부품 '${partId}' 없음` };
  const bad = Object.keys(patch ?? {}).filter((k) => !PATCHABLE.has(k));
  if (bad.length) return { ok: false, error: `허용 외 패치 필드: ${bad.join(',')}` };
  if (patch.type && !(patch.type in PARAMS)) return { ok: false, error: `미지원 type '${patch.type}' (어휘 외 — 정직 거부)` };
  const cur = asm.parts[idx];
  const next = {
    ...cur,
    ...(patch.type ? { type: patch.type } : {}),
    ...(patch.material ? { material: patch.material } : {}),
    ...(patch.system ? { system: patch.system } : {}),
    ...(patch.role ? { role: patch.role } : {}),
    ...(patch.detail != null ? { detail: patch.detail } : {}),
    // type 이 바뀌면 params 는 전면 교체(이종 파라미터 잔존 방지), 아니면 병합
    params: patch.type ? { ...(patch.params ?? {}) } : { ...cur.params, ...(patch.params ?? {}) },
    at: { ...cur.at, ...(patch.at ?? {}) },
  };
  // 자유곡면 생성기 재생성(260719): gen 패치 → 레지스트리로 mesh params 결정론 재생성
  // (verts 직접 패치는 params 병합으로 오면 거대·비추적 — gen 경로가 정도)
  if (patch.gen || cur.gen) {
    const genNext = patch.gen
      ? { kind: patch.gen.kind ?? cur.gen?.kind, params: { ...(cur.gen?.params ?? {}), ...(patch.gen.params ?? {}) } }
      : cur.gen;
    if (patch.gen) {
      const fn = GEN_REGISTRY[genNext?.kind];
      if (!fn) return { ok: false, error: `미등록 생성기 kind '${genNext?.kind}' (정직 거부)` };
      if (next.type !== 'mesh') return { ok: false, error: 'gen 패치는 mesh 부품 전용' };
      next.params = fn(genNext.params);
      next.gen = genNext;
    }
  }
  const parts = asm.parts.slice();
  parts[idx] = next;
  const nextAsm = { ...asm, parts };
  const built = buildAssembly(nextAsm);
  if (!built.ok) return { ok: false, error: 'gate', gateErrors: built.gateErrors, assembly: nextAsm };
  return {
    ok: true, assembly: nextAsm, part: next,
    gateErrors: [], interferences: built.interferences ?? [],
    floating: built.support?.floating ?? [],
    massKg: built.structural?.totalMassKg ?? null,
    // 클라 재렌더용(P1 픽킹 UI) — 빌드 산출 그대로(재계산 없음)
    openscad: built.openscad, parts: built.parts ?? [], composeIntent: built.composeIntent ?? null,
    contacts: built.contacts ?? [], welds: built.welds ?? [], weldTotalMm: built.weldTotalMm ?? 0,
    structural: built.structural ?? null,
  };
}

/** 월드 노멀 → 명명 면(픽킹 컨텍스트). box 회전은 v1 미지원=null(정직). */
export function faceOfPart(part, normal) {
  const n = normal.map(Number);
  const L = Math.hypot(...n) || 1;
  const u = n.map((v) => v / L);
  // 확장 회전체 축 판정(roundAxisOf 는 cylinder 계열만 — reducer/revolve/nut 포함)
  const roundAxis = (p) => {
    if (!['cylinder', 'tube', 'flange', 'hex_bolt', 'hex_nut', 'washer', 'pipe_reducer', 'revolve'].includes(p.type)) return null;
    const { rx = 0, ry = 0, rz = 0 } = p.at ?? {};
    if (!rx && !ry && !rz) return 'z';
    if (Math.abs(Math.abs(ry) - 90) < 1e-6 && !rx && !rz) return 'x';
    if (Math.abs(Math.abs(rx) - 90) < 1e-6 && !ry && !rz) return 'y';
    return null;
  };
  const round = roundAxis(part);
  if (round) {
    const ax = round === 'x' ? [1, 0, 0] : round === 'y' ? [0, 1, 0] : [0, 0, 1];
    const d = u[0] * ax[0] + u[1] * ax[1] + u[2] * ax[2];
    if (d > 0.7) return { face: 'axis+', label: '축단(+) — 진행 끝면' };
    if (d < -0.7) return { face: 'axis-', label: '축단(−) — 시작 끝면' };
    return { face: 'radial', label: '원통면(반경)' };
  }
  if (part.type === 'box' && !(part.at?.rx || part.at?.ry || part.at?.rz)) {
    const names = [['x-', '좌면(x−)'], ['x+', '우면(x+)'], ['y-', '전면(y−)'], ['y+', '후면(y+)'], ['z-', '하면(z−)'], ['z+', '상면(z+)']];
    let bi = 0, bv = -Infinity;
    [[-u[0]], [u[0]], [-u[1]], [u[1]], [-u[2]], [u[2]]].forEach((q, i) => { if (q[0] > bv) { bv = q[0]; bi = i; } });
    return { face: names[bi][0], label: names[bi][1] };
  }
  return null; // 회전 box 등 — v1 미지원(정직)
}

/**
 * 면 푸시풀(260719 — "임의 면 드래그" 파라메트릭 대응): 명명 면 + 드래그량(노멀 방향
 * ±mm) → 파라미터/배치 결정론 패치. AI 불필요 — 뷰어가 faceOfPart 결과와 delta 만
 * 넘기면 된다. 대응 불가 조합(리듀서 반경·revolve·mesh 등)=정직 거부(모호 금지).
 * 규약: delta>0=면이 바깥으로(재료 증가), delta<0=안으로. 음수 치수는 게이트가 거부.
 */
export function faceDragPatch(part, face, deltaMm) {
  const d = Number(deltaMm);
  if (!Number.isFinite(d) || d === 0) return { ok: false, error: 'deltaMm 필요(±mm)' };
  const t = part.type, p = part.params ?? {};
  const f = typeof face === 'string' ? face : face?.face;
  if (!f) return { ok: false, error: 'face 필요(faceOfPart 결과)' };
  // box(무회전): 6면 → 치수 + (−면이면 최소코너 이동)
  if (t === 'box') {
    if (part.at?.rx || part.at?.ry || part.at?.rz) return { ok: false, error: '회전 box 푸시풀 v1 미지원(정직)' };
    const map = { 'x+': ['width', null], 'x-': ['width', 'tx'], 'y+': ['depth', null], 'y-': ['depth', 'ty'], 'z+': ['height', null], 'z-': ['height', 'tz'] };
    const m = map[f];
    if (!m) return { ok: false, error: `box 면 '${f}' 미지원` };
    if ((p[m[0]] ?? 0) + d <= 0) return { ok: false, error: '치수가 0 이하가 됨(거부)' };
    return { ok: true, patch: { params: { [m[0]]: p[m[0]] + d }, ...(m[1] ? { at: { [m[1]]: (part.at?.[m[1]] ?? 0) - d } } : {}) } };
  }
  // 회전체: 축단±=길이(−단은 시작 이동), radial=지름(대칭 확장)
  const axisOfR = (q) => {
    if (!['cylinder', 'tube', 'flange', 'hex_bolt', 'hex_nut', 'washer', 'pipe_reducer'].includes(q.type)) return null;
    const { rx = 0, ry = 0, rz = 0 } = q.at ?? {};
    if (!rx && !ry && !rz) return 'z';
    if (Math.abs(Math.abs(ry) - 90) < 1e-6 && !rx && !rz) return 'x';
    if (Math.abs(Math.abs(rx) - 90) < 1e-6 && !ry && !rz) return 'y';
    return null;
  };
  const ax = axisOfR(part);
  if (ax) {
    const lenKey = t === 'flange' || t === 'hex_nut' ? 'thickness' : 'length';
    const startKey = ax === 'x' ? 'tx' : ax === 'y' ? 'ty' : 'tz';
    if (f === 'axis+' || f === 'axis-') {
      if ((p[lenKey] ?? 0) + d <= 0) return { ok: false, error: '길이가 0 이하가 됨(거부)' };
      return { ok: true, patch: { params: { [lenKey]: p[lenKey] + d }, ...(f === 'axis-' ? { at: { [startKey]: (part.at?.[startKey] ?? 0) - d } } : {}) } };
    }
    if (f === 'radial') {
      const diaKey = t === 'cylinder' ? 'diameter' : t === 'tube' ? 'outerDia' : t === 'flange' ? 'outerDia' : t === 'washer' ? 'outerDia' : null;
      if (!diaKey) return { ok: false, error: `${t} 반경 푸시풀은 모호(단차/육각) — 지시문 수정 경로 사용(정직 거부)` };
      if ((p[diaKey] ?? 0) + 2 * d <= 0) return { ok: false, error: '지름이 0 이하가 됨(거부)' };
      return { ok: true, patch: { params: { [diaKey]: p[diaKey] + 2 * d } } };
    }
    return { ok: false, error: `면 '${f}' 미지원` };
  }
  if (t === 'mesh') return { ok: false, error: '자유곡면은 gen.params 재생성 경로(정점 드래그 비지원 — 제작 추적성)' };
  return { ok: false, error: `${t} 푸시풀 v1 미지원(정직)` };
}

/**
 * AI 이해 계층: 지시문 → 패치 제안 → 결정론 적용(+게이트 실패 시 1회 교정 재시도).
 * 대상 부품 JSON + 선택 면 + 이웃 AABB 만 프롬프트에 — 어셈블리 전체를 AI 에 안 넘긴다.
 */
export async function aiEditPart(asm, partId, instruction, { face = null, models } = {}) {
  const part = (asm.parts ?? []).find((p) => p.id === partId);
  if (!part) return { ok: false, error: `부품 '${partId}' 없음` };
  const pb = placedAabb(part);
  const center = pb.min.map((v, i) => (v + pb.max[i]) / 2);
  const neighbors = (asm.parts ?? [])
    .filter((p) => p.id !== partId && p.type !== 'mesh')
    .map((p) => { const b = placedAabb(p); const c = b.min.map((v, i) => (v + b.max[i]) / 2); return { p, d: Math.hypot(...c.map((v, i) => v - center[i])), b }; })
    .sort((a, b) => a.d - b.d).slice(0, 10)
    .map((q) => `- ${q.p.id}(${q.p.type}) AABB [${q.b.min.map(Math.round)}]..[${q.b.max.map(Math.round)}]`);
  const isMesh = part.type === 'mesh';
  const partView = isMesh
    ? { id: part.id, type: 'mesh', gen: part.gen ?? null, meshSummary: { volumeMm3: part.params?.volumeMm3, triCount: part.params?.triCount, aabb: part.params?.aabb }, at: part.at, material: part.material }
    : { id: part.id, type: part.type, params: part.params, at: part.at, material: part.material };
  const prompt = `기계 어셈블리에서 부품 하나만 수정한다. 아래 부품 JSON 을 지시에 맞게 고친 "패치"만 출력하라.
배치 관례(반드시 준수): box=at(tx,ty,tz)이 최소 코너. cylinder/tube/pipe_reducer/revolve=단면 중심이 (tx,ty)[무회전, tz=축 시작] · ry:90이면 축=x(tx=시작, ty/tz=단면 중심) · rx:90이면 축=y.
${isMesh ? (part.gen ? `이 부품은 생성기 자유곡면(gen.kind=${part.gen.kind}) — verts 를 절대 출력하지 말고 {"patch":{"gen":{"params":{...바뀐 값만}}}} 형식으로만 수정하라. 현재 gen.params: ${JSON.stringify(part.gen.params)}` : '이 부품은 자유곡면(mesh) — 생성기 스펙이 없어 형상 수정 불가(정직 거부: {"patch":null,"note":"이유"} 출력). at 이동만 가능.') : ''}
대상 부품: ${JSON.stringify(partView)}
${face ? `선택 면: ${face.label ?? face.face ?? face} — 지시는 이 면 기준으로 해석(예: 축단(+)=그 방향 치수/위치).` : ''}
이웃 부품(참고 — 충돌 회피):\n${neighbors.join('\n')}
지시: ${String(instruction).slice(0, 400)}
출력(JSON 만): {"patch":{"params":{...바뀐 값만},"at":{...바뀐 값만}},"note":"한줄 설명"} — type 변경이 꼭 필요하면 "type" 포함(그때 params 는 새 타입 전체 파라미터).`;
  let out = await callGeminiJson(prompt, null, { models, thinkingBudget: 0, maxOutputTokens: 2048 });
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = out?.data ?? out; // callGeminiJson 은 {data, model, repaired} 래퍼
    const patch = body?.patch;
    if (!patch || typeof patch !== 'object') return { ok: false, error: 'AI 패치 형식 오류(정직 거부)', raw: out };
    const r = applyPartPatch(asm, partId, patch);
    if (r.ok) return { ...r, patch, note: body.note ?? null, attempts: attempt + 1 };
    if (attempt === 0) {
      out = await callGeminiJson(
        `${prompt}\n\n이전 패치 ${JSON.stringify(patch)} 가 게이트에서 실패했다: ${JSON.stringify(r.gateErrors ?? r.error).slice(0, 300)}\n오류를 고친 패치를 같은 형식으로 다시 출력하라.`,
        null, { models, thinkingBudget: 0, maxOutputTokens: 2048 },
      );
    } else {
      return { ok: false, error: '패치 게이트 실패(교정 1회 포함 — 정직 거부)', gateErrors: r.gateErrors ?? [r.error], patch };
    }
  }
  return { ok: false, error: 'unreachable' };
}
