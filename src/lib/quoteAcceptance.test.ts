import { describe, expect, it } from 'vitest';
import type { DbAdapter, SqlParam } from './db-adapter';
import { acceptQuoteAtomically, type AcceptedQuoteInput } from './quoteAcceptance';

const hash = 'a'.repeat(64);
const quote: AcceptedQuoteInput = {
  id: 'quote-1',
  inquiryId: 'rfq-1',
  projectName: 'Precision bracket',
  factoryName: 'Factory A',
  estimatedAmount: 1_000_000,
  partnerEmail: 'Factory@Example.com',
  lineageId: 'lineage-1',
  artifactId: 'step-1',
  artifactSha256: hash,
  documentVersionId: 'rev-1',
};

class AcceptanceDb implements DbAdapter {
  readonly backend = 'sqlite' as const;
  quoteStatus = 'pending';
  contracts: string[] = [];
  orders: string[] = [];
  orderParams: SqlParam[] | null = null;
  failOrder = false;
  rfq = {
    user_id: 'release-owner', user_email: 'buyer@example.com', org_id: 'org-2', quantity: 3, shape_name: 'Bracket',
    lineage_id: quote.lineageId, artifact_id: quote.artifactId, artifact_sha256: quote.artifactSha256,
    document_version_id: quote.documentVersionId,
  };
  lineageStatus = 'authorized';

  async queryOne<T>(sql: string): Promise<T | undefined> {
    if (sql.includes('FROM nf_rfqs')) return this.rfq as T;
    if (sql.includes('FROM nf_manufacturing_lineage')) {
      return {
        lineage_id: quote.lineageId, user_id: this.rfq.user_id, artifact_id: quote.artifactId,
        artifact_sha256: quote.artifactSha256, document_version_id: quote.documentVersionId,
        release_status: this.lineageStatus, authorized_at: 1, authorized_by: 'reviewer', invalidated_at: null,
      } as T;
    }
    if (sql.includes('SELECT status FROM nf_quotes')) return { status: this.quoteStatus } as T;
    if (sql.includes('FROM nf_contracts WHERE quote_id')) {
      return this.contracts[0] ? ({ id: this.contracts[0] } as T) : undefined;
    }
    if (sql.includes('FROM nf_orders WHERE quote_id')) {
      return this.orders[0] ? ({ id: this.orders[0] } as T) : undefined;
    }
    if (sql.includes('SELECT plan FROM nf_users')) return { plan: 'team' } as T;
    if (sql.includes('COUNT(*) as cnt FROM nf_contracts')) return { cnt: 0 } as T;
    return undefined;
  }

  async queryAll<T>(): Promise<T[]> { return []; }

  async execute(sql: string, ...params: SqlParam[]): Promise<{ changes: number }> {
    if (sql.includes("UPDATE nf_quotes SET status = 'accepted'")) {
      if (this.quoteStatus !== 'pending') return { changes: 0 };
      this.quoteStatus = 'accepted';
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO nf_contracts')) {
      this.contracts.push(String(params[0]));
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO nf_orders')) {
      if (this.failOrder) throw new Error('order insert failed');
      this.orders.push(String(params[0]));
      this.orderParams = params;
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  async executeRaw(): Promise<void> {}

  async transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T> {
    const before = {
      quoteStatus: this.quoteStatus,
      contracts: [...this.contracts],
      orders: [...this.orders],
      orderParams: this.orderParams ? [...this.orderParams] : null,
    };
    try {
      return await fn(this);
    } catch (error) {
      this.quoteStatus = before.quoteStatus;
      this.contracts = before.contracts;
      this.orders = before.orders;
      this.orderParams = before.orderParams;
      throw error;
    }
  }

  async close(): Promise<void> {}
}

describe('atomic quote acceptance', () => {
  it('commits accepted quote, contract, org order, and exact release lineage together', async () => {
    const db = new AcceptanceDb();
    const result = await acceptQuoteAtomically(db, quote, '2026-08-11T00:00:00.000Z');

    expect(result.idempotent).toBe(false);
    expect(db.quoteStatus).toBe('accepted');
    expect(db.contracts).toHaveLength(1);
    expect(db.orders).toHaveLength(1);
    expect(db.orderParams?.[4]).toBe('org-2');
    expect(db.orderParams?.slice(16, 20)).toEqual(['lineage-1', 'step-1', hash, 'rev-1']);
  });

  it('rolls the quote and contract back if production-order creation fails', async () => {
    const db = new AcceptanceDb();
    db.failOrder = true;

    await expect(acceptQuoteAtomically(db, quote)).rejects.toThrow('order insert failed');
    expect(db.quoteStatus).toBe('pending');
    expect(db.contracts).toEqual([]);
    expect(db.orders).toEqual([]);
  });

  it('rejects quote/RFQ artifact drift before changing state', async () => {
    const db = new AcceptanceDb();
    db.rfq.document_version_id = 'rev-2';

    await expect(acceptQuoteAtomically(db, quote)).rejects.toMatchObject({
      code: 'QUOTE_RFQ_LINEAGE_MISMATCH',
    });
    expect(db.quoteStatus).toBe('pending');
  });

  it('fails closed for revoked releases and legacy incomplete acceptances', async () => {
    const revoked = new AcceptanceDb();
    revoked.lineageStatus = 'revoked';
    await expect(acceptQuoteAtomically(revoked, quote)).rejects.toMatchObject({
      code: 'LINEAGE_NOT_AUTHORIZED',
    });

    const incomplete = new AcceptanceDb();
    incomplete.quoteStatus = 'accepted';
    await expect(acceptQuoteAtomically(incomplete, quote)).rejects.toMatchObject({
      code: 'INCOMPLETE_ACCEPTANCE',
    });
  });

  it('is idempotent only when both commercial records already exist', async () => {
    const db = new AcceptanceDb();
    db.quoteStatus = 'accepted';
    db.contracts = ['contract-1'];
    db.orders = ['order-1'];

    await expect(acceptQuoteAtomically(db, quote)).resolves.toEqual({
      contractId: 'contract-1', orderId: 'order-1', idempotent: true,
    });
  });
});
