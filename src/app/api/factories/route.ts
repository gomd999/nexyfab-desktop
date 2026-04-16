import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data', 'factories.db');

// ── 한국 지역 키워드 ──────────────────────────────────────────────────────────
const KO_REGION_KEYWORDS: Record<string, string[]> = {
  수도권: ['서울', '경기', '인천'],
  경상: ['경북', '경남', '대구', '부산', '울산'],
  전라: ['전북', '전남', '광주'],
  충청: ['충북', '충남', '대전', '세종'],
  강원: ['강원'],
  제주: ['제주'],
};

// ── 한국 업종 필터 → LIKE 키워드 ─────────────────────────────────────────────
const KO_INDUSTRY_FILTER: Record<string, string> = {
  절삭·가공:  '절삭가공',
  금형:       '금형',
  배전·전장:  '배전반',
  자동차부품: '자동차용',
  금속가공:   '금속가공',
  플라스틱:   '플라스틱',
  전자부품:   '전자부품',
  반도체장비: '반도체',
  도금·도장:  '도금',
  선박:       '선박',
};

// ── 중국 성(省) 한글명 ────────────────────────────────────────────────────────
const CN_PROVINCE_KO: Record<string, string> = {
  河北: '허베이', 山东: '산둥', 江苏: '장쑤', 广东: '광둥',
  河南: '허난', 浙江: '저장', 上海: '상하이', 四川: '쓰촨',
  北京: '베이징', 湖北: '후베이', 天津: '톈진', 安徽: '안후이',
  陕西: '산시', 辽宁: '랴오닝', 重庆: '충칭', 福建: '푸젠',
  湖南: '후난', 吉林: '지린', 黑龙江: '헤이룽장',
};

// 한글 지역명 → 중국어 성명 역변환
const CN_KO_TO_ZH: Record<string, string> = Object.fromEntries(
  Object.entries(CN_PROVINCE_KO).map(([zh, ko]) => [ko, zh])
);

function extractKoRegion(address: string): string {
  if (!address) return '';
  for (const [region, keywords] of Object.entries(KO_REGION_KEYWORDS)) {
    if (keywords.some(k => address.includes(k))) return region;
  }
  return '';
}

function extractCnProvince(address: string): { zh: string; ko: string } {
  if (!address) return { zh: '', ko: '' };
  const zh = address.trim().split(/\s+/)[0] || '';
  return { zh, ko: CN_PROVINCE_KO[zh] || zh };
}

