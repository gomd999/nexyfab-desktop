/**
 * GET /api/factories/?country=ko|cn&field=금형&region=수도권&search=ABC&page=1
 *
 * 데이터 소스: nf_factories_directory (Postgres 또는 SQLite).
 * scripts/import-factories-directory.ts 로 legacy factories.db → nf_factories_directory
 * 1회 임포트한 뒤 모든 환경에서 동일하게 동작.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveServerLocale } from '@/lib/i18n/serverLocale';

export const dynamic = 'force-dynamic';

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
  '절삭·가공':  '절삭가공',
  '금형':       '금형',
  '배전·전장':  '배전반',
  '자동차부품': '자동차용',
  '금속가공':   '금속가공',
  '플라스틱':   '플라스틱',
  '전자부품':   '전자부품',
  '반도체장비': '반도체',
  '도금·도장':  '도금',
  '선박':       '선박',
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

function extractKoRegion(address: string | null): string {
  if (!address) return '';
  for (const [region, keywords] of Object.entries(KO_REGION_KEYWORDS)) {
    if (keywords.some(k => address.includes(k))) return region;
  }
  return '';
}

function extractCnProvince(address: string | null): { zh: string; ko: string } {
  if (!address) return { zh: '', ko: '' };
  const zh = address.trim().split(/\s+/)[0] || '';
  return { zh, ko: CN_PROVINCE_KO[zh] || zh };
}

function missingLabel(route: string): string {
  return route === 'kr' ? '\uBBF8\uC785\uB825'
    : route === 'ja' ? '\u672A\u5165\u529B'
      : route === 'cn' ? '\u672A\u586B\u5199'
        : route === 'es' ? 'Sin datos'
          : route === 'ar' ? '\u063A\u064A\u0631 \u0645\u062F\u062E\u0644'
            : 'Not provided';
}

function regionLabel(route: string, country: string, ko: string, zh: string): string {
  if (country === 'cn') return route === 'cn' ? zh : ko;
  return ko;
}

function directoryError(route: string): string {
  return route === 'kr' ? '\uACF5\uC7A5 \uB514\uB809\uD130\uB9AC\uB97C \uC77C\uC2DC\uC801\uC73C\uB85C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.'
    : route === 'ja' ? '\u5DE5\u5834\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u30FC\u306F\u4E00\u6642\u7684\u306B\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002'
      : route === 'cn' ? '\u5DE5\u5382\u76EE\u5F55\u6682\u65F6\u65E0\u6CD5\u4F7F\u7528\u3002'
        : route === 'es' ? 'El directorio de fábricas no está disponible temporalmente.'
          : route === 'ar' ? '\u062F\u0644\u064A\u0644 \u0627\u0644\u0645\u0635\u0627\u0646\u0639 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0645\u0624\u0642\u062A\u064B\u0627.'
            : 'The factory directory is temporarily unavailable.';
}

interface DirRow {
  id: number;
  country: string;
  name: string;
  product: string | null;
  industry: string | null;
  address: string | null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const locale = resolveServerLocale(req, searchParams.get('lang'));
  const missing = missingLabel(locale.route);
  const country   = (searchParams.get('country') || 'ko').toLowerCase();  // 'ko' | 'cn'
  const field     = searchParams.get('field') || '';
  const region    = searchParams.get('region') || '';
  const search    = (searchParams.get('search') || '').trim();
  const page      = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit     = Math.min(96, Math.max(12, parseInt(searchParams.get('limit') || '48', 10)));
  const offset    = (page - 1) * limit;
  const dbCountry = country === 'cn' ? 'CN' : 'KO';

  const db = getDbAdapter();

  // ── 단건 조회: ?id=… (디렉터리 문의 → 그 공장으로 라우팅) ────────────────
  // country/필터 무시하고 id로 직접 찾는다(공장의 실제 국가로 매핑).
  const idParam = (searchParams.get('id') || '').trim();
  if (idParam) {
    const row = await db.queryOne<DirRow>(
      `SELECT id, country, name, product, industry, address
         FROM nf_factories_directory WHERE id = ?`,
      idParam,
    );
    if (!row) {
      return NextResponse.json({ factories: [], total: 0, page: 1, totalPages: 0, outputLanguage: locale.route });
    }
    const tags = (row.product || '').split(/[,·\/]+/).map(t => t.trim()).filter(Boolean).slice(0, 5);
    const isCn = String(row.country).toUpperCase() === 'CN';
    const factory = isCn
      ? {
          id: String(row.id), company: row.name || missing, tags,
          industry: row.industry || '', regionKo: extractCnProvince(row.address).ko,
          regionZh: extractCnProvince(row.address).zh,
          regionLabel: regionLabel(locale.route, 'cn', extractCnProvince(row.address).ko, extractCnProvince(row.address).zh),
          address: row.address || '', country: 'cn' as const, displayLocale: locale.route,
        }
      : {
          id: String(row.id), company: row.name || missing, tags,
          industry: row.industry || '', region: extractKoRegion(row.address),
          regionLabel: extractKoRegion(row.address) || missing,
          address: row.address || '', country: 'ko' as const, displayLocale: locale.route,
        };
    return NextResponse.json({ factories: [factory], total: 1, page: 1, totalPages: 1, outputLanguage: locale.route });
  }

  // ── WHERE 절 (adapter 는 '?' placeholder 를 PG $N 로 자동 치환) ──────────
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

  // 한국 지역 필터 → DB단 WHERE (address 에 키워드 포함 여부)
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

  try {
    const totalRow = await db.queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM nf_factories_directory ${where}`,
      ...params,
    );
    const total = Number(totalRow?.c ?? 0);

    const rows = await db.queryAll<DirRow>(
      `SELECT id, country, name, product, industry, address
         FROM nf_factories_directory
         ${where}
         ORDER BY id
         LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );

    const factories = rows.map(row => {
      const tags = (row.product || '')
        .split(/[,·\/]+/)
        .map(t => t.trim())
        .filter(Boolean)
        .slice(0, 5);

      if (country === 'cn') {
        const prov = extractCnProvince(row.address);
        return {
          id: String(row.id),
          company: row.name || missing,
          tags,
          industry: row.industry || '',
          regionKo: prov.ko,
          regionZh: prov.zh,
          regionLabel: regionLabel(locale.route, 'cn', prov.ko, prov.zh),
          address: row.address || '',
          country: 'cn' as const,
          displayLocale: locale.route,
        };
      }
      return {
        id: String(row.id),
        company: row.name || missing,
        tags,
        industry: row.industry || '',
        region: extractKoRegion(row.address),
        regionLabel: extractKoRegion(row.address) || missing,
        address: row.address || '',
        country: 'ko' as const,
        displayLocale: locale.route,
      };
    });

    const res = NextResponse.json({
      factories,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      outputLanguage: locale.route,
    });
    res.headers.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    return res;

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[factories API] query failed:', errMsg);
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.json(
        { factories: [], total: 0, page: 1, totalPages: 0, outputLanguage: locale.route, error: directoryError(locale.route) },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { factories: [], total: 0, page: 1, totalPages: 0, outputLanguage: locale.route },
      { status: 500 },
    );
  }
}
