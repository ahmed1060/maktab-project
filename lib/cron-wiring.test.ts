import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { MAX_ORPHAN_SHARE, decideCleanup } from "./orphan-guard"

const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: { path: string; schedule: string }[]
}

// Comments stripped before searching. These routes explain in prose why they
// carry the jobs they do, so a plain substring check passes on the explanation
// alone — which it did, and which made these guards useless until the call one
// of them was meant to pin was actually removed to test it.
const stripComments = (source: string) =>
    source
        .split("\n")
        .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n")

describe("every scheduled path is a route that exists", () => {
    it.each(vercel.crons.map(c => [c.path, c.schedule]))("%s (%s)", (path) => {
        // A cron pointed at a path with no route is a 404 every morning, which
        // nothing in a build or a typecheck would notice.
        expect(existsSync(`app${path}/route.ts`), `no route file for ${path}`).toBe(true)
    })

    it("dispatches with GET, which is all Vercel Cron sends", () => {
        for (const { path } of vercel.crons) {
            const source = readFileSync(`app${path}/route.ts`, "utf8")
            expect(source, `${path} exports no GET handler`).toMatch(/export (async function|const) GET/)
        }
    })
})

describe("the jobs that had no trigger at all", () => {
    // Both of these lived only inside CronService.dailyCheck(), which nothing
    // ever called. Every other job in that function had grown its own route
    // over time; these two never did, so neither had ever run in production —
    // the subscription lifecycle would not have fired on the day it was first
    // due, and a DAILY obligation had never recurred.
    const scheduled = vercel.crons
        .map(c => stripComments(readFileSync(`app${c.path}/route.ts`, "utf8")))
        .join("\n")

    it("runs the subscription lifecycle on a schedule", () => {
        expect(scheduled).toContain("checkSubscriptionLifecycle(")
    })

    it("runs recurring obligations on a schedule", () => {
        expect(scheduled).toContain("processRecurrentObligations(")
    })

    it("keeps the dead aggregate deleted", () => {
        // Reviving it would re-run five jobs that already have correct
        // schedules, and would put the orphan sweep back on a timer. The
        // tombstone comment explaining that is allowed to name it; code is not.
        const code = readFileSync("lib/services/cron.service.ts", "utf8")
            .split("\n")
            .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
            .join("\n")
        expect(code).not.toContain("dailyCheck")
    })
})

describe("the orphan sweep is not on a schedule", () => {
    it("is reachable only by hand", () => {
        // Its reference set is incomplete — see decideCleanup — so it must stay
        // something a person triggers and reads the result of, not something
        // that runs at 3am against a bucket nobody is watching.
        for (const { path } of vercel.crons) {
            const code = stripComments(readFileSync(`app${path}/route.ts`, "utf8"))
            expect(code, `${path} reaches the orphan sweep`).not.toContain("cleanupOrphanedAssets")
        }
        expect(readFileSync("app/api/admin/maintenance/route.ts", "utf8")).toContain("cleanupOrphanedAssets(")
    })
})

describe("refusing an implausible sweep", () => {
    it("proceeds on the handful a real orphan sweep finds", () => {
        expect(decideCleanup(3, 106)).toEqual({ proceed: true, deleting: 3 })
    })

    it("refuses when most of the bucket looks orphaned", () => {
        // The live numbers at the time this was written: the reference set
        // covers User.avatar, Task.attachments and Company.logoUrl, while the
        // bucket also holds note attachments, obligation attachments and the
        // Excel templates. 101 of 106.
        const decision = decideCleanup(101, 106)
        expect(decision.proceed).toBe(false)
        expect(decision.proceed === false && decision.reason).toBe("implausible")
    })

    it("does nothing when there is nothing to do", () => {
        expect(decideCleanup(0, 106)).toEqual({ proceed: false, reason: "nothing_to_do" })
    })

    it("refuses rather than dividing by zero on an empty bucket", () => {
        expect(decideCleanup(5, 0)).toEqual({ proceed: false, reason: "implausible", share: 1 })
    })

    it("puts the boundary where the constant says", () => {
        expect(decideCleanup(20, 100).proceed).toBe(true)
        expect(decideCleanup(21, 100).proceed).toBe(false)
        expect(MAX_ORPHAN_SHARE).toBe(0.2)
    })
})
