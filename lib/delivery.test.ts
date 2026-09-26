import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { resolvePayrollScope, managesCompany } from "./payroll-scope"
import { issueProgress, nextIssueBatch, ISSUE_BATCH_SIZE } from "./register"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * Paying and delivering — the last phase, and the only one where every failure
 * is visible to somebody outside the company.
 *
 * A payslip sent twice, a payslip never sent, a month marked paid that was not:
 * none of these are internal inconsistencies. Each is a conversation with an
 * employee, and the money one is a conversation with their bank.
 */

const DELIVERY = stripComments(readFileSync("lib/services/payroll-delivery.service.ts", "utf8"))
const ISSUE_ROUTE = stripComments(readFileSync("app/api/payroll/[year]/[month]/issue/route.ts", "utf8"))
const PAID_ROUTE = stripComments(readFileSync("app/api/payroll/[year]/[month]/paid/route.ts", "utf8"))
const EXPORT_ROUTE = stripComments(readFileSync("app/api/payroll/[year]/[month]/export/route.ts", "utf8"))
const PAGE = readFileSync("app/(dashboard)/dashboard/payroll/page.tsx", "utf8")

/**
 * The two helpers take the caller and the permission a route needs now
 * (ROLES_PLAN.md, Part A). These adapters keep every assertion below exactly
 * as it was, asked in the old shape, so a changed answer is a changed rule and
 * not a rewritten test. The route-level record of the same rules is
 * lib/permissions/payroll-access.characterization.test.ts.
 */
const scopeFor = (role: string | null | undefined, companyId: string | null, requested: string | null, year: unknown, month: unknown) =>
    resolvePayrollScope({ id: "u", role, companyId }, "payroll.view", requested, year, month)
const manages = (role: string | null | undefined, companyId: string | null, target: string) =>
    managesCompany({ id: "u", role, companyId }, "payroll.view", target)

describe("who may act on a month", () => {
    const ADMIN = ["ADMIN", "c1"] as const
    const SUPER = ["SUPER_ADMIN", "c1"] as const

    it("ignores a company an Admin names and uses their own", () => {
        // The whole multi-tenant leak in one line: read the parameter for both
        // roles and an Admin can type an id they are not in.
        const scope = scopeFor(...ADMIN, "c2", 2026, 9)
        expect(scope.ok && scope.companyId).toBe("c1")
    })

    it("honours a company a Super Admin names", () => {
        const scope = scopeFor(...SUPER, "c2", 2026, 9)
        expect(scope.ok && scope.companyId).toBe("c2")
    })

    it("falls back to a Super Admin's own company when they name none", () => {
        expect(scopeFor(...SUPER, null, 2026, 9)).toMatchObject({ companyId: "c1" })
    })

    it("refuses anybody who is not a manager, before looking at anything else", () => {
        // Checked first on purpose: an employee sending a malformed month
        // should be told they may not, not that their month is wrong.
        for (const role of ["EMPLOYEE", "TEAM_LEADER", "", null, undefined]) {
            expect(scopeFor(role, "c1", null, 2026, 9)).toMatchObject({ reason: "NOT_A_MANAGER" })
        }
        expect(scopeFor("EMPLOYEE", "c1", null, 1066, 77)).toMatchObject({ reason: "NOT_A_MANAGER" })
    })

    it("refuses a Super Admin attached to no company and naming none", () => {
        expect(scopeFor("SUPER_ADMIN", null, null, 2026, 9)).toMatchObject({ reason: "NO_COMPANY" })
    })

    it("refuses a month that is not a month", () => {
        for (const m of [0, 13, -1, 1.5, "september", NaN, null]) {
            expect(scopeFor(...ADMIN, null, 2026, m), String(m)).toMatchObject({ reason: "BAD_MONTH" })
        }
        for (const y of [1999, 2101, "twenty", NaN]) {
            expect(scopeFor(...ADMIN, null, y, 9), String(y)).toMatchObject({ reason: "BAD_YEAR" })
        }
    })

    it("accepts the string params a route actually hands it", () => {
        // Next gives these as strings off the URL. A resolver that only
        // accepted numbers would refuse every real request.
        expect(scopeFor(...ADMIN, null, "2026", "09")).toMatchObject({ year: 2026, month: 9 })
    })
})

