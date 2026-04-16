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

export interface NexyfabOrder {
  id: string;
  rfqId?: string;
  userId: string;
  manufacturerId?: string;
  partName: string;
  manufacturerName: string;
  quantity: number;
  totalPriceKRW: number;
  status: NexyfabOrderStatus;
  steps: NexyfabOrderStep[];
  createdAt: number;
  estimatedDeliveryAt: number;
}
