import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * Where the server's functions run (TECH_STACK.md, PR 261). The database,
 * its storage and live updates are Supabase's, in Ireland (eu-west-1), and a
 * page makes its queries one after another, so each one crosses whatever lies
 * between the function and the database. In Frankfurt (fra1), where they ran
 * until then, that was Germany to Ireland and back, per query.
 *
 * Set in vercel.json, which overrides the project's Function Region setting,
 * so it's reviewed with the code and can't drift in the dashboard unseen.
 */

const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { regions?: string[] }

describe("the server's functions run next to the database", () => {
    it("in Dublin, beside Supabase's eu-west-1", () => {
        expect(vercel.regions).toEqual(["dub1"])
    })

    it("and no route or page sends itself elsewhere", () => {
        // A route's own preferredRegion, or the edge runtime, would run it away
        // from the database again, each of its queries paying the distance back.
        const files = (readdirSync("app", { recursive: true }) as string[])
            .filter(f => /(^|\/)(route|page|layout)\.tsx?$/.test(f))
        expect(files.length, "no routes or pages found").toBeGreaterThan(50)
        const elsewhere = files.filter(f =>
            /export\s+const\s+(preferredRegion|runtime)\b/.test(stripComments(readFileSync(`app/${f}`, "utf8"))))
        expect(elsewhere).toEqual([])
    })
})
