/**
 * Supabase access, server-side only.
 *
 * Reached with the service role key, which bypasses Row Level Security — the
 * schema enables RLS on every table and grants no policy, so this key is the
 * only way in. It must never be exposed to a browser, and nothing in app/ ships
 * it to the client: every caller of this module is a route handler.
 *
 * Unset in development, and then the whole app falls back to the in-memory
 * store, so `npm run dev` still works with no setup at all.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL?.trim() || null
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null

export function dbEnabled(): boolean {
  return url !== null && serviceKey !== null
}

type DbGlobals = { client?: SupabaseClient }
const globalForDb = globalThis as unknown as { __pitch402Db?: DbGlobals }
const cache = (globalForDb.__pitch402Db ??= {})

export function db(): SupabaseClient {
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set')
  }
  return (cache.client ??= createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }))
}

/**
 * Postgres unique-violation. This is how a spot that two buyers raced for
 * comes back, and it is the signal that one of them lost rather than an error
 * worth reporting as a fault.
 */
export const UNIQUE_VIOLATION = '23505'

export function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === UNIQUE_VIOLATION
}
