import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { advanceLine, closedText, payrollMonthName } from "./salary-advance-words"
import { salaryAdvanceRow, salaryAdvanceWhere, type Viewer } from "./requests/feed"
import { withGrants } from "./permissions/test-actors"

/**
 * Asking for a salary advance on the Requests page (LATER_CHANGES_PLAN.md
 * §7.5, step 3a; DESIGN.md §5.5, Asking for a salary advance): the row's
 * words, why one can't be asked for, which advances each tab lists, and the
 * dialog's and page's wiring. What may be asked for, asking and withdrawing,
 * against Postgres: lib/salary-advance.db.test.ts. Made-up people.
 */

const enT = (key: string) => en[key as keyof typeof en] ?? key
const arT = (key: string) => ar[key as keyof typeof ar] ?? key
const read = (file: string) => readFileSync(file, "utf8")
const dialog = () => read("app/(dashboard)/dashboard/requests/SalaryAdvanceDialog.tsx")
const client = () => read("app/(dashboard)/dashboard/requests/RequestsClient.tsx")

const facts = { amountMinor: 1_000_000, months: 6, first: { year: 2026, month: 11 }, consentedAt: "2026-11-28T08:00:00.000Z", overInstallment: false, overDebts: false }

describe("a salary advance's row", () => {
    it("says the amount, the months and the first installment, in either language", () => {
        expect(advanceLine(enT as never, "en", facts)).toBe("10,000.00 EGP over 6 months, from November 2026 payroll")
        expect(advanceLine(arT as never, "ar", facts)).toBe("١٠٬٠٠٠٫٠٠ ج.م، مدة السداد ٦ أشهر، بدءًا من رواتب نوفمبر ٢٠٢٦")
        expect(advanceLine(enT as never, "en", { ...facts, months: 1 })).toBe("10,000.00 EGP over 1 month, from November 2026 payroll")
        expect(advanceLine(arT as never, "ar", { ...facts, months: 2 })).toBe("١٠٬٠٠٠٫٠٠ ج.م، مدة السداد شهران، بدءًا من رواتب نوفمبر ٢٠٢٦")
    })

    it("names a payroll month by its month and year, or by its month alone", () => {
        expect(payrollMonthName("en", { year: 2026, month: 12 })).toBe("December 2026")
        expect(payrollMonthName("ar", { year: 2026, month: 12 })).toBe("ديسمبر ٢٠٢٦")
        expect(payrollMonthName("en", { year: 2026, month: 11 }, false)).toBe("November")
    })
})

describe("why one can't be asked for", () => {
    it("is said in the dialog's words, in either language", () => {
        expect(closedText(enT as never, "en", { reason: "SERVICE", months: 3, from: "2027-02-15" })).toBe("Salary advances can be asked for 3 months after your contract starts: from 15 February 2027.")
        expect(closedText(arT as never, "ar", { reason: "SERVICE", months: 2, from: "2027-02-15" })).toBe("يمكن طلب سلفة الراتب بعد أن يمضي على بدء عقدك شهران: أي من ١٥ فبراير ٢٠٢٧.")
        expect(closedText(enT as never, "en", { reason: "OPEN", status: "PENDING" })).toBe("Only one salary advance can be open at a time, and yours is still waiting.")
        expect(closedText(enT as never, "en", { reason: "OPEN", status: "APPROVED" })).toBe("Only one salary advance can be open at a time, and yours is still being paid back.")
        expect(closedText(enT as never, "en", { reason: "NO_SALARY" })).toBe("A salary advance is measured against your monthly salary, which isn't set yet.")
        expect(closedText(enT as never, "en", { reason: "NO_NET" })).toBe("Nothing is left of your monthly salary after the payroll deductions, so a salary advance can't be asked for.")
        expect(closedText(enT as never, "en", { reason: "DEBTS", percent: 25 })).toBe("Your other debts already take 25% of your net pay, the most all debts together may take, so a salary advance can't be asked for now.")
        expect(closedText(arT as never, "ar", { reason: "DEBTS", percent: 25 })).toContain("٢٥٪")
    })

    it("is said in place of the form, with Close alone", () => {
        const source = dialog()
        expect(source).toContain("if (!offer || offer.closed) return (")
        expect(source).toContain("<DialogActions><Button onClick={onCancel}>{t('close')}</Button></DialogActions>")
    })
})

