import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildAssemblyTemplate, listAssemblyTemplates } from './drawing-to-3d/domain-assemblies.mjs';
import { placedAabb } from './drawing-to-3d/assembly.mjs';

const DOMAIN_MAP = {
  mechanical: 'mech', civil: 'civil', building: 'building', landscape: 'landscape', interior: 'interior',
};
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
  : item);

/** 후보 생성과 캠페인 검증기가 공유하는 산출물 해시 — 알고리즘이 갈리면
 *  재빌드 결정론 판정 자체가 무의미해지므로 반드시 이 함수 하나만 쓴다. */
export const hashAssemblyArtifact = assembly => createHash('sha256').update(stable(assembly)).digest('hex');
export { DOMAIN_MAP as CANDIDATE_DOMAIN_MAP };
const clamp = (value, min, max) => Math.min(max ?? value, Math.max(min ?? value, value));

export function buildDomainCandidates(domain, count = 20) {
  const registryDomain = DOMAIN_MAP[domain];
  if (!registryDomain) throw new TypeError(`Unknown domain: ${domain}`);
  if (!Number.isSafeInteger(count) || count < 1) throw new TypeError('count must be a positive integer');
  const templates = listAssemblyTemplates(registryDomain);
  if (!templates.length) throw new TypeError(`No templates registered for ${domain}`);
  const candidates = [];
  const rejected = [];
  for (let index = 0; candidates.length < count && index < count * 20; index++) {
    const template = templates[index % templates.length];
    const cycle = Math.floor(index / templates.length);
    const factor = 0.8 + cycle * 0.04;
    const parameters = Object.fromEntries((template.params ?? []).map(param => {
      const base = Number(param.default);
      const varied = Number.isFinite(base) ? clamp(base * factor, param.min, param.max) : param.default;
      return [param.name, Number.isFinite(varied) ? +varied.toFixed(6) : varied];
    }));
    const assembly = buildAssemblyTemplate(registryDomain, template.id, parameters);
    const artifactHash = hashAssemblyArtifact(assembly);
    const source = { domain, templateId: template.id, parameters, artifactHash };
    const sourceHash = createHash('sha256').update(stable(source)).digest('hex');
    const roles = [...new Set((assembly.parts ?? []).map(part => part.role).filter(Boolean))].sort();
    // W1-3(260808b) — 검증기가 독립 재도출로 대조할 GT 3종: 전역 범위(transforms),
    // 구멍 총수(features), 계층 점유수(hierarchy). 전부 해석값(placedAabb·파라미터)
    // — 픽셀/메시 측정 아님.
    const parts = assembly.parts ?? [];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const part of parts) {
      const b = placedAabb(part);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], b.min[k]); max[k] = Math.max(max[k], b.max[k]); }
    }
    // 부품 레벨 rx/ry 회전(예: machine_line 롤러 rx=-90)은 placedAabb 의
    // 요-전용 어휘 밖 → NaN. 측정 불능은 null 로 명시(검증기 not_run 사유).
    const rawExtents = parts.length ? [0, 1, 2].map(k => +(max[k] - min[k]).toFixed(6)) : [0, 0, 0];
    const extents = rawExtents.every(Number.isFinite) ? rawExtents : null;
    const artifactSummary = {
      name: assembly.name ?? template.labelEn ?? template.id,
      partCount: parts.length,
      pipeCount: assembly.pipes?.length ?? 0,
      roles,
      alignmentErrors: assembly.alignmentErrors ?? [],
      unverifiedPartCount: parts.filter(part => part.unverified === true).length,
      extents,
      holeTotal: parts.reduce((n, part) => n + (Array.isArray(part.params?.holes) ? part.params.holes.length : 0), 0),
      occCount: parts.filter(part => part._occ).length,
    };
    if (artifactSummary.alignmentErrors.length || artifactSummary.unverifiedPartCount) {
      rejected.push({ templateId: template.id, cycle, artifactHash, artifactSummary });
      continue;
    }
    candidates.push({
      schema: 'nexyfab.domain-accuracy-candidate.v1',
      caseId: `${domain}-${template.id}-${String(cycle + 1).padStart(2, '0')}`,
      domain,
      sourceHash,
      sourceKind: 'internal-template',
      templateId: template.id,
      parameters,
      artifactHash,
      artifactSummary,
      split: 'candidate',
    });
  }
  if (candidates.length < count) throw new Error(`Only ${candidates.length}/${count} clean ${domain} candidates could be generated; rejected ${rejected.length}.`);
  return candidates;
}

export function parseArgs(args) {
  const value = name => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
  const domain = value('domain');
  const count = Number(value('count') ?? 20);
  if (!domain) throw new TypeError('--domain is required');
  return { domain, count };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const { domain, count } = parseArgs(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(buildDomainCandidates(domain, count), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
