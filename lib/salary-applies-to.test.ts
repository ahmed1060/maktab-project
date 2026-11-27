import { beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { stripComments } from "./strip-comments"

/**
 * A salary change's payroll on an employee's Edit (LATER_CHANGES_PLAN.md
 * §7.13, PR 437; DESIGN.md, A salary change's payroll): once the monthly
 * salary is changed, Applies to, under it, asks which payroll it's for, this
 * month's from its 1st or next month's from its 1st, with neither picked for
 * them. This month's payroll approved, the server's refusal is said under it.
 * Made-up people.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
beforeEach(() => { state.locale = "en" })

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const FORM = stripComments(readFileSync("components/EmployeeProfileForm.tsx", "utf8"))

const ACCESS = {
    own: false, edit: true, company: false, salary: true, dayOffCredit: true, resetPassword: true, role: false, ownTeamLeader: false,
    teamLeader: false, status: false, endContract: true, changeEmail: true, changeUsername: false, changeSalary: true, changeDayOffCredit: true,
    nameByRequest: false, changePassword: true,
}
const VALUES = {
    firstName: "Mona", lastName: "Ali", gender: "FEMALE", email: "mona@delta.test", username: "ds7",
    salary: "13000", salaryEffective: "", dayOffCredit: "21", password: "", status: "ACTIVE", teamLeaderId: "",
}
const MONTHS = { thisMonth: "1 November", nextMonth: "1 December" }
async function form(over: Record<string, unknown> = {}) {
    const { ProfileForm } = await import("@/components/profile/ProfileForm")
    return renderToStaticMarkup(h(ProfileForm, {
        values: VALUES, set: () => {}, errors: {}, error: null, access: ACCESS, company: null, ownTeamLeader: null,
        leaders: [], busy: false, onSubmit: () => {}, cancelHref: "/dashboard/employees/u1?mode=view", salaryMonths: MONTHS, ...over,
    } as never))
}
/** The choice by its group label, or "" where there's none. */
function choice(html: string, legend: string): string {
    const at = html.indexOf(`<legend class="ui-label">${esc(legend)}</legend>`)
    if (at < 0) return ""
    return html.slice(html.lastIndexOf("<fieldset", at), html.indexOf("</fieldset>", at) + 11)
}
/** Each radio button: its value, its words, and whether it's picked. */
const options = (group: string) => [...group.matchAll(/<label class="ui-choice"[^>]*><input ([^>]*)>([^<]*)<\/label>/g)]
    .map(m => [m[1].match(/value="([^"]+)"/)?.[1], m[2], /checked=""/.test(m[1])])

describe("Applies to, on an employee's Edit", () => {
    it("asks which payroll a changed salary is for, under it: this month's or next month's, each from its 1st, neither picked", async () => {
        const html = await form()
        const group = choice(html, en.salary_effective_label)
        expect(group).not.toBe("")
        expect(options(group)).toEqual([
            ["THIS_MONTH", "This month&#x27;s payroll, from 1 November", false],
            ["NEXT_MONTH", "Next month&#x27;s payroll, from 1 December", false],
        ])
        expect(group).toMatch(/<input [^>]*name="salaryEffective"/)
        // Under the salary, before the day off credit.
        const salary = html.indexOf('name="salary"')
        expect(salary).toBeGreaterThan(-1)
        expect(html.indexOf(group)).toBeGreaterThan(salary)
        expect(html.indexOf(group)).toBeLessThan(html.indexOf('name="dayOffCredit"'))
    })

    it("has the one picked", async () => {
        const group = choice(await form({ values: { ...VALUES, salaryEffective: "NEXT_MONTH" } }), en.salary_effective_label)
        expect(options(group).map(o => o[2])).toEqual([false, true])
    })

    it("isn't asked while the salary is as it was saved", async () => {
        expect(choice(await form({ salaryMonths: null }), en.salary_effective_label)).toBe("")
    })

    it("isn't asked of someone who may not change the salary", async () => {
        expect(choice(await form({ access: { ...ACCESS, changeSalary: false } }), en.salary_effective_label)).toBe("")
    })

    it("says under it what's wrong", async () => {
        const group = choice(await form({ errors: { salaryEffective: en.salary_effective_required } }), en.salary_effective_label)
        expect(group).toContain(`class="ui-error">${esc(en.salary_effective_required)}</span>`)
    })

    it("is in Arabic, with the month's 1st in Arabic digits", async () => {
        state.locale = "ar"
        const { salaryMonths } = await import("@/lib/profile-form")
        const group = choice(await form({ salaryMonths: salaryMonths("2026-11-27", "ar") }), ar.salary_effective_label)
        expect(options(group).map(o => o[1])).toEqual(["رواتب هذا الشهر، من ١ نوفمبر", "رواتب الشهر القادم، من ١ ديسمبر"])
    })

    it("is off while it's saved", async () => {
        const group = choice(await form({ busy: true }), en.salary_effective_label)
        expect(group.match(/<input [^>]*>/g)?.every(input => / disabled=""/.test(input))).toBe(true)
    })
})

describe("the months it names", () => {
    it("are this month's 1st and next month's, in the company's calendar's today", async () => {
        const { salaryMonths } = await import("@/lib/profile-form")
        expect(salaryMonths("2026-11-27", "en")).toEqual({ thisMonth: "1 November", nextMonth: "1 December" })
        expect(salaryMonths("2026-11-01", "en")).toEqual({ thisMonth: "1 November", nextMonth: "1 December" })
        expect(salaryMonths("2026-12-31", "en")).toEqual({ thisMonth: "1 December", nextMonth: "1 January" })
        expect(salaryMonths("2027-01-31", "ar")).toEqual({ thisMonth: "١ يناير", nextMonth: "١ فبراير" })
    })

    it("are asked once the salary differs from the one saved, as it's sent", async () => {
        const { salaryChanged } = await import("@/lib/profile-form")
        expect(salaryChanged("13000", "12500")).toBe(true)
        expect(salaryChanged("12500", "12500")).toBe(false)
        expect(salaryChanged("12500.00", "12500")).toBe(false)
        // Left empty, it's sent as 0.
        expect(salaryChanged("", "0")).toBe(false)
        expect(salaryChanged("", "12500")).toBe(true)
    })
})

describe("what's checked, and what's refused", () => {
    it("asks for a payroll once the salary is changed, and nothing otherwise", async () => {
        const { profileErrors } = await import("@/lib/profile-form")
        const base = { firstName: "Mona", lastName: "Ali", password: "", salary: "13000" }
        expect(profileErrors({ ...base, salaryEffective: "" }).salaryEffective).toBe("salary_effective_required")
        expect(profileErrors({ ...base, salaryEffective: "THIS_MONTH" }).salaryEffective).toBeUndefined()
        expect(profileErrors({ ...base, salaryEffective: "NEXT_MONTH" }).salaryEffective).toBeUndefined()
        expect(profileErrors(base).salaryEffective).toBeUndefined()
    })

    it("is said under the choice, after the salary, where the page's first wrong field is looked for", async () => {
        const { PROFILE_FIELDS } = await import("@/lib/profile-form")
        expect(PROFILE_FIELDS.indexOf("salaryEffective")).toBe(PROFILE_FIELDS.indexOf("salary") + 1)
    })

    it("says this month's payroll approved under the choice", async () => {
        const { refusedField } = await import("@/lib/profile-form")
        expect(refusedField({ error: "This month's payroll is approved.", code: "PAYROLL_MONTH_LOCKED" })).toEqual({ field: "salaryEffective", key: "salary_effective_locked" })
        // One the route found wrong, asked for again.
        expect(refusedField({ error: "Validation Error", details: { salaryEffective: { _errors: ["Invalid"] } } })).toEqual({ field: "salaryEffective", key: "salary_effective_required" })
    })

    it("is refused by the route with its code, on a save", () => {
        const route = stripComments(readFileSync("app/api/users/route.ts", "utf8"))
        const put = route.slice(route.indexOf("export const PUT"))
        expect(put).toMatch(/if \(error\.message === 'PAYROLL_MONTH_LOCKED'\) return ApiResponse\.refused\(409, "[^"]+", "PAYROLL_MONTH_LOCKED"\)/)
        expect(put).toMatch(/if \(error\.message === 'SALARY_MONTH_PASSED'\) return ApiResponse\.refused\(409, "[^"]+", "SALARY_MONTH_PASSED"\)/)
    })

    it("says a month that's past under the choice", async () => {
        const { refusedField } = await import("@/lib/profile-form")
        expect(refusedField({ error: "A new month has begun.", code: "SALARY_MONTH_PASSED" })).toEqual({ field: "salaryEffective", key: "salary_effective_month_passed" })
    })
})

describe("the salary, saved", () => {
    const service = stripComments(readFileSync("lib/services/user.service.ts", "utf8"))
    const write = service.slice(service.indexOf("const updated = await (handOff || keepFrom || leavesAdmin || salaryPlan"), service.indexOf(").catch(error => {", service.indexOf("const updated = await (handOff")))

    it("is written in the same transaction as the rest of their details, under the month's lock, refused there first", () => {
        // A refusal, approval having won the race, saves nothing on the page (Codex review on PR 437).
        expect(write).toContain("prisma.$transaction(async (tx) => {")
        expect(write).toContain("}, LOCK_WAIT)")
        const plan = service.slice(service.indexOf("const writeSalary = async (tx: Prisma.TransactionClient) => {"), service.indexOf("const updated = await (handOff"))
        expect(plan).toContain("await lockMonths(tx, regularUser.companyId, [salaryPlan.month])")
        expect(plan).toContain(`if ((await lockedMonths(tx, regularUser.companyId, [salaryPlan.month])).size > 0) throw new Error("PAYROLL_MONTH_LOCKED")`)
        expect(plan).toContain("await SalaryHistoryService.record({")
        expect(plan).toContain("}, tx)")
        expect(write.indexOf("await writeSalary(tx)")).toBeGreaterThan(-1)
        expect(write.indexOf("await writeSalary(tx)")).toBeLessThan(write.indexOf("tx.user.update("))
        // With the salary, the set last, next month's too (DESIGN.md).
        expect(write).toContain("data: kept ? { ...updateData, keptSession: kept } : updateData, select: writeSelect")
    })

    it("is for the months the page named, refused where that's past, before anything is written", () => {
        const planned = service.slice(service.indexOf("const salaryPlan = salaryMoved"), service.indexOf("const writeSalary"))
        expect(planned).toContain("const named = input.salaryMonth ?? current")
        expect(planned).toContain("const month = choice === 'NEXT_MONTH' ? monthAfter(named) : named")
        expect(planned).toContain(`if (month !== current && month !== monthAfter(current)) throw new Error("SALARY_MONTH_PASSED")`)
        expect(planned).toContain("effectiveFrom: effectiveFromChoice(now, month === current ? 'THIS_MONTH' : 'NEXT_MONTH', zone)")
        expect(service.indexOf("const salaryPlan = salaryMoved")).toBeLessThan(service.indexOf("const updated = await (handOff"))
    })

    it("takes the month it's for from the page, as a month", () => {
        const schema = stripComments(readFileSync("lib/validations/user.schema.ts", "utf8"))
        expect(schema).toContain("salaryMonth: z.string().regex(/^\\d{4}-\\d{2}$/).optional(),")
    })
})

describe("the Edit page, wired to it", () => {
    it("asks it once the salary differs from the one saved, naming the company's months in the page's language", () => {
        expect(FORM).toContain("const salaryMoved = access.changeSalary && salaryChanged(salary, savedSalary)")
        expect(FORM).toContain("salaryMonths={salaryMoved ? salaryMonths(today, locale) : null}")
    })

    it("checks it, and sends it, only then", () => {
        const submit = FORM.slice(FORM.indexOf("const handleSubmit"), FORM.indexOf("const executeSubmit"))
        expect(submit).toContain("salaryEffective: salaryMoved ? salaryEffective : undefined,")
        const payload = FORM.slice(FORM.indexOf("method: 'PUT'"), FORM.indexOf("reassignReportsTo: reassignTo"))
        expect(payload).toContain("salaryEffective: salaryMoved ? salaryEffective : undefined,")
    })

    it("sends the month its choice was shown for", () => {
        const payload = FORM.slice(FORM.indexOf("method: 'PUT'"), FORM.indexOf("reassignReportsTo: reassignTo"))
        expect(payload).toContain("salaryMonth: salaryMoved ? today.slice(0, 7) : undefined,")
    })

    it("names the new months, with nothing picked, once the month it named is past", () => {
        const save = FORM.slice(FORM.indexOf("const executeSubmit"), FORM.indexOf("// Their role, as the form may change it"))
        expect(FORM).toContain("const [openedAt, setOpenedAt] = useState(() => new Date())")
        expect(save).toContain("if (answer?.code === 'SALARY_MONTH_PASSED') { setOpenedAt(new Date()); setSalaryEffective('') }")
        expect(save.indexOf("answer?.code === 'SALARY_MONTH_PASSED'")).toBeLessThan(save.indexOf("const refused = refusedField(answer)"))
    })

    it("picks nothing for them, and forgets the pick once the salary is put back", () => {
        expect(FORM).toContain("const [salaryEffective, setSalaryEffective] = useState('')")
        expect(FORM).toContain("if (field === 'salary' && !salaryChanged(value, savedSalary)) setSalaryEffective('')")
    })

    it("keeps the salary saved as the one it's compared with", () => {
        expect(FORM).toContain("setSavedSalary(employee.salary !== undefined && employee.salary !== null ? employee.salary.toString() : '')")
    })
})

describe("its words", () => {
    const KEYS = ["salary_effective_label", "salary_effective_this", "salary_effective_next", "salary_effective_required", "salary_effective_locked", "salary_effective_month_passed"] as const

    it("are as DESIGN.md says them", () => {
        expect(en.salary_effective_label).toBe("Applies to")
        expect(en.salary_effective_this).toBe("This month's payroll, from {date}")
        expect(en.salary_effective_next).toBe("Next month's payroll, from {date}")
        expect(en.salary_effective_required).toBe("Pick which payroll the new salary is for.")
        expect(en.salary_effective_locked).toBe("This month's payroll is approved, so the new salary can only be next month's.")
        expect(en.salary_effective_month_passed).toBe("A new month has begun since this page was opened. Pick which payroll the new salary is for.")
    })

    it("are in Arabic, asking nothing in the masculine", () => {
        for (const key of KEYS) {
            expect(ar[key], key).toBeTruthy()
            expect(ar[key], key).not.toMatch(/(^|\s)(أدخل|اختر|حاول|اكتب|انسخ|تحقق)(\s|$)|هل أنت متأكد|هل تريد/)
        }
        expect(ar.salary_effective_this).toContain("{date}")
        expect(ar.salary_effective_next).toContain("{date}")
    })
})
