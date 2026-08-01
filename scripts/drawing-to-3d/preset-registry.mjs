/**
 * preset-registry.mjs — 도메인별 파라메트릭 프리셋 디스패처(Pillar ① 일반화).
 *
 * 분야(mech/rack/…) → 템플릿 목록·빌드·검증을 한 곳에서. 라우트·MCP가 domain 인자로 호출.
 * 새 분야 프리셋은 *-presets.mjs 추가 후 BY_DOMAIN에만 등록하면 된다.
 */
import { MECH_TEMPLATES } from './mech-presets.mjs';
import { RACK_TEMPLATES } from './rack-presets.mjs';
import { CIVIL_TEMPLATES } from './civil-presets.mjs';
import { BUILDING_TEMPLATES } from './building-presets.mjs';
import { LANDSCAPE_TEMPLATES } from './landscape-presets.mjs';
import { INTERIOR_TEMPLATES } from './interior-presets.mjs';

const BY_DOMAIN = {
  mech: MECH_TEMPLATES,
  rack: RACK_TEMPLATES,
  civil: CIVIL_TEMPLATES,
  building: BUILDING_TEMPLATES,
  landscape: LANDSCAPE_TEMPLATES,
  interior: INTERIOR_TEMPLATES,
};

function templatesFor(domain) {
  return BY_DOMAIN[domain] ?? BY_DOMAIN.mech;
}

/** UI용 메타(빌더 제외). */
export function listTemplates(domain = 'mech') {
  return templatesFor(domain).map((t) => ({ id: t.id, labelKo: t.labelKo, labelEn: t.labelEn, params: t.params }));
}

/** domain+id+params → intent(결정론). 없으면 null. */
export function buildPreset(domain, templateId, params = {}) {
  const t = templatesFor(domain).find((x) => x.id === templateId);
  return t ? t.build(params) : null;
}

// ── 도메인 어셈블리 템플릿 (#6 비-기계 3D) — 단품 프리셋과 별개로 parts[] 어셈블리를 만든다 ──
/**
 * @param {string} [domain]
 * @param {string} [lang] 표시 언어(ko·en·zh·ja·es·ar). 주면 각 항목에 `label` 과
 *   `labelVia`(실제로 나간 언어)를 붙인다. **`labelKo`/`labelEn` 은 그대로 남긴다** —
 *   기존 호출자를 깨지 않기 위해서다.
 *
 * ⚠ 260801: 템플릿은 ko/en 둘뿐이고 파라미터는 ko 하나뿐이라, ja 화면에서 제목은 영어·
 *   파라미터는 한국어가 그대로 나왔다. 표는 `assembly-i18n.mjs` 에 둔다.
 */
export async function listAssemblyPresets(domain, lang) {
  const { listAssemblyTemplates } = await import('./domain-assemblies.mjs');
  const list = listAssemblyTemplates(domain);
  if (!lang) return list;
  const { localizeTemplates } = await import('./assembly-i18n.mjs');
  return localizeTemplates(list, lang);
}

