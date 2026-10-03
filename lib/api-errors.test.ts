import { describe, it, expect, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { withGrants } from "./permissions/test-actors"

/**
 * Every refusal a service throws as a code gets an answer that says what it
 * is. Fifteen had none: asking for leave on a day already asked for, or on a
 * past day, came back as a 500 with an error reference, logged as a fault.
 */

const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !e.name.includes(".test.") ? [join(dir, e.name)] : [])

// Not refusals: a code the system itself should never produce. They stay a
// 500, logged with a reference, because something is wrong.
const FAULTS = new Set(["BUILT_IN_ROLE_MISSING"])

describe("codes a service throws", () => {
    it("are each answered by a route, a shared answer, or the refusals map", async () => {
        const { KNOWN_REFUSALS } = await import("./api-errors")
        const thrown = new Set<string>()
        for (const f of files("lib")) {
            for (const m of readFileSync(f, "utf8").matchAll(/throw new Error\(["']([A-Z][A-Z0-9_]{3,})["']\)/g)) thrown.add(m[1])
        }
        // Anything outside the services that names the code answers it: a
        // route, a shared answer such as lib/role-errors.ts, or the sign-in page.
        const answering = [...files("app"), ...files("components"), ...files("lib").filter(f => !f.startsWith("lib/services/") && f !== "lib/api-errors.ts")]
            .map(f => readFileSync(f, "utf8").replace(/throw new Error\(["'][A-Z0-9_]+["']\)/g, ""))
            .join("\n")
        const unanswered = [...thrown].filter(c => !FAULTS.has(c) && !Object.hasOwn(KNOWN_REFUSALS, c) && !answering.includes(c)).sort()
        expect(thrown.size).toBeGreaterThan(100)
        expect(unanswered).toEqual([])
    })
})

const state = { session: null as any }
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

describe("the handler", () => {
    it("answers a known refusal with its status and message, not a 500", async () => {
        const { withStandardHandler } = await import("@/lib/api-utils")
        state.session = { user: withGrants({ id: "u", role: "EMPLOYEE", companyId: "c1" }) }
        const route = withStandardHandler(async () => { throw new Error("OVERLAPPING_REQUEST") })
        const res = await route(new Request("https://nizmo.test/api/day-off-requests", { method: "POST" }))
        expect(res.status).toBe(409)
        expect((await res.json()).error).toBe("You already have a leave request for that day.")
    })

    it("and a code that means nothing is still not taken for one", async () => {
        const { knownRefusal } = await import("./api-errors")
        expect(knownRefusal(new Error("toString"))).toBeUndefined()
        expect(knownRefusal(new Error("SOMETHING_ELSE"))).toBeUndefined()
        expect(knownRefusal("DATE_IN_PAST")).toBeUndefined()
    })
})
