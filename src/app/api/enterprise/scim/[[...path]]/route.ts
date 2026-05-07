/**
 * SCIM 2.0 provisioning stub — enterprise IdP integration roadmap.
 * Returns 501 until full User/Group sync is implemented.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BODY = {
  error: 'SCIM provisioning is not enabled for this deployment.',
  code: 'SCIM_NOT_IMPLEMENTED',
  hint: 'Contact Nexyfab for enterprise SCIM / directory sync.',
};

function response(): NextResponse {
  return NextResponse.json(BODY, {
    status: 501,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  return response();
}

export async function POST(_req: NextRequest): Promise<NextResponse> {
  return response();
}

export async function PUT(_req: NextRequest): Promise<NextResponse> {
  return response();
}

export async function PATCH(_req: NextRequest): Promise<NextResponse> {
  return response();
}

export async function DELETE(_req: NextRequest): Promise<NextResponse> {
  return response();
}
