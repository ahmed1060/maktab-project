import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

/**
 * Browser-only Supabase client, for Realtime broadcast subscriptions only —
 * never used for table reads/writes. The app talks to Postgres exclusively
 * through Prisma's own direct connection on the server; this client only
 * ever calls .channel(...) for public, non-sensitive broadcasts (e.g.
 * maintenance mode on/off).
 *
 * Uses the public "publishable" key, which is meant to be shipped in a
 * client bundle. Safe even if extracted: RLS is enabled with zero
 * permissive policies on every table (see the enable_rls_default_deny
 * migration), so this key alone can't read or write a single row via
 * Supabase's REST API — it can only see what's explicitly broadcast on a
 * channel it's told to subscribe to.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
    if (client) return client
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) return null
    client = createClient(url, key)
    return client
}
