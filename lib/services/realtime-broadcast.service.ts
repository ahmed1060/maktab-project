/**
 * Server-side Realtime broadcasts, over Supabase's REST endpoint using the
 * service_role key (already used elsewhere for Storage — see
 * lib/storage.ts) rather than the supabase-js client, since this only ever
 * needs to fire a one-off message, not hold a connection open.
 *
 * Broadcasting from here needs no RLS policy on realtime.messages at all —
 * that table only gates client-originated subscribes/sends, not this
 * server-to-Supabase REST call.
 */
export class RealtimeBroadcastService {
    private static async send(topic: string, event: string, payload: Record<string, unknown>) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!url || !key) return // best-effort — the polling fallback still covers it

        try {
            await fetch(`${url}/realtime/v1/api/broadcast`, {
                method: 'POST',
                headers: { apikey: key, 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [{ topic, event, payload }] }),
            })
        } catch (error) {
            console.error(`[RealtimeBroadcastService] Failed to broadcast on ${topic}`, error)
        }
    }

    /**
     * Public channel — maintenance on/off isn't sensitive, so every
     * connected browser can safely subscribe without any per-user
     * authorization. See components/UserHeartbeat.tsx for the listener.
     */
    static async broadcastMaintenanceStatus(active: boolean, message?: string | null) {
        await this.send('maintenance-status', 'update', { active, message: message ?? null })
    }
}
