/**
 * Shipping carrier tracking integration
 * Supported: CJ대한통운 (CJ), FedEx, DHL, EMS (Korea Post)
 * Graceful skip if API keys not configured
 */

export type Carrier = 'cj' | 'fedex' | 'dhl' | 'ems' | 'unknown';

export interface TrackingEvent {
  timestamp: string;   // ISO string
  location: string;
  status: string;
  description: string;
}

export interface TrackingResult {
  trackingNumber: string;
  carrier: Carrier;
  status: 'pending' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'unknown';
  estimatedDelivery?: string;
  events: TrackingEvent[];
  rawStatus?: string;
}

// ─── CJ대한통운 ────────────────────────────────────────────────────────────────
// API Docs: https://openapi.doortodoor.co.kr (requires business registration)
async function trackCJ(trackingNumber: string): Promise<TrackingResult> {
  const apiKey = process.env.CJ_LOGISTICS_API_KEY;
  if (!apiKey) return mockResult(trackingNumber, 'cj');

  try {
    const res = await fetch(
      `https://openapi.doortodoor.co.kr/doortodoor/tracking?apiKey=${apiKey}&invoice=${encodeURIComponent(trackingNumber)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return mockResult(trackingNumber, 'cj');
    const data = await res.json();

    const events: TrackingEvent[] = (data.trackingDetails ?? []).map((e: Record<string, unknown>) => ({
      timestamp: String(e.timeString ?? ''),
      location: String(e.scanLocation ?? ''),
      status: String(e.trackingStatus ?? ''),
      description: String(e.trackingStatusMsg ?? ''),
    }));

    const lastStatus = String(data.lastTrackingStatus ?? '').toLowerCase();
    const status = lastStatus.includes('배달완료') || lastStatus.includes('delivered')
      ? 'delivered'
      : lastStatus.includes('배달중') || lastStatus.includes('out')
        ? 'out_for_delivery'
        : lastStatus.includes('이동중') || lastStatus.includes('transit')
          ? 'in_transit'
          : 'unknown';

    return { trackingNumber, carrier: 'cj', status, events, rawStatus: data.lastTrackingStatus };
  } catch {
    return mockResult(trackingNumber, 'cj');
  }
}

// ─── FedEx ────────────────────────────────────────────────────────────────────
async function trackFedEx(trackingNumber: string): Promise<TrackingResult> {
  const clientId = process.env.FEDEX_CLIENT_ID;
  const clientSecret = process.env.FEDEX_CLIENT_SECRET;
  if (!clientId || !clientSecret) return mockResult(trackingNumber, 'fedex');

  try {
    // 1. Get OAuth token
    const tokenRes = await fetch('https://apis.fedex.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!tokenRes.ok) return mockResult(trackingNumber, 'fedex');
    const { access_token } = await tokenRes.json();

    // 2. Track
    const trackRes = await fetch('https://apis.fedex.com/track/v1/trackingnumbers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
      body: JSON.stringify({ trackingInfo: [{ trackingNumberInfo: { trackingNumber } }], includeDetailedScans: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!trackRes.ok) return mockResult(trackingNumber, 'fedex');
    const trackData = await trackRes.json();
    const pkg = trackData?.output?.completeTrackResults?.[0]?.trackResults?.[0];
    if (!pkg) return mockResult(trackingNumber, 'fedex');

    const events: TrackingEvent[] = (pkg.scanEvents ?? []).map((e: Record<string, unknown>) => ({
      timestamp: String(e.date ?? ''),
      location: `${(e.scanLocation as Record<string,unknown>)?.city ?? ''}, ${(e.scanLocation as Record<string,unknown>)?.countryCode ?? ''}`.trim().replace(/^,\s*/, ''),
      status: String(e.eventType ?? ''),
      description: String(e.eventDescription ?? ''),
    }));

    const latestStatus = String(pkg.latestStatusDetail?.code ?? '').toLowerCase();
    const status = latestStatus === 'dl' ? 'delivered'
      : latestStatus === 'od' ? 'out_for_delivery'
        : latestStatus.startsWith('it') ? 'in_transit'
          : 'unknown';

    return {
      trackingNumber, carrier: 'fedex', status, events,
      estimatedDelivery: pkg.estimatedDeliveryTimeWindow?.window?.ends,
      rawStatus: pkg.latestStatusDetail?.description,
    };
  } catch {
    return mockResult(trackingNumber, 'fedex');
  }
}

// ─── DHL ─────────────────────────────────────────────────────────────────────
async function trackDHL(trackingNumber: string): Promise<TrackingResult> {
  const apiKey = process.env.DHL_API_KEY;
  if (!apiKey) return mockResult(trackingNumber, 'dhl');

  try {
    const res = await fetch(
      `https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}`,
      { headers: { 'DHL-API-Key': apiKey }, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return mockResult(trackingNumber, 'dhl');
    const data = await res.json();
    const shipment = data?.shipments?.[0];
    if (!shipment) return mockResult(trackingNumber, 'dhl');

    const events: TrackingEvent[] = (shipment.events ?? []).map((e: Record<string, unknown>) => ({
      timestamp: String(e.timestamp ?? ''),
      location: String(((e.location as Record<string,unknown>)?.address as Record<string,unknown>)?.addressLocality ?? ''),
      status: String(e.status ?? ''),
      description: String(e.description ?? ''),
    }));

    const st = String(shipment.status?.status ?? '').toLowerCase();
    const status = st === 'delivered' ? 'delivered'
      : st === 'out-for-delivery' ? 'out_for_delivery'
        : st === 'in-transit' ? 'in_transit'
          : 'unknown';

    return {
      trackingNumber, carrier: 'dhl', status, events,
      estimatedDelivery: shipment.estimatedTimeOfDelivery,
      rawStatus: shipment.status?.description,
    };
  } catch {
    return mockResult(trackingNumber, 'dhl');
  }
}

// ─── EMS (Korea Post) ─────────────────────────────────────────────────────────
async function trackEMS(trackingNumber: string): Promise<TrackingResult> {
  // Korea Post Open API (no key required for basic tracking)
  try {
    const res = await fetch(
      `https://service.epost.go.kr/trace.RetrieveEmsRigiTraceList.comm?POST_CODE=${encodeURIComponent(trackingNumber)}&displayHeader=N`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return mockResult(trackingNumber, 'ems');
    // Korea Post returns HTML table — basic status only
    const html = await res.text();
    const delivered = html.includes('배달완료') || html.includes('Delivered');
    return {
      trackingNumber, carrier: 'ems',
      status: delivered ? 'delivered' : 'in_transit',
      events: [],
      rawStatus: delivered ? '배달완료' : '운송중',
    };
  } catch {
    return mockResult(trackingNumber, 'ems');
  }
}

