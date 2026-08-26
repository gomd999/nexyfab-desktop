import { describe, expect, it } from 'vitest';
import { buildContractExport } from './i18n';

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/u;

describe('buildContractExport', () => {
  it.each(['kr', 'en', 'ja', 'cn', 'es', 'ar'])('localizes headers, sheets, dates, and statuses for %s', lang => {
    const result = buildContractExport([
      { id: 'c1', project_name: 'Project', customer_email: 'a@example.com', factory_name: 'Factory', contract_amount: 1000, commission_rate: 0.1, final_charge: 1100, status: 'completed', created_at: '2026-08-26T00:00:00.000Z' },
    ], [
      { id: 'r1', shape_name: 'Bracket', material_id: 'AL6061', quantity: 2, status: 'pending', quote_amount: 500, created_at: Date.parse('2026-08-26T00:00:00.000Z') },
    ], lang);

    expect(result.contractRows).toHaveLength(1);
    expect(result.rfqRows).toHaveLength(1);
    const visibleCopy = JSON.stringify({ sheets: result.sheetNames, contract: result.contractRows, rfq: result.rfqRows });
    if (lang !== 'kr') expect(visibleCopy).not.toMatch(HANGUL);
  });
});
