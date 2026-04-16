/**
 * nexyflowQuoteAPI.ts
 *
 * Thin client for the NexyFlow groupware quote-approval endpoints.
 * NexyFlow URL is read from NEXT_PUBLIC_NEXYFLOW_API_URL (env).
 * Auth token is forwarded from the current auth-server session cookie.
 */

import type { CostEstimate, GeometryMetrics, CostCurrency } from './CostEstimator';

export interface QuotePayload {
  partName: string;
  materialId: string;
  quantity: number;
  currency: CostCurrency;
  estimates: CostEstimate[];
  metrics: GeometryMetrics;
  notes?: string;
}

export interface NexyFlowQuote {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  partName: string;
  materialId: string;
  quantity: number;
  currency: string;
  estimates: CostEstimate[];
  metrics: GeometryMetrics;
  notes: string;
  approvalComment: string;
  approvedBy?: string;
}

function getBaseURL(): string {
  return (
    process.env.NEXT_PUBLIC_NEXYFLOW_API_URL ||
    (typeof window !== 'undefined' && (window as any).__NEXYFLOW_API_URL) ||
    'https://nexyflow-api.railway.app'
  );
}

async function authHeaders(): Promise<HeadersInit> {
  // The auth-server sets an HttpOnly cookie — the browser forwards it automatically.
  // For SSR / server actions, you'd pass the bearer token here explicitly.
  return { 'Content-Type': 'application/json' };
}

/** Submit a quote to NexyFlow for manager approval. Returns the created quote. */
export async function submitQuoteToNexyFlow(payload: QuotePayload): Promise<NexyFlowQuote> {
  const base = getBaseURL();
  const headers = await authHeaders();
  const res = await fetch(`${base}/api/quotes`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`NexyFlow quote submit failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.quote as NexyFlowQuote;
}

/** Fetch the current user's quotes list. */
export async function fetchMyQuotes(): Promise<NexyFlowQuote[]> {
  const base = getBaseURL();
  const headers = await authHeaders();
  const res = await fetch(`${base}/api/quotes`, {
    headers,
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`NexyFlow quotes fetch failed (${res.status})`);
  return res.json();
}

/** Update quote status (approve / reject) with optional comment. */
export async function updateQuoteStatus(
  id: string,
  status: 'approved' | 'rejected',
  comment?: string,
): Promise<NexyFlowQuote> {
  const base = getBaseURL();
  const headers = await authHeaders();
  const res = await fetch(`${base}/api/quotes/${id}/status`, {
    method: 'PUT',
    headers,
    credentials: 'include',
    body: JSON.stringify({ status, comment }),
  });
  if (!res.ok) throw new Error(`NexyFlow status update failed (${res.status})`);
  const data = await res.json();
  return data.quote as NexyFlowQuote;
}
