import { DESIGN_DOMAIN_IDS, type DesignDomainId } from './domainProfile';
import { DOMAIN_PROFILES } from './domainProfileRegistry';

/**
 * A format being listed in a domain profile does not by itself mean that it is
 * release-ready. This registry is the single truthful capability boundary for
 * imports shown by domain UX and release evidence.
 */
export type DomainFormatSupport =
  | 'verified'
  | 'preview'
  | 'optional_external'
  | 'unsupported';

export type DomainFormatFidelity =
  | 'exact-exchange'
  | 'semantic-exchange'
  | 'mesh'
  | 'two-dimensional'
  | 'approximate'
  | 'not-available';

export interface DomainFormatCapability {
  format: string;
  support: DomainFormatSupport;
  fidelity: DomainFormatFidelity;
  releaseClaimAllowed: boolean;
  externalCadRequired: boolean;
  note: string;
}

export const DOMAIN_FORMAT_SUPPORT = {
  mechanical: [
    { format: 'step', support: 'verified', fidelity: 'exact-exchange', releaseClaimAllowed: true, externalCadRequired: false, note: 'Standalone STEP exchange path has executable corpus evidence.' },
    { format: 'iges', support: 'preview', fidelity: 'exact-exchange', releaseClaimAllowed: false, externalCadRequired: false, note: 'Exchange import is available, but release-grade corpus evidence is incomplete.' },
    { format: 'sat', support: 'preview', fidelity: 'exact-exchange', releaseClaimAllowed: false, externalCadRequired: false, note: 'Exchange import is available, but release-grade corpus evidence is incomplete.' },
    { format: 'x_t', support: 'preview', fidelity: 'approximate', releaseClaimAllowed: false, externalCadRequired: false, note: 'The standalone reader is explicitly approximate; native semantic fidelity is not claimed.' },
    { format: 'stl', support: 'verified', fidelity: 'mesh', releaseClaimAllowed: true, externalCadRequired: false, note: 'Standalone mesh import is corpus-verified; parametric and B-Rep semantics are not present in STL.' },
    { format: 'dxf', support: 'verified', fidelity: 'two-dimensional', releaseClaimAllowed: true, externalCadRequired: false, note: 'Standalone 2D exchange path is corpus-verified; this is not a native 3D CAD claim.' },
  ],
  building: [
    { format: 'ifc', support: 'verified', fidelity: 'semantic-exchange', releaseClaimAllowed: true, externalCadRequired: false, note: 'Standalone IFC path has executable semantic evidence; per-property round-trip depth remains separately gated.' },
    { format: 'rvt', support: 'optional_external', fidelity: 'not-available', releaseClaimAllowed: false, externalCadRequired: true, note: 'Direct RVT requires an optional licensed worker. The standalone workflow uses IFC instead.' },
    { format: 'dwg', support: 'preview', fidelity: 'approximate', releaseClaimAllowed: false, externalCadRequired: false, note: 'The standalone DWG reader is approximate and cannot claim native object semantics.' },
    { format: 'dxf', support: 'verified', fidelity: 'two-dimensional', releaseClaimAllowed: true, externalCadRequired: false, note: 'Standalone 2D exchange path is corpus-verified.' },
    { format: 'point-cloud', support: 'unsupported', fidelity: 'not-available', releaseClaimAllowed: false, externalCadRequired: false, note: 'No building-domain point-cloud production adapter is release-evidenced yet.' },
  ],
  civil: [
    { format: 'landxml', support: 'preview', fidelity: 'semantic-exchange', releaseClaimAllowed: false, externalCadRequired: false, note: 'Alignment and profile parsing exists, but spiral, compound curves, CRS interpretation and full corridor semantics are incomplete.' },
    { format: 'ifc', support: 'verified', fidelity: 'semantic-exchange', releaseClaimAllowed: true, externalCadRequired: false, note: 'Standalone IFC path has executable semantic evidence; civil-specific release depth remains separately gated.' },
    { format: 'dwg', support: 'preview', fidelity: 'approximate', releaseClaimAllowed: false, externalCadRequired: false, note: 'The standalone DWG reader is approximate and cannot claim native object semantics.' },
    { format: 'dxf', support: 'verified', fidelity: 'two-dimensional', releaseClaimAllowed: true, externalCadRequired: false, note: 'Standalone 2D exchange path is corpus-verified.' },
    { format: 'csv-pnezd', support: 'unsupported', fidelity: 'not-available', releaseClaimAllowed: false, externalCadRequired: false, note: 'No PNEZD survey adapter with CRS and unit validation is release-evidenced yet.' },
    { format: 'dem', support: 'unsupported', fidelity: 'not-available', releaseClaimAllowed: false, externalCadRequired: false, note: 'No DEM terrain production adapter is release-evidenced yet.' },
    { format: 'point-cloud', support: 'unsupported', fidelity: 'not-available', releaseClaimAllowed: false, externalCadRequired: false, note: 'No civil-domain point-cloud production adapter is release-evidenced yet.' },
  ],
  landscape: [
    { format: 'landxml', support: 'preview', fidelity: 'semantic-exchange', releaseClaimAllowed: false, externalCadRequired: false, note: 'Partial standalone LandXML support exists; terrain, grading and CRS coverage is not release-complete.' },
    { format: 'ifc', support: 'verified', fidelity: 'semantic-exchange', releaseClaimAllowed: true, externalCadRequired: false, note: 'Standalone IFC path has executable semantic evidence; landscape property depth remains separately gated.' },
    { format: 'dwg', support: 'preview', fidelity: 'approximate', releaseClaimAllowed: false, externalCadRequired: false, note: 'The standalone DWG reader is approximate and cannot claim native object semantics.' },
    { format: 'dxf', support: 'verified', fidelity: 'two-dimensional', releaseClaimAllowed: true, externalCadRequired: false, note: 'Standalone 2D exchange path is corpus-verified.' },
    { format: 'csv', support: 'unsupported', fidelity: 'not-available', releaseClaimAllowed: false, externalCadRequired: false, note: 'No landscape schedule/plant CSV contract is release-evidenced yet.' },
    { format: 'gis', support: 'unsupported', fidelity: 'not-available', releaseClaimAllowed: false, externalCadRequired: false, note: 'No CRS-aware GIS production adapter is release-evidenced yet.' },
  ],
  interior: [
    { format: 'ifc', support: 'verified', fidelity: 'semantic-exchange', releaseClaimAllowed: true, externalCadRequired: false, note: 'Standalone IFC path has executable semantic evidence; interior property depth remains separately gated.' },
    { format: 'rvt', support: 'optional_external', fidelity: 'not-available', releaseClaimAllowed: false, externalCadRequired: true, note: 'Direct RVT requires an optional licensed worker. The standalone workflow uses IFC instead.' },
    { format: 'skp', support: 'unsupported', fidelity: 'not-available', releaseClaimAllowed: false, externalCadRequired: false, note: 'No standalone SKP production adapter is release-evidenced yet.' },
    { format: 'dwg', support: 'preview', fidelity: 'approximate', releaseClaimAllowed: false, externalCadRequired: false, note: 'The standalone DWG reader is approximate and cannot claim native object semantics.' },
    { format: 'dxf', support: 'verified', fidelity: 'two-dimensional', releaseClaimAllowed: true, externalCadRequired: false, note: 'Standalone 2D exchange path is corpus-verified.' },
  ],
} as const satisfies Record<DesignDomainId, readonly DomainFormatCapability[]>;

