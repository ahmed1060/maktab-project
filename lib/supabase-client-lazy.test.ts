import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "./strip-comments"

/**
 * The Supabase client stays out of the script every dashboard page runs first.
 *
 * It is only used in the browser for one Realtime channel (maintenance mode on
 * or off), which a Super Admin never opens, yet a static import put all of
 * supabase-js (Realtime, Auth, REST) into the shared dashboard script: on a
 * phone, a large part of the time each page was unresponsive while it
 * loaded (Lighthouse: total blocking time).
 */

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap(f => {
        const p = join(dir, f)
        return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) && !f.includes(".test.") ? [p] : []
    })
}

describe("the browser's Supabase client", () => {
    it("is imported only when the heartbeat opens its channel", () => {
        const heartbeat = stripComments(readFileSync("components/UserHeartbeat.tsx", "utf8"))
        expect(heartbeat).not.toMatch(/^import .*supabase-browser/m)
        expect(heartbeat).toContain('import("@/lib/supabase-browser")')
    })

    it("is not imported statically by anything the browser runs", () => {
        const client = [...sources("app"), ...sources("components"), ...sources("context"), ...sources("lib")]
            .filter(f => /^\s*['"]use client['"]/m.test(readFileSync(f, "utf8")))
        expect(client.length).toBeGreaterThan(20)
        const offenders = client.filter(f => /^import .*(supabase-browser|@supabase\/supabase-js)/m.test(readFileSync(f, "utf8")))
        expect(offenders).toEqual([])
    })

    it("asks for the maintenance state again once the channel is listening", () => {
        // A broadcast sent before it connected isn't replayed, and loading the
        // client lazily makes that window longer.
        const heartbeat = stripComments(readFileSync("components/UserHeartbeat.tsx", "utf8"))
        expect(heartbeat).toMatch(/\.subscribe\(state => \{ if \(state === 'SUBSCRIBED'\) checkStatusRef\.current\?\.\(\) \}\)/)
        expect(heartbeat).toContain("checkStatusRef.current = checkStatus")
    })
})
