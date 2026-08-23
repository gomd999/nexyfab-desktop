/**
 * Deterministic axial turbojet concept geometry.
 *
 * This is intentionally a preliminary CAD/flow-path model, not a CFD,
 * combustion, thermal, rotordynamic or certification result.  Unlike the old
 * free-form fallback it contains real lofted blade-ring meshes and an annular
 * combustor instead of cylinders standing in for every subsystem.
 */
import { bladeRingMesh } from './gen-macros.mjs';

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function ringPart(id, x, count, rootR, tipR, chord, pitch, naca, material, system) {
  const genParams = { nB: count, rRoot: rootR, rTip: tipR, chord, cx: x, cy: 0, cz: 0, pitch, naca, secs: 8, mpts: 16 };
  return {
    id,
    type: 'mesh',
    params: bladeRingMesh(genParams),
    gen: { kind: 'blade_ring', params: genParams },
    at: { tx: 0, ty: 0, tz: 0 },
    material,
    role: 'equipment',
    system,
    detail: 1,
  };
}

export function buildTurbojetConceptAssembly(input = {}) {
  const overallLength = clamp(finite(input.overallLength, 1500), 700, 5000);
  const fanDiameter = clamp(finite(input.fanDiameter, 500), 180, 1800);
  const casingThickness = clamp(finite(input.casingThickness, 3), 2, 20);
  const compressorStages = Math.round(clamp(finite(input.compressorStages, 5), 2, 12));
  const compressorBlades = Math.round(clamp(finite(input.compressorBlades, 12), 6, 36));
  const turbineStages = Math.round(clamp(finite(input.turbineStages, 2), 1, 5));
  const turbineBlades = Math.round(clamp(finite(input.turbineBlades, 10), 6, 32));

  const xInletEnd = overallLength * 0.14;
  const xCompressorEnd = overallLength * 0.43;
  const xCombustorEnd = overallLength * 0.66;
  const xTurbineEnd = overallLength * 0.82;
  const caseOD = fanDiameter;
  const caseID = caseOD - 2 * casingThickness;
  const turbineOD = caseOD * 0.88;
  const turbineID = turbineOD - 2 * casingThickness;
  const shaftD = clamp(fanDiameter * 0.075, 18, 90);
  const compressorRoot = Math.max(shaftD * 0.8, fanDiameter * 0.13);
  const compressorTip = caseID / 2 - Math.max(5, fanDiameter * 0.018);
  const fanTip = Math.min(compressorTip, fanDiameter * 0.43);
  const turbineRoot = Math.max(shaftD * 0.75, fanDiameter * 0.11);
  const turbineTip = turbineID / 2 - Math.max(5, fanDiameter * 0.018);
  const combustorOD = fanDiameter * 0.68;
  const combustorID = fanDiameter * 0.48;
  const parts = [];

  // Continuous external flow path, split into axial manufacturing modules.
  parts.push(
    // pipe_reducer requires dia1>dia2.  Build from the compressor face toward
    // the inlet (-x), so the physical flow direction is still inlet -> engine.
    { id: 'inlet_cowl', type: 'pipe_reducer', params: { dia1: caseOD, dia2: caseOD * 0.92, length: xInletEnd, wallThk: casingThickness }, at: { tx: xInletEnd, ty: 0, tz: 0, ry: -90 }, material: 'aluminum', role: 'inlet', system: '흡입구', detail: 2 },
    { id: 'compressor_casing', type: 'tube', params: { outerDia: caseOD, innerDia: caseID, length: xCompressorEnd - xInletEnd }, at: { tx: xInletEnd, ty: 0, tz: 0, ry: 90 }, material: 'aluminum', role: 'shell', system: '압축기 케이싱', detail: 2 },
    { id: 'combustor_casing', type: 'tube', params: { outerDia: caseOD, innerDia: caseID, length: xCombustorEnd - xCompressorEnd }, at: { tx: xCompressorEnd, ty: 0, tz: 0, ry: 90 }, material: 'STS316', role: 'shell', system: '연소기 케이싱', detail: 2 },
    { id: 'turbine_casing', type: 'pipe_reducer', params: { dia1: caseOD, dia2: turbineOD, length: xTurbineEnd - xCombustorEnd, wallThk: casingThickness }, at: { tx: xCombustorEnd, ty: 0, tz: 0, ry: 90 }, material: 'STS316', role: 'shell', system: '터빈 케이싱', detail: 2 },
    { id: 'exhaust_nozzle', type: 'pipe_reducer', params: { dia1: turbineOD, dia2: fanDiameter * 0.48, length: overallLength - xTurbineEnd, wallThk: casingThickness }, at: { tx: xTurbineEnd, ty: 0, tz: 0, ry: 90 }, material: 'STS316', role: 'outlet', system: '배기 노즐', detail: 2 },
  );

  // Rotor shaft and two bearing sleeves.  Bore/containment rules prove these
  // coaxial parts are assembled rather than treating them as collisions.
  parts.push(
    { id: 'main_shaft', type: 'cylinder', params: { diameter: shaftD, length: overallLength * 0.82 }, at: { tx: overallLength * 0.07, ty: 0, tz: 0, ry: 90 }, material: 'steel', role: 'shaft', system: '로터' },
    { id: 'front_bearing', type: 'tube', params: { outerDia: shaftD + 24, innerDia: shaftD + 1, length: Math.max(18, overallLength * 0.018) }, at: { tx: overallLength * 0.1, ty: 0, tz: 0, ry: 90 }, material: 'steel', role: 'mount', system: '베어링', detail: 2 },
    { id: 'rear_bearing', type: 'tube', params: { outerDia: shaftD + 24, innerDia: shaftD + 1, length: Math.max(18, overallLength * 0.018) }, at: { tx: overallLength * 0.76, ty: 0, tz: 0, ry: 90 }, material: 'steel', role: 'mount', system: '베어링', detail: 2 },
  );

  // Fan and axial compressor rows use actual closed NACA-derived loft meshes.
  parts.push(ringPart('fan_rotor', xInletEnd * 0.72, Math.max(12, compressorBlades), compressorRoot, fanTip, fanDiameter * 0.12, fanDiameter * 0.9, '2412', 'aluminum', '팬'));
  const compressorStart = xInletEnd + (xCompressorEnd - xInletEnd) * 0.12;
  const compressorSpan = (xCompressorEnd - xInletEnd) * 0.78;
  for (let index = 0; index < compressorStages; index++) {
    const x = compressorStart + (compressorSpan * index) / Math.max(1, compressorStages - 1);
    const taper = 1 - 0.18 * (index / Math.max(1, compressorStages - 1));
    parts.push(ringPart(`compressor_rotor_${index + 1}`, x, compressorBlades, compressorRoot, compressorTip * taper, fanDiameter * 0.075, fanDiameter * (0.65 - index * 0.025), '4412', 'aluminum', '축류 압축기'));
  }

  // Annular combustor liner plus an annular fuel-manifold representation.
  const combustorX = xCompressorEnd + (xCombustorEnd - xCompressorEnd) * 0.1;
  const combustorLength = (xCombustorEnd - xCompressorEnd) * 0.78;
  parts.push(
    { id: 'annular_combustor_liner', type: 'tube', params: { outerDia: combustorOD, innerDia: combustorID, length: combustorLength }, at: { tx: combustorX, ty: 0, tz: 0, ry: 90 }, material: 'STS316', role: 'vessel', system: '환형 연소기' },
    { id: 'fuel_manifold_ring', type: 'tube', params: { outerDia: fanDiameter * 0.79, innerDia: fanDiameter * 0.73, length: Math.max(12, overallLength * 0.012) }, at: { tx: combustorX + combustorLength * 0.12, ty: 0, tz: 0, ry: 90 }, material: 'STS316', role: 'pipe', system: '연료 매니폴드', detail: 2 },
  );

  const turbineStart = xCombustorEnd + (xTurbineEnd - xCombustorEnd) * 0.22;
  const turbineSpan = (xTurbineEnd - xCombustorEnd) * 0.56;
  for (let index = 0; index < turbineStages; index++) {
    const x = turbineStart + (turbineSpan * index) / Math.max(1, turbineStages - 1);
    parts.push(ringPart(`turbine_rotor_${index + 1}`, x, turbineBlades, turbineRoot, turbineTip, fanDiameter * 0.085, fanDiameter * 0.48, '6409', 'STS316', '축류 터빈'));
  }

  const area = (outerD, innerD) => Math.PI * (outerD ** 2 - innerD ** 2) / 4;
  return {
    name: `축류 터보제트 개념 조립체 D${Math.round(fanDiameter)}×L${Math.round(overallLength)}`,
    domain: 'mech',
    kind: 'assembly',
    parts,
    // A free-standing engine core does not have a floor footprint/support
    // declaration, so the generic furniture/equipment tip-over calculation is
    // misleading here. Jet-specific structural/thermal checks remain explicit
    // in jetEngineMeta.notVerified until their dedicated solvers exist.
    analysisPolicy: { genericStructural: false },
    jetEngineMeta: {
      engineType: 'turbojet-concept',
      overallLengthMm: overallLength,
      fanDiameterMm: fanDiameter,
      compressorStages,
      compressorBladesPerRow: compressorBlades,
      turbineStages,
      turbineBladesPerRow: turbineBlades,
      flowPath: [
        { station: 'inlet', outerDiaMm: caseID, hubDiaMm: shaftD, annulusAreaMm2: +area(caseID, shaftD).toFixed(1) },
        { station: 'compressor-exit', outerDiaMm: caseID * 0.84, hubDiaMm: compressorRoot * 2, annulusAreaMm2: +area(caseID * 0.84, compressorRoot * 2).toFixed(1) },
        { station: 'combustor', outerDiaMm: combustorOD, innerDiaMm: combustorID, annulusAreaMm2: +area(combustorOD, combustorID).toFixed(1) },
        { station: 'turbine', outerDiaMm: turbineID, hubDiaMm: turbineRoot * 2, annulusAreaMm2: +area(turbineID, turbineRoot * 2).toFixed(1) },
      ],
      analysisLevel: 'preliminary-1D-geometry',
      notVerified: ['CFD pressure/temperature field', 'combustion stability', 'blade stress/creep', 'rotordynamics', 'containment', 'airworthiness'],
    },
    note: '개념 CAD: NACA 파생 축류 블레이드 링·환형 연소기·축방향 유로를 형상화. CFD/연소/열/로터동역학/인증 결과가 아니며 고온부 재질은 실제 등급 선정이 필요합니다.',
  };
}

