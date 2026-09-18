import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * The properties a printed document has to have, which are mostly about what it
 * refuses to do: show itself to the wrong person, print the dashboard around
 * itself, or state a figure whose wording could contradict its sign.
 */
const PAYSLIP_API = stripComments(readFileSync("app/api/payslips/[id]/route.ts", "utf8"))
const SETTLEMENT_API = stripComments(readFileSync("app/api/settlements/[id]/route.ts", "utf8"))
const PAYSLIP_PAGE = readFileSync("app/(dashboard)/dashboard/documents/payslip/[id]/page.tsx", "utf8")
const SETTLEMENT_PAGE = readFileSync("app/(dashboard)/dashboard/documents/settlement/[id]/page.tsx", "utf8")
const FRAME = readFileSync("components/DocumentFrame.tsx", "utf8")
const CSS = readFileSync("app/globals.css", "utf8")
const MIDDLEWARE = stripComments(readFileSync("middleware.ts", "utf8"))

describe("a payslip is not a public URL", () => {
    it("lives under the only prefix the middleware protects", () => {
        // The middleware requires a session for /dashboard and nothing else, so
        // a document at a root-level path would be readable by anybody with the
        // link. That is the single worst thing this feature could do.
        const authorized = MIDDLEWARE.slice(
            MIDDLEWARE.indexOf("authorized:"),
            MIDDLEWARE.indexOf("secret:", MIDDLEWARE.indexOf("authorized:")),
        )
        expect(authorized).toContain("pathname.startsWith('/dashboard')")
        expect(authorized).toContain("return !!token")
    })
})

describe("who may read one", () => {
    it("checks the payslip's own company, not the reader's", () => {
        // A manager at another company must not be able to read it by id, and
        // trusting the session's companyId alone would let them.
        expect(PAYSLIP_API).toContain("session.user.companyId === company.id")
        expect(PAYSLIP_API).toContain("payslip.payrollRun")
    })

    it("lets the owner see their own only when the company switched it on", () => {
        expect(PAYSLIP_API).toContain("company.payslipsVisible")
        expect(PAYSLIP_API).toContain("isOwner && company.payslipsVisible")
    })

    it("answers the same way for 'not yours' and 'switched off'", () => {
        // Distinguishing them tells an employee a payslip exists for them, which
        // is the thing the switch is off in order not to say.
        const denials = PAYSLIP_API.match(/ApiResponse\.forbidden\(/g) ?? []
        expect(denials).toHaveLength(1)
    })

    it("keeps settlements to managers, because the subject cannot sign in", () => {
        expect(SETTLEMENT_API).toContain("isManager")
        expect(SETTLEMENT_API).not.toContain("isOwner")
    })
})

describe("the document prints as a document", () => {
    it("hides the dashboard around it without knowing the shell's markup", () => {
        // display:none on named containers would break the first time the shell
        // is restructured, and a sidebar printed on a payslip is not the kind of
        // bug anybody reports before it has happened a hundred times.
        expect(CSS).toMatch(/@media print[\s\S]*?body \*[\s\S]*?visibility: hidden/)
        expect(CSS).toMatch(/\.print-document,[\s\S]*?visibility: visible/)
    })

    it("drops its own controls", () => {
        // A printed payslip with a Print button on it reads as a screenshot.
        expect(CSS).toMatch(/\.no-print[\s\S]*?display: none/)
        expect(FRAME).toContain('className="no-print"')
        expect(FRAME).toContain('className="print-document"')
    })

    it("uses one frame, so two documents from one employer look like it", () => {
        expect(PAYSLIP_PAGE).toContain("DocumentFrame")
        expect(SETTLEMENT_PAGE).toContain("DocumentFrame")
    })
})

describe("a settlement statement cannot contradict itself", () => {
    it("takes its wording from the sign, in one place", () => {
        // The figure and the sentence beside it are derived from the same
        // number. Two independent decisions is how a statement ends up saying
        // "the company owes you" above a negative total.
        expect(SETTLEMENT_API).toContain("net > 0 ? 'COMPANY_OWES' : net < 0 ? 'PERSON_OWES' : 'SETTLED'")
        expect(SETTLEMENT_PAGE).toContain("}[doc.direction]")
    })

    it("shows both sides, not just the net", () => {
        // A statement printing only the net is arithmetic somebody has to take
        // on trust. Earned beside already-paid is what lets them check it.
        expect(SETTLEMENT_PAGE).toContain("doc_earned")
        expect(SETTLEMENT_PAGE).toContain("doc_already_paid")
    })
})

describe("a draft payslip says so on its face", () => {
    it("carries a notice until the month is approved", () => {
        // A payslip that turns out to have been provisional, without having said
        // so, is worse than no payslip.
        expect(PAYSLIP_PAGE).toContain("doc.status === 'DRAFT'")
        expect(PAYSLIP_PAGE).toContain("doc_draft_note")
    })

    it("accounts for what the deductions could not take", () => {
        // The net floors at zero, so the carried amount has to be stated or it
        // disappears from the document that was supposed to account for it.
        expect(PAYSLIP_PAGE).toContain("doc.carried > 0")
        expect(PAYSLIP_PAGE).toContain("doc_carried_note")
    })
})

describe("a settlement is reachable from the person it is about", () => {
    it("is listed on their history page", () => {
        // They cannot sign in. If HR cannot open it from that person's page, the
        // document exists and nobody can get to it.
        const history = readFileSync("app/(dashboard)/dashboard/employees/[id]/history/page.tsx", "utf8")
        expect(history).toContain("/api/users/${params.id}/settlements")
        expect(history).toContain("/dashboard/documents/settlement/")
    })
})
