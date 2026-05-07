import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';

export const dynamic = 'force-dynamic';

interface ContractRow {
  id: string; project_name: string; customer_email: string | null;
  contract_amount: number; commission_rate: number | null;
  final_charge: number | null; status: string; created_at: string;
}

// GET /api/contracts/[id]/tax-invoice
// Returns structured tax invoice data (Korean 세금계산서)
// Frontend should only call this when lang === 'kr'
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Optional: enforce Korean locale via Accept-Language or query param
  const lang = req.nextUrl.searchParams.get('lang');
  if (lang && lang !== 'kr' && lang !== 'ko') {
    return NextResponse.json({ error: '세금계산서는 한국어 서비스에서만 제공됩니다.' }, { status: 400 });
  }

  const { id: contractId } = await params;
  const db = getDbAdapter();

  const contract = await db.queryOne<ContractRow>(
    'SELECT id, project_name, customer_email, contract_amount, commission_rate, final_charge, status, created_at FROM nf_contracts WHERE id = ?',
    contractId,
  );

  if (!contract) return NextResponse.json({ error: '계약을 찾을 수 없습니다.' }, { status: 404 });
  if (!['completed', 'delivered'].includes(contract.status)) {
    return NextResponse.json({ error: '완료된 계약만 세금계산서를 발행할 수 있습니다.' }, { status: 400 });
  }

  const supplyAmount = contract.final_charge ?? contract.contract_amount;
  const vatAmount = Math.round(supplyAmount * 0.1); // 10% VAT
  const totalAmount = supplyAmount + vatAmount;

  const taxInvoice = {
    invoiceType: 'tax', // 세금계산서 (vs 계산서)
    issueDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    supplyDate: contract.created_at.slice(0, 10).replace(/-/g, ''),

    // 공급자 (Supplier = NexyFab)
    supplier: {
      registrationNumber: process.env.BUSINESS_REG_NUMBER ?? '000-00-00000',
      companyName: 'NexyFab',
      representativeName: process.env.REPRESENTATIVE_NAME ?? '대표자명',
      address: process.env.BUSINESS_ADDRESS ?? '서울특별시',
      businessType: '서비스업',
      businessItem: '제조업 플랫폼',
      email: 'tax@nexyfab.com',
    },

    // 공급받는자 (Buyer)
    buyer: {
      email: contract.customer_email ?? authUser.email,
      companyName: '', // buyer should fill this in
      registrationNumber: '', // buyer should fill this in
    },

    // 금액
    items: [
      {
        description: `${contract.project_name} 제조 서비스 수수료`,
        quantity: 1,
        unitPrice: supplyAmount,
        supplyAmount,
        vatAmount,
      },
    ],

    totals: {
      supplyAmount,
      vatAmount,
      totalAmount,
    },

    contractId,
    projectName: contract.project_name,
    currency: 'KRW',

    // Instructions for submission
    submissionNote: '실제 세금계산서 발행은 포트원(iamport) 또는 국세청 e-세금계산서 서비스를 통해 진행하세요.',
  };

  return NextResponse.json({ taxInvoice });
}