describe("who may act on one document", () => {
    it("lets a manager at that company through and one at another company not", () => {
        expect(manages("ADMIN", "c1", "c1")).toBe(true)
        expect(manages("ADMIN", "c1", "c2")).toBe(false)
    })

    it("lets a Super Admin through wherever they happen to be attached", () => {
        // The arm that has to short-circuit: compared straight, a Super Admin
        // with a null companyId would be refused everywhere, and one attached
        // to a company would be admitted to exactly that one.
        expect(manages("SUPER_ADMIN", null, "c9")).toBe(true)
        expect(manages("SUPER_ADMIN", "c1", "c9")).toBe(true)
    })

    it("does not admit an employee to their own company's records", () => {
        expect(manages("EMPLOYEE", "c1", "c1")).toBe(false)
        expect(manages(null, "c1", "c1")).toBe(false)
    })
})

describe("how far issuing has got", () => {
    const sent = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, emailedAt: new Date() }))
    const unsent = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `u${i}`, emailedAt: null }))

    it("never counts an excluded payslip as something to send", () => {
        // Excluded rows are on the register to be seen, not to be issued, and
        // counting them would leave a run stuck at 48 of 50 forever.
        const progress = issueProgress([...sent(2), ...unsent(1), { id: "x", emailedAt: null, excluded: true }])
        expect(progress).toEqual({ sent: 2, sendable: 3, unsent: 1 })
    })

    it("agrees with the batch it hands out", () => {
        const payslips = [...sent(3), ...unsent(40)]
        const progress = issueProgress(payslips)
        const batch = nextIssueBatch(payslips)
        expect(progress.sendable).toBe(batch.total)
        expect(progress.unsent).toBe(batch.batch.length + batch.remaining)
    })

    it("reports nothing left once every sendable one is stamped", () => {
        expect(issueProgress([...sent(4), { id: "x", emailedAt: null, excluded: true }]).unsent).toBe(0)
    })
})

describe("nothing leaves a draft", () => {
    it("the service refuses before it reads a single address", () => {
        // A provisional figure in somebody's inbox cannot be recalled, and "we
        // will send a corrected one" costs more trust than the mistake did.
        const issue = DELIVERY.slice(DELIVERY.indexOf("static async issueBatch"), DELIVERY.indexOf("static async resendSettlement"))
        expect(issue).toContain('RUN_IS_DRAFT')
        expect(issue.indexOf('RUN_IS_DRAFT')).toBeLessThan(issue.indexOf("sendPlainEmail"))
    })

    it("and the route says which door to go through instead", () => {
        expect(ISSUE_ROUTE).toContain("RUN_IS_DRAFT")
        expect(ISSUE_ROUTE).toContain("Approve this month before sending payslips")
    })

    it("marking paid requires an approved run, not merely a run", () => {
        const paid = DELIVERY.slice(DELIVERY.indexOf("static async markPaid"), DELIVERY.indexOf("private static payslipBody"))
        expect(paid).toContain('run.status !== "APPROVED"')
        expect(paid).toContain('NOT_APPROVED')
        // And says so rather than pretending it worked.
        expect(paid).toContain('ALREADY_PAID')
    })
})

describe("a payslip is sent once", () => {
    const issue = DELIVERY.slice(DELIVERY.indexOf("static async issueBatch"), DELIVERY.indexOf("static async resendSettlement"))

    it("stamps emailedAt inside the loop, not after it", () => {
        // Stamping after the batch is exactly how a timeout turns into sixty
        // people receiving their payslip a second time.
        const loop = issue.slice(issue.indexOf("for (const payslip of batch)"))
        expect(loop).toContain("payslip.update")
        expect(loop).toContain("emailedAt: new Date()")
        // Nothing stamps anything after the loop closes.
        const afterLoop = issue.slice(issue.indexOf("return { sent,"))
        expect(afterLoop).not.toContain("emailedAt")
    })

    it("only stamps a send that actually went", () => {
        expect(issue).toContain('outcome === "SENT"')
        // The skipped arm reports and does not stamp: a reserved address will
        // never be deliverable, and calling it emailed is a lie in the column
        // the register reads to decide what is left.
        const skipped = issue.slice(issue.indexOf("} else {"), issue.indexOf("} catch"))
        expect(skipped).toContain("skipped.push")
        expect(skipped).not.toContain("emailedAt")
    })

    it("sends them one at a time", () => {
        // In parallel is how one Gmail account gets rate-limited, which does
        // not merely annoy somebody — it stops password resets and sign-in
        // codes for everybody.
        expect(issue).not.toMatch(/Promise\.all|Promise\.allSettled/)
        expect(issue).toContain("for (const payslip of batch)")
    })

    it("one bad address does not stop the other twenty-four", () => {
        expect(issue).toContain("failed.push")
        // Inside the loop's own try, not around the loop.
        expect(issue.indexOf("} catch")).toBeGreaterThan(issue.indexOf("for (const payslip of batch)"))
    })

    it("resumes rather than restarts", () => {
        expect(issue).toContain("nextIssueBatch")
        expect(ISSUE_BATCH_SIZE).toBeLessThanOrEqual(50)
    })
})

