import { describe, expect, it } from 'vitest';
import { buildLocalizedTabularExport, type TabularExportKind } from './i18n';

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/u;
const FIXTURES: Record<TabularExportKind, Record<string, unknown>> = {
  quotes: { id: 'q1', project_name: 'Project', factory_name: 'Factory', estimated_amount: 100, details: 'CNC', valid_until: '2026-08-27T00:00:00Z', partner_email: 'p@example.com', status: 'pending', created_at: '2026-08-26T00:00:00Z', updated_at: '2026-08-26T01:00:00Z' },
  audit: { id: 'a1', user_id: 'u1', action: 'login', resource_id: 'r1', metadata: '{}', ip: '127.0.0.1', created_at: Date.parse('2026-08-26T00:00:00Z') },
  rfqs: { id: 'r1', part_name: 'Part', material: 'AL6061', quantity: 2, quoted_price_krw: 100, status: 'accepted', note: '', created_at: Date.parse('2026-08-26T00:00:00Z'), updated_at: Date.parse('2026-08-26T01:00:00Z') },
  orders: { id: 'o1', rfq_id: 'r1', part_name: 'Part', manufacturer_name: 'Factory', quantity: 2, total_price_krw: 100, status: 'completed', created_at: Date.parse('2026-08-26T00:00:00Z'), estimated_delivery_at: Date.parse('2026-08-30T00:00:00Z') },
  'erp-quotes': { id: 'q1', rfq_id: 'r1', manufacturer_name: 'Factory', total_price_krw: 100, valid_until: '2026-08-27T00:00:00Z', status: 'responded', created_at: Date.parse('2026-08-26T00:00:00Z') },
};

describe('buildLocalizedTabularExport', () => {
  it.each(['kr', 'en', 'ja', 'cn', 'es', 'ar'])('localizes every tabular surface for %s', lang => {
    for (const [kind, fixture] of Object.entries(FIXTURES) as Array<[TabularExportKind, Record<string, unknown>]>) {
      const result = buildLocalizedTabularExport(kind, [fixture], lang);
      expect(result.sheetName).toBeTruthy();
      expect(result.rows[0]).toBeTruthy();
      if (lang !== 'kr') expect(JSON.stringify(result)).not.toMatch(HANGUL);
    }
  });
});