export function getDomainFormatCapabilities(domain: DesignDomainId): readonly DomainFormatCapability[] {
  return DOMAIN_FORMAT_SUPPORT[domain];
}

/** Formats usable without proprietary desktop CAD. Preview formats remain visibly non-release. */
export function getStandaloneImportFormats(domain: DesignDomainId): readonly DomainFormatCapability[] {
  return DOMAIN_FORMAT_SUPPORT[domain].filter(capability =>
    !capability.externalCadRequired
    && (capability.support === 'verified' || capability.support === 'preview'),
  );
}

export function validateDomainFormatSupport(): string[] {
  const issues: string[] = [];

  for (const domain of DESIGN_DOMAIN_IDS) {
    const declared = DOMAIN_PROFILES[domain].importFormats;
    const capabilities: readonly DomainFormatCapability[] = DOMAIN_FORMAT_SUPPORT[domain];
    const actual = capabilities.map(item => item.format);
    const declaredFormats = new Set<string>(declared);
    const actualFormats = new Set<string>(actual);

    if (actualFormats.size !== actual.length) issues.push(`${domain}: duplicate format capability`);
    for (const format of declared) if (!actualFormats.has(format)) issues.push(`${domain}: missing capability:${format}`);
    for (const format of actual) if (!declaredFormats.has(format)) issues.push(`${domain}: undeclared capability:${format}`);

    for (const capability of capabilities) {
      if (capability.releaseClaimAllowed !== (capability.support === 'verified')) {
        issues.push(`${domain}:${capability.format}: release claim/status mismatch`);
      }
      if (capability.externalCadRequired !== (capability.support === 'optional_external')) {
        issues.push(`${domain}:${capability.format}: external CAD/status mismatch`);
      }
      if (capability.support === 'unsupported' && capability.fidelity !== 'not-available') {
        issues.push(`${domain}:${capability.format}: unsupported fidelity mismatch`);
      }
    }
  }

  return issues;
}
