import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * The properties of the register that live in the service and the route rather
 * than in the pure calculation — and each of which is a way to lose money
 * quietly rather than loudly.
 */
const SERVICE = stripComments(readFileSync("lib/services/payroll-run.service.ts", "utf8"))
const ROUTE = stripComments(readFileSync("app/api/payroll/[year]/[month]/route.ts", "utf8"))

describe("a draft is recomputed; anything past it never is", () => {
    it("refuses to rebuild a run that is no longer a draft", () => {
        // The one thing standing between "correct a typo" and "silently restate
        // a month that has already been paid".
        expect(SERVICE).toContain('existing.status !== "DRAFT"')
        expect(SERVICE).toContain("RUN_NOT_DRAFT")
        expect(ROUTE).toContain("already been approved and cannot be rebuilt")
    })

    it("replaces a draft wholesale rather than reconciling it", () => {
        // A partial update is how a payslip keeps a line whose adjustment was
        // rolled back an hour ago.
        const save = SERVICE.slice(SERVICE.indexOf("static async saveDraft"))
        expect(save).toContain("tx.payslip.deleteMany")
    })
})

describe("opening the register writes nothing", () => {
    it("computes without touching the database", () => {
        // Otherwise viewing a month creates a run, and two people opening the
        // screen is a race over which draft exists.
        const compute = SERVICE.slice(SERVICE.indexOf("static async compute"), SERVICE.indexOf("private static async previousNets"))
        expect(compute).not.toMatch(/\.(create|upsert|update|delete)(Many)?\(/)
    })

    it("and the GET route only reads", () => {
        const get = ROUTE.slice(ROUTE.indexOf("export const GET"), ROUTE.indexOf("export const POST"))
        expect(get).toContain("PayrollRunService.view")
        expect(get).not.toContain("saveDraft")
    })
})

describe("who the register is allowed to be about", () => {
    it("lets a Super Admin name a company and an Admin only see their own", () => {
        // Reading the parameter for both would let an Admin type somebody
        // else's id and be shown their payroll.
        expect(ROUTE).toContain("session.user.role === 'SUPER_ADMIN'")
        expect(ROUTE).toContain("session.user.companyId")
    })

    it("includes people who have left", () => {
        // Somebody who left on the 10th is owed ten days. A register listing
        // only current staff would not pay them, and the failure would arrive
        // as an absence rather than as a wrong number.
        // Bounded at the next method. An unbounded slice ran into the
        // adjustments query further down and matched its status filter — a
        // guard that fails for a reason it does not name is only marginally
        // better than one that passes for a reason it does not name.
        const start = SERVICE.indexOf("private static async peopleFor")
        const people = SERVICE.slice(start, SERVICE.indexOf("static async compute", start))
        expect(people).toContain('status: { not: "DELETED" }')
        expect(people, "the query filters to currently-active staff").not.toMatch(/status:\s*"ACTIVE"/)
    })

    it("names somebody it cannot compute instead of dropping or crashing on them", () => {
        // One person with no salary history must not stop the other fifty being
        // paid, and must not vanish either.
        expect(SERVICE).toContain("refused.push")
        expect(SERVICE).toContain("refused,")
    })
})

describe("variance has three answers, not two", () => {
    it("distinguishes nothing changed from nothing to compare against", () => {
        // The first is reassuring; the second is not, and showing zeros for it
        // would be a lie of exactly the reassuring kind.
        expect(SERVICE).toContain("previous ? variance(")
        expect(SERVICE).toContain(": null")
    })
})
