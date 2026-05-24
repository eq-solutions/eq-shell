// Tenant routing — resolves a tenant slug (or tenant_id) to a Supabase client
// connected to that tenant's dedicated data-plane project.
//
// Used by canonical-api and any other Shell function that needs to read or
// write app_data for a specific tenant.
//
// Architecture: docs/ARCHITECTURE-V2.md "tenant_routing — the key new piece"
//                                       and "canonical-api design"
//
// Performance:
//   - shell_control.tenant_routing is read on first call per tenant per warm
//     function instance, then cached in-memory.
//   - Supabase client is also cached (creating one is cheap, but the cache
//     keeps connection pools warm).
//   - Cache TTL: 5 minutes (tenant routing rarely changes; routing flips like
//     status='active' → 'suspended' propagate within 5 min worst case).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from './supabase.js';
import { decryptSecret, hasMasterKey } from './encryption.js';

/** Cache entry for a resolved tenant routing. */
interface CachedRouting {
  tenant_id: string;
  tenant_slug: string;
  supabase_url: string;
  supabase_anon_key: string;
  service_role_key: string;        // decrypted
  region: string;
  status: TenantRoutingStatus;
  cached_at: number;                // epoch ms
}

export type TenantRoutingStatus = 'provisioning' | 'active' | 'suspended' | 'archived';

const CACHE_TTL_MS = 5 * 60 * 1000;

// Two indexes, same entries — lookups happen by either slug or id depending on
// the caller. Both point at the SAME object so an update via one path is
// visible via the other.
const cacheBySlug = new Map<string, CachedRouting>();
const cacheById = new Map<string, CachedRouting>();

// Supabase clients keyed by tenant_id. Each tenant gets one cached client per
// warm function instance. Typed with wide generics because we pin schema at
// construction (app_data) and supabase-js infers a different generic in that
// case — matches the pattern in _shared/supabase.ts.
const tenantClients = new Map<string, SupabaseClient<any, any, any>>();

export class TenantNotFoundError extends Error {
  public readonly identifier: string;
  constructor(identifier: string) {
    super(`No tenant routing found for "${identifier}"`);
    this.name = 'TenantNotFoundError';
    this.identifier = identifier;
  }
}

export class TenantNotActiveError extends Error {
  public readonly slug: string;
  public readonly status: TenantRoutingStatus;
  constructor(slug: string, status: TenantRoutingStatus) {
    super(`Tenant "${slug}" is not active (status: ${status})`);
    this.name = 'TenantNotActiveError';
    this.slug = slug;
    this.status = status;
  }
}

export class TenantRoutingMisconfiguredError extends Error {
  constructor(message: string) {
    super(`Tenant routing misconfigured: ${message}`);
    this.name = 'TenantRoutingMisconfiguredError';
  }
}

function isCacheFresh(entry: CachedRouting): boolean {
  return Date.now() - entry.cached_at < CACHE_TTL_MS;
}

function putInCache(entry: CachedRouting): void {
  cacheBySlug.set(entry.tenant_slug, entry);
  cacheById.set(entry.tenant_id, entry);
}

interface TenantRoutingRow {
  tenant_id: string;
  supabase_url: string;
  supabase_anon_key: string;
  service_role_key_ciphertext: string;
  service_role_key_iv: string;
  service_role_key_tag: string;
  region: string;
  status: TenantRoutingStatus;
  tenants: { slug: string } | null;
}

/**
 * Look up tenant routing by slug. Joins shell_control.tenants to resolve
 * slug → tenant_id, then reads tenant_routing for the connection info.
 *
 * Throws TenantNotFoundError if no row exists for this slug.
 * Throws TenantRoutingMisconfiguredError if decryption fails or env is bad.
 * Does NOT throw on inactive status — caller decides whether to allow that.
 */
async function fetchRoutingBySlug(slug: string): Promise<CachedRouting> {
  if (!hasMasterKey()) {
    throw new TenantRoutingMisconfiguredError(
      'TENANT_ROUTING_MASTER_KEY env var not set — cannot decrypt service-role keys',
    );
  }
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('tenant_routing')
    .select(`
      tenant_id,
      supabase_url,
      supabase_anon_key,
      service_role_key_ciphertext,
      service_role_key_iv,
      service_role_key_tag,
      region,
      status,
      tenants!inner ( slug )
    `)
    .eq('tenants.slug', slug)
    .maybeSingle<TenantRoutingRow>();

  if (error) {
    throw new TenantRoutingMisconfiguredError(
      `Database error reading tenant_routing for "${slug}": ${error.message}`,
    );
  }
  if (!data || !data.tenants) {
    throw new TenantNotFoundError(slug);
  }

  const service_role_key = decryptSecret({
    ciphertext: data.service_role_key_ciphertext,
    iv: data.service_role_key_iv,
    tag: data.service_role_key_tag,
  });

  const entry: CachedRouting = {
    tenant_id: data.tenant_id,
    tenant_slug: data.tenants.slug,
    supabase_url: data.supabase_url,
    supabase_anon_key: data.supabase_anon_key,
    service_role_key,
    region: data.region,
    status: data.status,
    cached_at: Date.now(),
  };
  putInCache(entry);
  return entry;
}

