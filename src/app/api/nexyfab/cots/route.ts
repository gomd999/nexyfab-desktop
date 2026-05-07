import { NextRequest, NextResponse } from 'next/server';
import { COTS_PARTS, type COTSPart } from '@/app/[lang]/shape-generator/cots/cotsData';

// ─── GET /api/nexyfab/cots ────────────────────────────────────────────────────
// Query params:
//   q          — text search (name, nameKo, standard, id)
//   category   — bolt | nut | bearing | collar | clip | washer
//   supplier   — partial match on suppliers array
//   sort       — priceAsc | priceDesc | weightAsc
//   page       — 1-based (default 1)
//   limit      — items per page (default 20, max 100)

interface CotsResponse {
  parts: COTSPart[];
  total: number;
  page: number;
  totalPages: number;
}

export async function GET(req: NextRequest): Promise<NextResponse<CotsResponse>> {
  const sp = req.nextUrl.searchParams;

  const q         = (sp.get('q') ?? '').trim().toLowerCase();
  const category  = (sp.get('category') ?? '').trim().toLowerCase();
  const supplier  = (sp.get('supplier') ?? '').trim().toLowerCase();
  const sort      = sp.get('sort') ?? '';
  const pageParam = parseInt(sp.get('page') ?? '1', 10);
  const limitParam = Math.min(parseInt(sp.get('limit') ?? '20', 10), 100);

  const page  = isNaN(pageParam)  || pageParam  < 1 ? 1  : pageParam;
  const limit = isNaN(limitParam) || limitParam < 1 ? 20 : limitParam;

  // ── Filter ──────────────────────────────────────────────────────────────────
  let results = COTS_PARTS.filter(part => {
    if (category && part.category !== category) return false;
    if (supplier && !part.suppliers.some(s => s.toLowerCase().includes(supplier))) return false;
    if (q) {
      const haystack = `${part.id} ${part.name} ${part.nameKo} ${part.standard}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // ── Sort ────────────────────────────────────────────────────────────────────
  if (sort === 'priceAsc') {
    results = results.slice().sort((a, b) => a.unitPriceKRW - b.unitPriceKRW);
  } else if (sort === 'priceDesc') {
    results = results.slice().sort((a, b) => b.unitPriceKRW - a.unitPriceKRW);
  } else if (sort === 'weightAsc') {
    results = results.slice().sort((a, b) => a.unitWeightG - b.unitWeightG);
  }

  // ── Paginate ────────────────────────────────────────────────────────────────
  const total      = results.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage   = Math.min(page, totalPages);
  const offset     = (safePage - 1) * limit;
  const parts      = results.slice(offset, offset + limit);

  return NextResponse.json({ parts, total, page: safePage, totalPages }, { status: 200 });
}