/** domain+id+params → { ok, assembly, built } — built=buildAssembly(게이트·간섭·구조·composeIntent). */
export async function assemblyPresetWithBuild(domain, templateId, params = {}) {
  const { buildAssemblyTemplate } = await import('./domain-assemblies.mjs');
  const assembly = buildAssemblyTemplate(domain, templateId, params);
  // F9(260719) 오진 방지: 같은 id 가 **단품 프리셋**으로는 존재하는데 어셈블리 템플릿에는
  // 없는 경우가 있다(rack_post·u_channel·rc_beam 등 — intent(features[]) 산출물이라
  // parts[] 어셈블리 경로가 없다). 그대로 흘려보내면 하류가 "parts[] 비어있음"이라고만
  // 말해서 사용자가 원인도 조치도 알 수 없었다 → 여기서 원인·조치를 명시한다.
  if (!assembly) {
    const single = templatesFor(domain).find((x) => x.id === templateId);
    if (single) {
      return {
        ok: false, error: 'single_part_preset',
        message: `${domain}/${templateId}("${single.labelKo ?? templateId}") 는 단품 프리셋입니다 — parts[] 어셈블리가 아니라 단품 intent(features[])를 만듭니다. 어셈블리 API(assemblyPresetWithBuild) 대신 presetWithVerify("${domain}","${templateId}") 를 쓰거나, listAssemblyPresets("${domain}") 의 id 중에서 고르세요.`,
      };
    }
    return { ok: false, error: `unknown assembly template: ${domain}/${templateId}` };
  }
  // 입력 거부(F3/F10) — 형상을 만들지 않고 사유를 그대로 올린다(기본값 대체 금지).
  if (assembly.ok === false && assembly.error === 'invalid_params') {
    return { ok: false, error: 'invalid_params', gatePassed: false, gateErrors: assembly.paramErrors, message: assembly.message };
  }
  const { buildAssembly } = await import('./assembly.mjs');
  const built = buildAssembly(assembly);
  if (!built.ok) return { ok: false, gatePassed: false, gateErrors: built.gateErrors, assembly };
  return { ok: true, assembly, openscad: built.openscad, parts: built.parts, interferences: built.interferences, contacts: built.contacts ?? [], welds: built.welds, weldTotalMm: built.weldTotalMm, composeIntent: built.composeIntent, structural: built.structural, support: built.support ?? null, pipes: built.pipes ?? null, designOk: built.designOk ?? null };
}

/** domain+id+params → { ok, intent, scad, verify } (compose와 동일 형식). */
export async function presetWithVerify(domain, templateId, params = {}) {
  const intent = buildPreset(domain, templateId, params);
  if (!intent) return { ok: false, error: `unknown template: ${domain}/${templateId}` };
  const { gateComposite, emitComposite } = await import('./compose.mjs');
  const errs = gateComposite(intent);
  if (errs.length) return { ok: false, gatePassed: false, gateErrors: errs, intent };
  const scad = emitComposite(intent);
  let verify = null;
  try {
    const { renderStl } = await import('./verify.mjs');
    const stl = await renderStl(scad);
    const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
    const tri = dv.getUint32(80, true);
    const edges = new Map();
    let off = 84;
    const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    const vkey = (o) => `${dv.getFloat32(o, true).toFixed(3)},${dv.getFloat32(o + 4, true).toFixed(3)},${dv.getFloat32(o + 8, true).toFixed(3)}`;
    for (let i = 0; i < tri; i++) {
      const b = off + 12;
      const v = [vkey(b), vkey(b + 12), vkey(b + 24)];
      for (let e = 0; e < 3; e++) { const k = key(v[e], v[(e + 1) % 3]); edges.set(k, (edges.get(k) || 0) + 1); }
      off += 50;
    }
    let bad = 0;
    for (const c of edges.values()) if (c !== 2) bad++;
    verify = { triangles: tri, manifold: bad === 0, nonManifoldEdges: bad };
  } catch (e) {
    verify = { error: e.message };
  }
  return { ok: true, intent, scad, verify };
}

// --- self-test ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('preset-registry.mjs');
if (isMain) {
  let pass = 0, fail = 0;
  for (const domain of Object.keys(BY_DOMAIN)) {
    for (const t of listTemplates(domain)) {
      const defaults = Object.fromEntries(t.params.map((p) => [p.name, p.default]));
      const r = await presetWithVerify(domain, t.id, defaults);
      if (r.ok && r.verify?.manifold) { pass++; console.log(`OK ${domain}/${t.id}: ${r.verify.triangles} tri`); }
      else { fail++; console.log(`FAIL ${domain}/${t.id}:`, r.gateErrors ?? r.verify ?? r.error); }
    }
  }
  console.log(`preset-registry self-test: ${pass}/${pass + fail}`);
  if (fail) process.exit(1);
}
