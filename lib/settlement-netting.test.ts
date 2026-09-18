import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { planFinalRecovery, planRecovery, type RecoverableDebt } from "./debt-recovery"
import { toMinor } from "./payroll"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * I1 and the three enhancements.
 *
 * I1 is the sequel to G4: recovery gave every month a way to collect, and in
 * doing so made the settlement the one occasion that slips through — because
 * after it there is no next month to collect from.
 */

const SETTLEMENT = stripComments(readFileSync("lib/services/settlement.service.ts", "utf8"))
const RUN_SERVICE = stripComments(readFileSync("lib/services/payroll-run.service.ts", "utf8"))
const SETTLEMENT_API = stripComments(readFileSync("app/api/settlements/[id]/route.ts", "utf8"))
const STATEMENT = readFileSync("app/(dashboard)/dashboard/documents/settlement/[id]/page.tsx", "utf8")
const MODAL = readFileSync("components/EndContractModal.tsx", "utf8")
const REGISTER = readFileSync("app/(dashboard)/dashboard/payroll/page.tsx", "utf8")
const DEBTS_API = stripComments(readFileSync("app/api/users/[id]/debts/route.ts", "utf8"))
const EMPLOYEE = readFileSync("app/(dashboard)/dashboard/employees/[id]/history/page.tsx", "utf8")
const BACKUP = readFileSync(".github/workflows/backup.yml", "utf8")
const SCHEMA = readFileSync("prisma/schema.prisma", "utf8")

const debt = (id: string, minor: number, due = "2026-05-25"): RecoverableDebt =>
    ({ id, outstandingMinor: minor, dueDate: new Date(due) })

describe("I1: the settlement is the last chance to collect", () => {
    it("takes the debt out of what the company owes", () => {
        // Sara: owed 8,000 on leaving, owes 3,000 from an earlier carry. She
        // used to be paid 8,000 and the 3,000 stayed outstanding forever.
        const plan = planFinalRecovery({ netMinor: toMinor("8000"), debts: [debt("d1", toMinor("3000"))] })
        expect(plan.totalMinor).toBe(toMinor("3000"))
        expect(toMinor("8000") - plan.totalMinor).toBe(toMinor("5000"))
    })

    it("never bills a leaver on their way out", () => {
        // The ceiling is the settlement itself. What it cannot reach stays a
        // debt — a thing somebody can chase or write off — rather than becoming
        // a demand on a final statement.
        const plan = planFinalRecovery({ netMinor: toMinor("1000"), debts: [debt("d1", toMinor("9000"))] })
        expect(plan.totalMinor).toBe(toMinor("1000"))
        expect(toMinor("1000") - plan.totalMinor).toBe(0)
    })

    it("takes nothing when the settlement pays nothing", () => {
        for (const net of [0, -1, toMinor("-5000")]) {
            expect(planFinalRecovery({ netMinor: Math.max(0, net), debts: [debt("d1", toMinor("9000"))] }).totalMinor).toBe(0)
        }
    })

    it("ignores the percentage cap, because there is no next month to protect", () => {
        // The cap guards somebody still earning from being left with nothing to
        // live on. At a settlement there is no future income, so applying it
        // would leave money uncollectable for a reason that no longer exists.
        const debts = [debt("d1", toMinor("8000"))]
        const monthly = planRecovery({ netMinor: toMinor("8000"), debts, capPercent: 25, dueOnOrBefore: new Date("2026-05-31") })
        const final = planFinalRecovery({ netMinor: toMinor("8000"), debts })
        expect(monthly.totalMinor).toBe(toMinor("2000"))
        expect(final.totalMinor).toBe(toMinor("8000"))
    })

    it("collects a debt that is not due yet, because it never will be", () => {
        // A debt due next month cannot be collected next month; the person will
        // not be there.
        const plan = planFinalRecovery({
            netMinor: toMinor("8000"),
            debts: [debt("future", toMinor("3000"), "2030-01-01")],
        })
        expect(plan.totalMinor).toBe(toMinor("3000"))
    })

    it("still drains oldest first", () => {
        const plan = planFinalRecovery({
            netMinor: toMinor("1000"),
            debts: [debt("new", toMinor("900"), "2026-05-01"), debt("old", toMinor("900"), "2026-01-01")],
        })
        expect(plan.allocations[0].debtId).toBe("old")
    })
})

