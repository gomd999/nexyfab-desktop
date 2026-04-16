// Tauri static export 빌드 시 모든 API 라우트를 이 스텁으로 교체합니다.
// 실제 데스크톱 앱에서 API 호출은 https://nexyfab.com/api/... 로 직접 갑니다.
import { NextResponse } from 'next/server';

export const dynamic = 'force-static';
export const dynamicParams = false;
export function generateStaticParams() { return []; }

export async function GET() {
  return NextResponse.json({ error: 'API not available in desktop mode' }, { status: 404 });
}
export async function POST() {
  return NextResponse.json({ error: 'API not available in desktop mode' }, { status: 404 });
}
export async function PUT() {
  return NextResponse.json({ error: 'API not available in desktop mode' }, { status: 404 });
}
export async function DELETE() {
  return NextResponse.json({ error: 'API not available in desktop mode' }, { status: 404 });
}
export async function PATCH() {
  return NextResponse.json({ error: 'API not available in desktop mode' }, { status: 404 });
}