/**
 * Resolve a tenant slug to its routing info. Reads from cache first.
 *
 * @param slug tenant slug (e.g., 'sks', 'core')
 * @param requireActive when true (default), throws if tenant is not in 'active' status
 */
export async function getRoutingBySlug(
  slug: string,
  requireActive: boolean = true,
): Promise<CachedRouting> {
  const cached = cacheBySlug.get(slug);
  if (cached && isCacheFresh(cached)) {
    if (requireActive && cached.status !== 'active') {
      throw new TenantNotActiveError(slug, cached.status);
    }
    return cached;
  }
  const fresh = await fetchRoutingBySlug(slug);
  if (requireActive && fresh.status !== 'active') {
    throw new TenantNotActiveError(slug, fresh.status);
  }
  return fresh;
}

/**
 * Resolve a tenant by id (rare; most callers have a slug). Falls back to a
 * cache lookup; if missing, does a slug round-trip via the tenants table.
 */
export async function getRoutingById(
  tenant_id: string,
  requireActive: boolean = true,
): Promise<CachedRouting> {
  const cached = cacheById.get(tenant_id);
  if (cached && isCacheFresh(cached)) {
    if (requireActive && cached.status !== 'active') {
      throw new TenantNotActiveError(cached.tenant_slug, cached.status);
    }
    return cached;
  }
  // Not in cache — look up the slug, then fetch by slug (re-uses the join path)
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('tenants')
    .select('slug')
    .eq('id', tenant_id)
    .maybeSingle<{ slug: string }>();
  if (error) {
    throw new TenantRoutingMisconfiguredError(
      `Database error reading tenants for id ${tenant_id}: ${error.message}`,
    );
  }
  if (!data) {
    throw new TenantNotFoundError(tenant_id);
  }
  return getRoutingBySlug(data.slug, requireActive);
}

/**
 * Get (or create + cache) a Supabase client connected to a tenant's data plane.
 * The client uses the service-role key, so RLS is bypassed inside it — callers
 * are responsible for tenant-correctness of their queries.
 *
 * (Defence in depth still applies: even if a misrouted request reaches the
 * wrong tenant's DB, RLS policies inside that DB filter by tenant_id from the
 * JWT. But functions using this client should not rely on that — they should
 * always have routed correctly to begin with.)
 */
export async function getTenantDataClient(
  slug: string,
  requireActive: boolean = true,
): Promise<SupabaseClient<any, any, any>> {
  const routing = await getRoutingBySlug(slug, requireActive);
  const existing = tenantClients.get(routing.tenant_id);
  if (existing) {
    return existing;
  }
  const client = createClient(routing.supabase_url, routing.service_role_key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'app_data' },        // tenant DBs only hold app_data
  });
  tenantClients.set(routing.tenant_id, client);
  return client;
}

/**
 * Same as getTenantDataClient, but takes the canonical tenant UUID instead
 * of the slug. Most session-driven callers (Cards bridge, future shell
 * functions) have session.tenant_id but not the slug, so this saves them
 * an explicit slug lookup. Both lookups are cache-served after the first
 * call per warm function instance, so the cost is ~0.
 */
export async function getTenantDataClientById(
  tenant_id: string,
  requireActive: boolean = true,
): Promise<SupabaseClient<any, any, any>> {
  const routing = await getRoutingById(tenant_id, requireActive);
  return getTenantDataClient(routing.tenant_slug, requireActive);
}

/**
 * Invalidate cached routing for a tenant. Use after a tenant_routing UPDATE
 * (status change, key rotation, etc.) if you need the change to take effect
 * before the natural cache TTL expires.
 */
export function invalidateRoutingCache(slugOrId: string): void {
  const bySlug = cacheBySlug.get(slugOrId);
  const byId = cacheById.get(slugOrId);
  if (bySlug) {
    cacheBySlug.delete(bySlug.tenant_slug);
    cacheById.delete(bySlug.tenant_id);
    tenantClients.delete(bySlug.tenant_id);
  }
  if (byId && byId !== bySlug) {
    cacheBySlug.delete(byId.tenant_slug);
    cacheById.delete(byId.tenant_id);
    tenantClients.delete(byId.tenant_id);
  }
}

/**
 * Flush the entire routing cache. Use sparingly — exposed for test setup
 * and the master-key rotation script.
 */
export function flushRoutingCache(): void {
  cacheBySlug.clear();
  cacheById.clear();
  tenantClients.clear();
}