describe("I1: recorded without breaking the statement's own arithmetic", () => {
    it("keeps netAmount as earned minus paid", () => {
        // A net that quietly included something else would stop adding up in
        // front of the person reading it.
        expect(SCHEMA).toContain("debtRecoveredAmount Decimal     @default(0) @db.Decimal(12, 2)")
        expect(SETTLEMENT).toContain("netAmount: toMajor(preview.netMinor)")
        expect(SETTLEMENT).toContain("debtRecoveredAmount: toMajor(preview.debtRecoveredMinor)")
    })

    it("caps the recovery at the settlement in the service too", () => {
        expect(SETTLEMENT).toContain("planFinalRecovery({ netMinor: Math.max(0, preview.netMinor), debts })")
    })

    it("closes the debts it paid, in the same transaction as the contract ending", () => {
        const commit = SETTLEMENT.slice(SETTLEMENT.indexOf("static async settleAndEnd"))
        expect(commit).toContain("for (const allocation of preview.debtAllocations)")
        expect(commit).toContain("recoveredAmount: recovered")
        expect(commit).toContain('status: "SETTLED"')
    })

    it("skips a debt that closed between preview and commit rather than failing", () => {
        expect(SETTLEMENT).toContain('if (!existing || existing.status !== "OUTSTANDING") continue')
    })

    it("shows the deduction and the payable figure on the statement", () => {
        expect(SETTLEMENT_API).toContain("debtRecovered: Number(settlement.debtRecoveredAmount)")
        expect(SETTLEMENT_API).toContain("payable: net - Number(settlement.debtRecoveredAmount)")
        expect(STATEMENT).toContain("doc_debt_recovered")
        expect(STATEMENT).toContain("doc_payable")
        // Only when there is something to show.
        expect(STATEMENT).toContain("doc.debtRecovered > 0 &&")
    })

    it("warns before the contract is ended, not after", () => {
        expect(MODAL).toContain("settlement_debt_recovered")
        expect(MODAL).toContain("settlement_debt_remains")
        expect(en.settlement_debt_remains).toMatch(/stays outstanding/i)
    })
})

describe("I1: the email and the statement say the same thing", () => {
    const DELIVERY = stripComments(readFileSync("lib/services/payroll-delivery.service.ts", "utf8"))

    it("quotes what will actually be paid, not the figure before the debt", () => {
        // Introduced by I1 itself and caught by auditing the same commit: the
        // statement deducted the debt and the email did not, so one settlement
        // had two figures — in the channel that reaches the person without
        // waiting to be opened.
        const resend = DELIVERY.slice(DELIVERY.indexOf("static async resendSettlement"))
        expect(resend).toContain("const payable = net - recovered")
        expect(resend).toContain("payable > 0")
        expect(resend).not.toMatch(/net > 0\s*\n\s*\? `The company owes you \$\{net/)
    })

    it("names the deduction rather than silently netting it", () => {
        // Somebody whose final payment is smaller than expected is owed the
        // line that explains it.
        expect(DELIVERY).toContain("Less amounts you already owed")
        expect(DELIVERY).toContain("recovered > 0 ?")
    })
})

describe("E1: what changed since the draft you read", () => {
    it("compares the computed register against the stored draft", () => {
        expect(RUN_SERVICE).toContain("sinceDraft:")
        expect(RUN_SERVICE).toContain('run.status === "DRAFT" && run.payslips.length > 0')
    })

    it("only for a draft, because past that the stored figures are the record", () => {
        const view = RUN_SERVICE.slice(RUN_SERVICE.indexOf("static async view"), RUN_SERVICE.indexOf("static async saveDraft"))
        expect(view).toContain('draftSavedAt: run && run.status === "DRAFT"')
    })

    it("interrupts only when something actually moved", () => {
        expect(REGISTER).toContain("view?.sinceDraft?.people.filter(p => p.kind !== 'SAME')")
        expect(REGISTER).toContain("if (!isDraft || changed.length === 0) return null")
    })

    it("says approval freezes what is on screen now", () => {
        expect(en.payroll_since_draft_msg).toMatch(/not what you read then/i)
    })
})

describe("E2: what happened to a debt", () => {
    it("lists closed debts too", () => {
        // A list of open debts answers what is left; this answers what happened.
        expect(DEBTS_API).toContain("where: { userId: params.id }")
        expect(DEBTS_API).not.toContain('status: "OUTSTANDING" }')
    })

    it("distinguishes what was recovered from what was forgiven", () => {
        expect(DEBTS_API).toContain('writtenOff: d.status === "WAIVED" ? amount - recovered : 0')
    })

    it("is manager-only, like every other payroll record", () => {
        expect(DEBTS_API).toContain("managesCompany(session.user.role, session.user.companyId, user.companyId)")
    })

    it("and something assembles it on the person's page", () => {
        expect(EMPLOYEE).toContain("/api/users/${params.id}/debts")
        expect(EMPLOYEE).toContain("debts_title")
        expect(EMPLOYEE).toContain("debt_status_")
    })
})

describe("E3: the backup label is no longer decorative", () => {
    it("reads the input it has always declared", () => {
        expect(BACKUP).toContain("github.event.inputs.label")
        expect(BACKUP).toContain('[ -n "$LABEL" ] && KIND="$LABEL"')
    })

    it("sanitises it, because it becomes part of a path", () => {
        expect(BACKUP).toContain("tr -cd '[:alnum:]_-'")
        expect(BACKUP).toContain("cut -c1-32")
    })

    it("still falls back when nothing usable is supplied", () => {
        expect(BACKUP).toContain(`KIND="\${{ github.event_name == 'schedule' && 'auto' || 'manual' }}"`)
    })
})

describe("the copy exists in both languages", () => {
    it("every English key has an Arabic value", () => {
        const missing = Object.keys(en as any).filter(k => !(k in (ar as any)))
        expect(missing, `no Arabic translation:\n${missing.join("\n")}`).toEqual([])
    })
})
