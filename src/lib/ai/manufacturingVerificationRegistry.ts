const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 500;

interface VerifiedHandleEntry {
  expiresAtMs: number;
}

const GLOBAL_KEY = '__nexyfabVerifiedManufacturingHandles';

function registry(): Map<string, VerifiedHandleEntry> {
  const root = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: Map<string, VerifiedHandleEntry>;
  };
  root[GLOBAL_KEY] ??= new Map<string, VerifiedHandleEntry>();
  return root[GLOBAL_KEY];
}

function gc(now = Date.now()): void {
  const entries = registry();
  for (const [handle, entry] of entries) {
    if (entry.expiresAtMs <= now) entries.delete(handle);
  }
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export function registerVerifiedManufacturingHandle(handle: string, now = Date.now()): void {
  if (!handle) return;
  gc(now);
  registry().set(handle, { expiresAtMs: now + TTL_MS });
}

export function revokeVerifiedManufacturingHandle(handle: string): void {
  registry().delete(handle);
}

export function isVerifiedManufacturingHandle(handle: string, now = Date.now()): boolean {
  gc(now);
  return Boolean(handle && registry().get(handle)?.expiresAtMs && registry().get(handle)!.expiresAtMs > now);
}

export function clearManufacturingVerificationRegistryForTests(): void {
  registry().clear();
}
