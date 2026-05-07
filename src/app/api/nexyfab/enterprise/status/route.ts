/**
 * GET /api/nexyfab/enterprise/status
 * Public capability bits for status pages / integrations (no secrets).
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    product: 'nexyfab',
    enterpriseSurface: {
      auditLogApi: '/api/nexyfab/audit',
      auditExport: '/api/nexyfab/export/audit',
      ssoSettingsUi: '/en/nexyfab/settings/sso',
      scimStub: '/api/enterprise/scim',
      supportEmail: process.env.NEXYFAB_SUPPORT_EMAIL?.trim() || null,
      slaStatusUrl: process.env.NEXYFAB_SLA_STATUS_URL?.trim() || null,
      onPremDocs: process.env.NEXYFAB_ENTERPRISE_DOCS_URL?.trim() || null,
    },
    notes: {
      scim: 'SCIM endpoints return 501 until directory sync ships.',
      certifications: 'SOC2/ISO mappings are customer-contract dependent.',
    },
  });
}