describe("which salary advances each tab lists", () => {
    const person = (over: Record<string, unknown> = {}): Viewer => withGrants({ id: "ehab", role: "EMPLOYEE", companyId: "c1", ...over }) as Viewer
    const q = { tab: "mine" as const, show: "waiting" as const, search: "", personId: "", companyId: null }

    it("lists one's own on Mine, waiting or done", () => {
        expect(salaryAdvanceWhere(person(), q)).toEqual({ companyId: "c1", userId: "ehab", status: "PENDING" })
        expect(salaryAdvanceWhere(person(), { ...q, show: "done" })).toEqual({ companyId: "c1", userId: "ehab", status: { in: ["APPROVED", "REJECTED", "WITHDRAWN"] } })
    })

    it("lists none on To review until they can be approved, none for the Super Admin, and none to search for", () => {
        expect(salaryAdvanceWhere(person(), { ...q, tab: "review" })).toBeNull()
        expect(salaryAdvanceWhere(person({ role: "SUPER_ADMIN", companyId: null }), q)).toBeNull()
        expect(salaryAdvanceWhere(person(), { ...q, search: "car" })).toMatchObject({ id: { in: [] } })
    })

    it("lists none where the company hasn't Payroll", () => {
        const source = read("lib/requests/feed.ts")
        const where = source.slice(source.indexOf("export function salaryAdvanceWhere"))
        expect(where.slice(0, where.indexOf("\n}"))).toContain('if (!sessionHasModule({ user: v }, "PAYROLL")) return null')
    })

    it("lets whoever asked withdraw it while it waits, and nobody decide it yet", () => {
        const row = (status: string, userId = "ehab") => salaryAdvanceRow(person(), {
            id: "sa1", userId, amount: "10000.00", months: 6, firstYear: 2026, firstMonth: 11, status, overInstallment: true, overDebts: false,
            consentedAt: new Date("2026-11-28T08:00:00Z"), withdrawnAt: status === "WITHDRAWN" ? new Date("2026-11-29T08:00:00Z") : null,
            createdAt: new Date("2026-11-28T08:00:00Z"), updatedAt: new Date("2026-11-29T09:00:00Z"), user: { firstName: "Ehab", lastName: "One" },
        })
        expect(row("PENDING")).toMatchObject({ kind: "salaryAdvance", mayWithdraw: true, mayDecide: false, finished: null, salaryAdvance: { ...facts, overInstallment: true } })
        expect(row("PENDING", "mona").mayWithdraw).toBe(false)
        expect(row("WITHDRAWN")).toMatchObject({ mayWithdraw: false, finished: "2026-11-29T08:00:00.000Z", sortAt: "2026-11-29T08:00:00.000Z" })
    })
})

describe("asking, on the Requests page", () => {
    it("is offered in New request to whoever is in a company with Payroll and isn't an owner", () => {
        expect(read("app/(dashboard)/dashboard/requests/page.tsx")).toContain("const mayAskAdvance = !owner && !superAdmin && !!viewer.companyId && sessionHasModule({ user: viewer }, 'PAYROLL')")
        const source = client()
        expect(source).toContain("|| (k === 'salaryAdvance' && mayAskAdvance))")
        expect(source).toContain("? <AskSalaryAdvance onCancel={close} onAsked={asked} />")
    })

    it("reads what may be asked for from the server, and sends it with the language its consent was shown in", () => {
        const source = dialog()
        expect(source).toContain("useSWR('/api/salary-advances', fetcher)")
        expect(source).toContain("body: JSON.stringify({ amount, months, first, locale }),")
    })

    it("checks what's typed by the server's own rules, said under each field, and goes to the first", () => {
        const source = dialog()
        expect(source).toContain("const check = advanceCheck(draft, offer)")
        expect(source).toContain("setErrors(check.errors)\n        if (Object.keys(check.errors).length > 0) {\n            focusFirst(form, check.errors)\n            return")
    })

    it("shows each installment and the consent once the amount and months are right, and the main button agrees and sends", () => {
        const source = dialog()
        expect(source).toContain("const lines = !check.errors.amount && !check.errors.months && check.amountMinor > 0")
        expect(source).toContain("consentWords({ salary_advance_consent: t('salary_advance_consent') }, check.amountMinor, locale)")
        expect(source).toContain("{t('salary_advance_agree_send')}</Button>")
    })

    it("offers next month's first unless changed, or says this month's is approved in place of the choice", () => {
        const source = dialog()
        expect(source).toContain("const first = picked && firstKeys.includes(picked) ? picked : firstKeys[firstKeys.length - 1]")
        expect(source).toContain("{offer.approved\n                ? <p className=\"ui-prose\">{t('salary_advance_first_only')")
        expect(enT("salary_advance_first_only").replace("{month}", "December 2026").replace("{approved}", "November")).toBe("First installment: December 2026 payroll, as November's is approved.")
    })

    it("refused as something changed meanwhile, says so above the buttons and reads what may be asked for again, keeping what's typed", () => {
        const source = dialog()
        const refused = source.slice(source.indexOf("if (body.code === 'SALARY_ADVANCE_INVALID' || body.code === 'SALARY_ADVANCE_CLOSED') {"))
        expect(refused.slice(0, refused.indexOf("return"))).toContain("setChanged(true)")
        expect(refused.slice(0, refused.indexOf("return"))).toContain("await mutate()")
        expect(source).toContain("{changed && <p className=\"ui-error\" role=\"alert\">{t('salary_advance_changed')}</p>}")
        expect(source.indexOf("{changed && ")).toBeLessThan(source.lastIndexOf("<DialogActions>"))
    })

    it("is answered by its route: what's wrong, or why none may be asked for now", () => {
        const route = read("app/api/salary-advances/route.ts")
        expect(route).toContain('if (error.code === "SALARY_ADVANCE_INVALID") return ApiResponse.refused(400,')
        expect(route).toContain('if (error.code === "SALARY_ADVANCE_CLOSED") return ApiResponse.refused(409,')
        expect(route).toContain('if (session.user.role === "SUPER_ADMIN" || !session.user.companyId) return ApiResponse.forbidden()')
    })

    it("is withdrawn at its own route, asked first", () => {
        expect(read("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx")).toContain("? await fetch(`/api/salary-advances/${request.id}`, { method: 'DELETE' })")
        expect(read("app/api/salary-advances/[id]/route.ts")).toContain("await SalaryAdvanceService.withdraw(id, session.user.id)")
        expect(client()).toContain(": withdrawing.salaryAdvance ? 'salary_advance_withdraw_hint'")
    })
})

describe("the Salary advances card's note", () => {
    it("says employees can ask for one, but nobody can approve one yet", () => {
        expect(en.salary_advances_note).toContain("Employees can ask for one on the Requests page, but nobody can approve one yet, so it waits.")
        expect(ar.salary_advances_note).toContain("يمكن للموظفين طلب سلفة من صفحة الطلبات، لكن لا يمكن لأحد اعتمادها بعد")
    })
})