function firstNumber(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return Number(match[1]);
  }
  return undefined;
}

/** Reliable template routing for Korean/English jet-engine requests. */
export function inferJetEngineTemplate(description) {
  const text = String(description ?? '');
  // Keep the Korean spellings escaped as well as the legacy mojibake spellings
  // below.  This source file is deployed as UTF-8, while older builds were
  // decoded as CP949 and silently lost the routing match.
  const jetIntent = /(?:\uD130\uBCF4\s*\uC81C\uD2B8|\uD130\uBCF4\s*\uD32C|\uC81C\uD2B8\s*\uC5D4\uC9C4|\uAC00\uC2A4\s*\uD130\uBE48|터보\s*제트|터보\s*팬|제트\s*엔진|가스\s*터빈|turbo\s*jet|turbo\s*fan|jet\s*engine|gas\s*turbine)/i;
  if (!jetIntent.test(text)) return null;
  const params = {};
  const fanDiameter = firstNumber(text, [/(?:팬|fan)\s*(?:직경|지름|diameter)?\s*[Øø⌀]?\s*(\d+(?:\.\d+)?)/i, /[Øø⌀]\s*(\d+(?:\.\d+)?)\s*mm/i]);
  const overallLength = firstNumber(text, [/(?:전체\s*길이|전장|overall\s*length)\s*[:=]?\s*(\d+(?:\.\d+)?)/i, /(?:길이|length)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*mm/i]);
  const casingThickness = firstNumber(text, [/(?:케이싱|casing)[^\d]{0,24}(?:두께|thickness|\bt)\s*[:=]?\s*(\d+(?:\.\d+)?)/i]);
  const compressorStages = firstNumber(text, [/(\d+)\s*단\s*(?:축류\s*)?압축기/i, /(\d+)\s*[- ]?stage\s*(?:axial\s*)?compressor/i]);
  const compressorBlades = firstNumber(text, [/(?:압축기|compressor)[^\d]{0,24}(\d+)\s*(?:개|매)?\s*(?:블레이드|blade)/i]);
  const turbineStages = firstNumber(text, [/(\d+)\s*단\s*터빈/i, /(\d+)\s*[- ]?stage\s*turbine/i]);
  const turbineBlades = firstNumber(text, [/(?:터빈|turbine)[^\d]{0,24}(\d+)\s*(?:개|매)?\s*(?:블레이드|blade)/i]);
  for (const [key, value] of Object.entries({ fanDiameter, overallLength, casingThickness, compressorStages, compressorBlades, turbineStages, turbineBlades })) {
    if (Number.isFinite(value)) params[key] = value;
  }
  return { name: '축류 터보제트 개념 조립체', template: { domain: 'mech', id: 'turbojet_concept', params } };
}

