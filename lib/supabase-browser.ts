import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null
let liveToken: string | null = null

/**
 * The token the live-update channels are joined with (REALTIME_PLAN.md):
 * the app's own, from /api/realtime/token, set before the private channels
 * are joined and each time it's renewed. Null until there is one.
 */
export function setLiveToken(token: string | null) {
    liveToken = token
}

/**
 * Browser-only Supabase client, for Realtime broadcast subscriptions only —
 * never used for table reads/writes. The app talks to Postgres exclusively
 * through Prisma's own direct connection on the server; this client only
 * ever calls .channel(...): the public maintenance-mode channel, and the
 * private live-update channels (components/LiveUpdates.tsx).
 *
 * Uses the public key, which is meant to be shipped in a client bundle. Safe
 * even if extracted: RLS is enabled with zero permissive policies on every
 * table (see the enable_rls_default_deny migration), so this key alone can't
 * read or write a single row via Supabase's REST API.
 *
 * Its Realtime token is the app's own, through `accessToken`: Supabase asks
 * for it on connecting and on every heartbeat, every 25 seconds. Without
 * this, the client answers with the signed-in Supabase user's token, of
 * which there is none, or the public key, and the next heartbeat would undo
 * a token set by hand, closing the private channels. With none yet, Supabase
 * falls back to the public key, as before, for the public channel. Supabase's
 * own sign-in (`supabase.auth`) is off with it: the app never used it.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
    if (client) return client
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) return null
    client = createClient(url, key, { accessToken: async () => liveToken })
    return client
}