// ─── Fallback mock (when no API key) ─────────────────────────────────────────
function mockResult(trackingNumber: string, carrier: Carrier): TrackingResult {
  return { trackingNumber, carrier, status: 'unknown', events: [], rawStatus: 'API key not configured' };
}

// ─── Auto-detect carrier from tracking number format ─────────────────────────
export function detectCarrier(trackingNumber: string): Carrier {
  const tn = trackingNumber.trim();
  if (/^\d{12}$/.test(tn)) return 'cj';                        // CJ대한통운: 12 digits
  if (/^\d{10,14}$/.test(tn) && tn.startsWith('6')) return 'ems'; // EMS
  if (/^[0-9]{12,14}$/.test(tn)) return 'fedex';               // FedEx: numeric
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(tn)) return 'ems';        // EMS international
  if (/^1Z/.test(tn)) return 'unknown';                         // UPS (not supported)
  if (/^\d{3}-?\d{8}$/.test(tn)) return 'dhl';                  // DHL
  return 'unknown';
}

// ─── Main entry point ─────────────────────────────────────────────────────────
export async function trackShipment(trackingNumber: string, carrier?: Carrier): Promise<TrackingResult> {
  const c = carrier ?? detectCarrier(trackingNumber);
  switch (c) {
    case 'cj':    return trackCJ(trackingNumber);
    case 'fedex': return trackFedEx(trackingNumber);
    case 'dhl':   return trackDHL(trackingNumber);
    case 'ems':   return trackEMS(trackingNumber);
    default:      return mockResult(trackingNumber, 'unknown');
  }
}