describe("the money moving is one act", () => {
    const paid = DELIVERY.slice(DELIVERY.indexOf("static async markPaid"), DELIVERY.indexOf("private static payslipBody"))

    it("moves the settlements it carried in the same transaction", () => {
        // A settlement left APPROVED after its run is PAID is a person who has
        // been paid according to one table and is still owed according to
        // another.
        expect(paid).toContain("prisma.$transaction")
        const tx = paid.slice(paid.indexOf("prisma.$transaction"))
        expect(tx).toContain("tx.finalSettlement.updateMany")
        expect(tx).toContain('status: "APPROVED"')
        expect(tx).toContain('data: { status: "PAID" }')
        expect(tx).toContain("payrollRunId: run.id")
    })

    it("records who said so and when", () => {
        expect(paid).toContain("paidById")
        expect(paid).toContain("MARK_PAYROLL_PAID")
    })

    it("takes a date, and refuses one that has not happened", () => {
        // A transfer made on the 25th is usually recorded on the 27th, and
        // stamping the 27th makes the record disagree with the bank. A future
        // date is the one thing this status is not for.
        expect(PAID_ROUTE).toContain("A payment date cannot be in the future")
        expect(PAGE).toContain("max={new Date().toISOString().slice(0, 10)}")
    })
})

describe("the file somebody actually pays from", () => {
    it("is served as a file, not as an API envelope", () => {
        expect(EXPORT_ROUTE).toContain("text/csv")
        expect(EXPORT_ROUTE).toContain("Content-Disposition")
        expect(EXPORT_ROUTE).toContain("attachment; filename=")
    })

    it("is never cached", () => {
        // Somebody downloads it, spots a wrong figure, fixes it and downloads
        // again. A cached first copy is a payment run made from figures that
        // were already corrected.
        expect(EXPORT_ROUTE).toContain("no-store")
    })

    it("names the status in the filename", () => {
        // So a draft export cannot be mistaken for an approved one once it is
        // sitting in somebody's downloads folder next to four others.
        const exportFn = DELIVERY.slice(DELIVERY.indexOf("static async exportCsv"))
        expect(exportFn).toContain("run.status.toLowerCase()")
    })

    it("writes every money column unsigned", () => {
        // A leading minus is one of the lead-ins lib/csv.ts has to defuse, so a
        // signed figure exports as text and stops being a number. The sign is
        // carried by the column heading instead.
        const exportFn = DELIVERY.slice(DELIVERY.indexOf("static async exportCsv"))
        expect(exportFn).not.toMatch(/-\s*Number\(/)
        expect(exportFn).toContain("Deductions")
    })
})

describe("the screen tells the truth about what has gone out", () => {
    it("reports a count rather than a flag", () => {
        // The honest answer to "have the payslips gone out" is usually a
        // number: batches resume, a reserved address is never stamped, and a
        // run can sit at 48 of 50 indefinitely.
        expect(PAGE).toContain("payroll_issue_progress")
        expect(PAGE).toContain("view.delivery.sent")
        expect(PAGE).toContain("view.delivery.sendable")
    })

    it("names the people a send skipped or failed on, separately from the count", () => {
        // A screen showing only "24 sent" leaves somebody to discover the
        // difference from the person who never got theirs.
        expect(PAGE).toContain("payroll_issue_skipped")
        expect(PAGE).toContain("payroll_issue_failed_some")
    })

    it("offers no send button before the month is approved", () => {
        const card = PAGE.slice(PAGE.indexOf("payroll_delivery"), PAGE.indexOf("{register && card("))
        expect(PAGE).toContain("{view && !isDraft && view.delivery && canDeliver && card(")
        expect(card).toContain("payroll_issue")
    })
})

describe("the copy exists in both languages", () => {
    it("every English key has an Arabic value", () => {
        // An English key with no Arabic value renders English text inside an
        // Arabic page. The reverse is only dead weight, so it is not asserted.
        const missing = Object.keys(en as any).filter(k => !(k in (ar as any)))
        expect(missing, `keys with no Arabic translation:\n${missing.join("\n")}`).toEqual([])
    })
})
