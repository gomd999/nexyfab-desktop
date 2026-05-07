/**
 * Shared NexyFab order types. Used by the orders API routes, the orders
 * dashboard, and the manufacturer dashboard to keep field names in lock-step
 * with the `nf_orders` table.
 */

export type NexyfabOrderStatus =
  | 'placed'
  | 'production'
  | 'qc'
  | 'shipped'
  | 'delivered';

export interface NexyfabOrderStep {
  label: string;
  labelKo: string;
  completedAt?: number;
  estimatedAt?: number;
}

export interface NexyfabOrderTracking {
  number: string;
  carrier: string;
  lastEvent: string | null;
  updatedAt: number | null;
}

export interface NexyfabOrder {
  id: string;
  rfqId?: string;
  userId: string;
  manufacturerId?: string;
  partName: string;
  manufacturerName: string;
  quantity: number;
  /**
   * Legacy KRW-only field. Equal to `totalPrice` when `currency === 'KRW'`,
   * otherwise the FX-converted KRW snapshot at order creation. Prefer
   * `totalPrice` + `currency` for any new code.
   */
  totalPriceKRW: number;
  totalPrice: number;
  currency: string;
  buyerCountry?: string | null;
  /** Customs tariff classification (canonical: digits only). */
  hsCode?: string | null;
  /** Incoterms 2020 — see src/lib/shipping.ts for the supported subset. */
  incoterm?: 'EXW' | 'DAP' | 'DDP' | null;
  shipFromCountry?: string | null;
  shipToCountry?: string | null;
  status: NexyfabOrderStatus;
  steps: NexyfabOrderStep[];
  createdAt: number;
  estimatedDeliveryAt: number;
  /** DB/API 응답에 포함될 수 있음 (`nf_orders.contract_id`) */
  contractId?: string | null;
  paymentStatus?: string | null;
  /** 일부 JSON 응답은 snake_case (`payment_status`) */
  payment_status?: string | null;
  refund_requested_at?: string | number | null;
  partnerEmail?: string | null;
  hasReview?: boolean;
  hasDefect?: boolean;
  /** Carrier-pushed tracking info (set by /api/nexyfab/orders/[id]/shipping-webhook). */
  tracking?: NexyfabOrderTracking | null;
}
