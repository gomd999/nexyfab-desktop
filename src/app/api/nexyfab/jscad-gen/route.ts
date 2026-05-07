/**
 * POST /api/nexyfab/jscad-gen
 * 권장 엔드포인트 — 본문·동작은 `openscad-gen`과 동일(JSCAD 코드만 생성).
 * @see ../openscad-gen/route.ts
 */
export const dynamic = 'force-dynamic';

export { POST } from '../openscad-gen/route';
