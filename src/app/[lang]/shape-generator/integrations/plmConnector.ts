/**
 * PLM / ERP REST connector (F9).
 *
 * B2B enterprise integration: push BOM line items, drawing PDFs, and project
 * metadata to systems like SAP, Oracle, Odoo, Windchill, Teamcenter via
 * REST. Built as an adapter pattern — each system has its own auth + payload
 * shape but the caller-facing API is uniform.
 *
 * Security note: API tokens are sent as Authorization headers. Customers
 * should configure them via the platform's secrets store (Cloudflare KV
 * or similar) — never hard-coded. The frontend asks the user for the token
 * once and stores it in the encrypted preference layer.
 */

export type PlmProvider = 'sap' | 'oracle' | 'odoo' | 'windchill' | 'teamcenter' | 'generic';

export interface PlmEndpoint {
  provider: PlmProvider;
  /** Base URL — e.g. "https://erp.acme.com/api/v2" */
  baseUrl: string;
  /** Bearer token / API key. */
  token: string;
  /** Optional system tenant id (Salesforce-style multi-tenant). */
  tenantId?: string;
  /** Custom HTTP headers — appended to every request. */
  extraHeaders?: Record<string, string>;
}

export interface BomLineForPlm {
  partNumber: string;
  description?: string;
  quantity: number;
  material?: string;
  mass_g?: number;
  /** UoM — defaults to "EA" (each). */
  unit?: string;
}

export interface PlmPushPayload {
  projectName: string;
  projectId?: string;
  revision?: string;
  bomLines: BomLineForPlm[];
  /** Optional drawing attachment as data URL or remote URL. */
  drawingUrl?: string;
  /** Free-form metadata that the receiving system understands. */
  customFields?: Record<string, string | number>;
}

export interface PlmPushResult {
  ok: boolean;
  /** PLM-side identifier of the created/updated record (if returned). */
  remoteId?: string;
  /** HTTP status code from the upstream system. */
  status?: number;
  /** Error message when ok=false. */
  error?: string;
}

// ─── Provider-specific payload adapters ──────────────────────────────────────

function buildSapPayload(p: PlmPushPayload) {
  return {
    Header: {
      Material: p.projectName,
      ChangeNumber: p.revision ?? '',
    },
    Items: p.bomLines.map((b, i) => ({
      ItemNo: String((i + 1) * 10).padStart(4, '0'),
      Component: b.partNumber,
      Quantity: b.quantity,
      Unit: b.unit ?? 'EA',
      Description: b.description ?? '',
    })),
    ...(p.customFields ?? {}),
  };
}

function buildOdooPayload(p: PlmPushPayload) {
  return {
    name: p.projectName,
    code: p.projectId,
    bom_line_ids: p.bomLines.map(b => ({
      product_tmpl_id: b.partNumber,
      product_qty: b.quantity,
      product_uom: b.unit ?? 'EA',
    })),
  };
}

function buildWindchillPayload(p: PlmPushPayload) {
  return {
    type: 'wt.part.WTPart',
    number: p.projectName,
    revision: p.revision ?? 'A',
    components: p.bomLines.map(b => ({
      number: b.partNumber,
      quantity: b.quantity,
      unit: b.unit ?? 'EA',
    })),
  };
}

function buildGenericPayload(p: PlmPushPayload) {
  // Plain JSON envelope — for Teamcenter REST, Oracle Agile, custom REST.
  return {
    project: {
      name: p.projectName,
      id: p.projectId,
      revision: p.revision,
    },
    bom: p.bomLines,
    drawing: p.drawingUrl,
    metadata: p.customFields,
  };
}

function buildPayload(p: PlmPushPayload, provider: PlmProvider): unknown {
  switch (provider) {
    case 'sap':       return buildSapPayload(p);
    case 'odoo':      return buildOdooPayload(p);
    case 'windchill': return buildWindchillPayload(p);
    case 'oracle':
    case 'teamcenter':
    case 'generic':
    default:          return buildGenericPayload(p);
  }
}

// ─── Endpoint paths ──────────────────────────────────────────────────────────

const PUSH_PATHS: Record<PlmProvider, string> = {
  sap:        '/sap/opu/odata/sap/MM_BOM/BOMSet',
  oracle:     '/agile/v1/parts/bom',
  odoo:       '/web/dataset/call_kw/mrp.bom/create',
  windchill:  '/Windchill/servlet/odata/v6/PartMgmt/Parts',
  teamcenter: '/tc/JsonRestServices/Core-2007-01-Session/getStandardSession',
  generic:    '/bom/push',
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Push a BOM payload to the configured PLM/ERP system. Throws ONLY on
 * malformed inputs — network/auth failures are surfaced via the
 * `{ ok: false, error }` shape so the UI can render a localised error
 * without try/catch.
 */
export async function pushBomToPlm(
  endpoint: PlmEndpoint,
  payload: PlmPushPayload,
): Promise<PlmPushResult> {
  if (!endpoint.baseUrl) return { ok: false, error: 'baseUrl is required' };
  if (!endpoint.token) return { ok: false, error: 'API token is required' };
  if (!payload.bomLines || payload.bomLines.length === 0) {
    return { ok: false, error: 'BOM is empty' };
  }

  const url = endpoint.baseUrl.replace(/\/+$/, '') + PUSH_PATHS[endpoint.provider];
  const body = JSON.stringify(buildPayload(payload, endpoint.provider));

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${endpoint.token}`,
        ...(endpoint.tenantId ? { 'X-Tenant-Id': endpoint.tenantId } : {}),
        ...(endpoint.extraHeaders ?? {}),
      },
      body,
    });

    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch { /* ignore */ }
      return {
        ok: false,
        status: res.status,
        error: detail || `HTTP ${res.status}`,
      };
    }
    let remoteId: string | undefined;
    try {
      const json = await res.json();
      // Different PLMs return ID under different keys — try the common ones.
      remoteId =
        (json && (json.id ?? json.Id ?? json.objectId ?? json.remoteId)) as string | undefined;
    } catch {
      /* response body not JSON — that's fine */
    }
    return { ok: true, status: res.status, remoteId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Probe an endpoint without sending a real BOM — used by the UI's "Test
 * connection" button. Issues a HEAD/OPTIONS to the base URL.
 */
export async function testPlmConnection(endpoint: PlmEndpoint): Promise<PlmPushResult> {
  if (!endpoint.baseUrl) return { ok: false, error: 'baseUrl is required' };
  try {
    const res = await fetch(endpoint.baseUrl, {
      method: 'OPTIONS',
      headers: {
        ...(endpoint.token ? { 'Authorization': `Bearer ${endpoint.token}` } : {}),
        ...(endpoint.extraHeaders ?? {}),
      },
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