// ── GET /api/factories/?country=ko&field=금형&region=수도권&search=ABC&page=1 ─
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const country   = (searchParams.get('country') || 'ko').toLowerCase();  // 'ko' | 'cn'
  const field     = searchParams.get('field') || '';
  const region    = searchParams.get('region') || '';
  const search    = (searchParams.get('search') || '').trim();
  const page      = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit     = Math.min(96, Math.max(12, parseInt(searchParams.get('limit') || '48', 10)));
  const offset    = (page - 1) * limit;
  const dbCountry = country === 'cn' ? 'CN' : 'KO';

  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    // ── WHERE 절 ────────────────────────────────────────────────────────────
    const conds: string[] = ['country = ?'];
    const params: unknown[] = [dbCountry];

    if (search) {
      conds.push('search_text LIKE ?');
      params.push(`%${search}%`);
    }

    if (country === 'ko' && field && KO_INDUSTRY_FILTER[field]) {
      conds.push('industry LIKE ?');
      params.push(`%${KO_INDUSTRY_FILTER[field]}%`);
    }

    // 한국 지역 필터 → DB단 WHERE (address에 키워드 포함 여부)
    if (country === 'ko' && region && region !== '전체') {
      const keywords = KO_REGION_KEYWORDS[region] || [];
      if (keywords.length > 0) {
        const kConds = keywords.map(() => 'address LIKE ?').join(' OR ');
        conds.push(`(${kConds})`);
        keywords.forEach(k => params.push(`%${k}%`));
      }
    }

    // 중국 지역 필터 → DB단 WHERE (address가 '广东 ...' 형식)
    if (country === 'cn' && region && region !== '전체') {
      const zh = CN_KO_TO_ZH[region] || region;
      conds.push('address LIKE ?');
      params.push(`${zh}%`);
    }

    const where = `WHERE ${conds.join(' AND ')}`;

    // 총 건수
    const totalRow = db.prepare(
      `SELECT COUNT(*) as c FROM factories ${where}`
    ).get(...params) as { c: number };
    let total = totalRow.c;

    // 데이터 조회
    const rows = db.prepare(
      `SELECT id, name, product, industry, address FROM factories ${where} ORDER BY id LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as Array<{
      id: number; name: string; product: string;
      industry: string; address: string;
    }>;

    // 매핑
    let factories = rows.map(row => {
      const tags = (row.product || '')
        .split(/[,·\/]+/)
        .map((t: string) => t.trim())
        .filter(Boolean)
        .slice(0, 5);

      if (country === 'cn') {
        const prov = extractCnProvince(row.address);
        return {
          id: String(row.id),
          company: row.name || '(미입력)',
          tags,
          industry: row.industry || '',
          regionKo: prov.ko,
          regionZh: prov.zh,
          address: row.address || '',
          country: 'cn',
        };
      } else {
        return {
          id: String(row.id),
          company: row.name || '(미입력)',
          tags,
          industry: row.industry || '',
          region: extractKoRegion(row.address),
          address: row.address || '',
          country: 'ko',
        };
      }
    });

    const res = NextResponse.json({
      factories,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
    res.headers.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    return res;

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[factories API] factories.db error:', errMsg, err);
    // DEV: expose error so we can diagnose
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.json({ factories: [], total: 0, page: 1, totalPages: 0, _devError: errMsg }, { status: 500 });
    }
    // Fallback: serve from nf_factories (main DB)
    try {
      const { getDbAdapter } = await import('@/lib/db-adapter');
      const { MANUFACTURERS } = await import('@/app/api/nexyfab/manufacturers/manufacturers-data');
      const mainDb = getDbAdapter();

      // Auto-seed if empty
      const cnt = await mainDb.queryOne<{ c: number }>('SELECT COUNT(*) as c FROM nf_factories').catch(() => ({ c: 0 }));
      if ((cnt?.c ?? 0) === 0) {
        const now = Date.now();
        for (const m of MANUFACTURERS) {
          await mainDb.execute(
            `INSERT OR IGNORE INTO nf_factories
              (id, name, name_ko, region, processes, min_lead_time, max_lead_time,
               rating, review_count, price_level, certifications, description,
               description_ko, contact_email, contact_phone, website, status, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            m.id, m.name, m.nameKo ?? m.name, m.region,
            JSON.stringify(m.processes), m.minLeadTime, m.maxLeadTime,
            m.rating, m.reviewCount, m.priceLevel,
            JSON.stringify(m.certifications),
            m.description ?? null, m.descriptionKo ?? null,
            null, null, null, 'active', now, now,
          ).catch(() => {});
        }
      }

      const rows = await mainDb.queryAll<{
        id: string; name: string; name_ko: string | null;
        region: string; processes: string; description_ko: string | null;
      }>(`SELECT id, name, name_ko, region, processes, description_ko FROM nf_factories WHERE status = 'active' ORDER BY rating DESC`);

      const factories = rows.map(r => {
        const procs: string[] = (() => { try { return JSON.parse(r.processes); } catch { return []; } })();
        return {
          id: r.id,
          company: r.name_ko ?? r.name,
          tags: procs.slice(0, 5),
          industry: procs[0] ?? '',
          region: r.region,
          address: r.region,
          country: 'ko',
        };
      });

      const page2 = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10));
      const limit2 = 48;
      const sliced = factories.slice((page2 - 1) * limit2, page2 * limit2);
      return NextResponse.json({ factories: sliced, total: factories.length, page: page2, totalPages: Math.ceil(factories.length / limit2) });
    } catch (e2) {
      console.error('[factories API] fallback also failed:', e2);
      return NextResponse.json({ factories: [], total: 0, page: 1, totalPages: 0 }, { status: 500 });
    }
  } finally {
    db?.close();
  }
}
