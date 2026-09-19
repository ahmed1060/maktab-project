import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * Creating an employee has to open their employment and their salary history,
 * not just write the row.
 *
 * Payroll reads neither `User.salary` nor the user row's existence. A person's
 * employed span opens only on a HIRED or REINSTATED event, and the rate for a
 * month comes from SalaryChange — `User.salary` is a cache of the latest one.
 * So a create that writes only the row produces somebody the register skips on
 * `timeline.employed.length === 0`, forever, with no refusal to explain it.
 *
 * That is what shipped, and acceptance testing found it on the documented
 * onboarding path: Employees, Add Employee, set a salary. The only way through
 * was to archive the person and reinstate them, because ARCHIVED to ACTIVE is
 * the one transition `eventForStatusChange` maps to REINSTATED — which is to
 * say, fire somebody in order to hire them.
 *
 * Asserted on the source because the repo's suite has no database. The
 * behaviour itself was verified against a real Postgres: with these two writes
 * the register returns the new hire, and with them disabled it returns zero
 * entries and zero refusals.
 */

const SOURCE = stripComments(readFileSync("lib/services/user.service.ts", "utf8"))

/** Just the body of UserService.create. */
function createBody(): string {
    const start = SOURCE.indexOf("static async create(")
    expect(start, "UserService.create is missing").toBeGreaterThan(-1)
    const next = SOURCE.indexOf("static async ", start + 10)
    return SOURCE.slice(start, next === -1 ? undefined : next)
}

describe("a new employee can be paid", () => {
    const body = createBody()

    it("opens the employment span with a HIRED event", () => {
        expect(body).toMatch(/EmploymentService\.record/)
        expect(body, "the event must be HIRED — no status change ever produces it")
            .toMatch(/type:\s*['"]HIRED['"]/)
    })

    it("opens the salary history", () => {
        // User.salary alone resolves to "No salary in effect" for every month.
        expect(body).toMatch(/SalaryHistoryService\.record/)
    })

    it("writes all three together or not at all", () => {
        // A user row without the other two is the broken state this fixes; a
        // half-written create would recreate it for whoever hit the failure.
        expect(body).toMatch(/prisma\.\$transaction/)
        const tx = body.indexOf("prisma.$transaction")
        expect(body.indexOf("EmploymentService.record")).toBeGreaterThan(tx)
        expect(body.indexOf("SalaryHistoryService.record")).toBeGreaterThan(tx)
    })

    it("does not do it for a Super Admin, who has no company and no salary", () => {
        expect(body).toMatch(/SUPER_ADMIN/)
    })
})
