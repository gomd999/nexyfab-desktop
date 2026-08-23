import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_DEMO_AUTH_BODY_BYTES = 8 * 1024;

const DEMO_USERS = {
  customer: {
    sub: 'demo-customer-001',
    name: 'Demo 고객사',
    email: 'demo-customer@nexyfab.com',
    role: 'customer',
    is_demo: true,
    services: ['nexyfab'],
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo-customer',
    language: 'ko',
    title: '데모 고객 계정',
    plan: 'pro',
    company: 'Demo Corp',
  },
  partner: {
    sub: 'demo-partner-001',
    name: 'Demo 파트너사',
    email: 'demo-partner@nexyfab.com',
    role: 'partner',
    is_demo: true,
    services: ['nexyfab'],
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo-partner',
    language: 'ko',
    title: '데모 파트너 계정',
    plan: 'pro',
    company: 'Demo Manufacturer',
  },
};

export async function POST(req: NextRequest) {
  let body: { role?: string };
  try { body = await readBoundedJson(req, MAX_DEMO_AUTH_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    throw error;
  }
  const { role } = body;

  const user = DEMO_USERS[role as keyof typeof DEMO_USERS];
  if (!user) {
    return NextResponse.json({ error: 'Invalid demo role' }, { status: 400 });
  }

  return NextResponse.json({ user });
}