/**
 * Detect the former LLM fallback that represented a jet engine with only
 * cylinders/boxes.  It must be upgraded as geometry; moving those proxy parts
 * cannot create a compressor, combustor, turbine, or valid flow path.
 */
export function looksLikeLegacyJetProxy(assembly) {
  if (!assembly || !Array.isArray(assembly.parts) || assembly.jetEngineMeta) return false;
  const text = [assembly.name, assembly.note, ...assembly.parts.flatMap((part) => [part.id, part.name, part.system, part.role])]
    .filter(Boolean).join(' ').toLowerCase();
  const jetNamed = /(?:터보\s*제트|제트\s*엔진|가스\s*터빈|turbo\s*jet|jet\s*engine|gas\s*turbine)/i.test(text);
  const subsystems = [/(?:압축기|compressor)/i, /(?:연소기|combust)/i, /(?:터빈|turbine)/i]
    .filter((pattern) => pattern.test(text)).length;
  const realBladeRows = assembly.parts.filter((part) => part?.type === 'mesh' && part?.gen?.kind === 'blade_ring').length;
  const primitiveCount = assembly.parts.filter((part) => ['box', 'cylinder', 'tube', 'pipe_reducer'].includes(part?.type)).length;
  return (jetNamed || subsystems >= 3) && realBladeRows === 0 && primitiveCount >= Math.min(4, assembly.parts.length);
}

/** Recover only the broad envelope/stage counts before replacing legacy proxy geometry. */
export function legacyJetEnvelope(assembly) {
  const parts = Array.isArray(assembly?.parts) ? assembly.parts : [];
  const lengthValues = [];
  const diameterValues = [];
  for (const part of parts) {
    const params = part?.params && typeof part.params === 'object' ? part.params : {};
    for (const key of ['length', 'height']) {
      const value = Number(params[key]);
      if (Number.isFinite(value) && value > 0) lengthValues.push(value);
    }
    for (const key of ['diameter', 'outerDia', 'dia1', 'dia2']) {
      const value = Number(params[key]);
      if (Number.isFinite(value) && value > 0) diameterValues.push(value);
    }
  }
  const ids = parts.map((part) => String(part?.id ?? part?.system ?? '')).join(' ');
  const compressorStages = Math.max(2, (ids.match(/compressor(?:_rotor|_disc)?[_-]?\d+/gi) ?? []).length || 5);
  const turbineStages = Math.max(1, (ids.match(/turbine(?:_rotor|_disc)?[_-]?\d+/gi) ?? []).length || 2);
  return {
    overallLength: clamp(Math.max(...lengthValues, 1500), 700, 5000),
    fanDiameter: clamp(Math.max(...diameterValues, 500), 180, 1800),
    compressorStages: clamp(compressorStages, 2, 12),
    turbineStages: clamp(turbineStages, 1, 5),
  };
}
