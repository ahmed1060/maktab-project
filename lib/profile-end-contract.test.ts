import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { existsSync, readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * A person's profile, part 5 (UI_PLAN.md §5 step 5, PR 195): ending their
 * contract, or reinstating it, and handing over a leader's team, in the
 * building blocks' dialogs (DESIGN.md §5.5). The settlement is shown with the
 * statement's own lines before it's recorded, and what's wrong is said under
 * the date, or the leader picked, or above the buttons, in the reader's
 * language. They were windows of their own making, styled by hand, and their
 * refusals were said in a toast, in English.
 */

const state = { locale: "en" as "en" | "ar", swr: undefined as unknown }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => ({ default: () => ({ data: state.swr, error: undefined, isValidating: false, mutate: async () => {} }) }))
beforeEach(() => { state.locale = "en"; state.swr = undefined })
// Loaded once, first: compiled cold, a dialog takes longer than a test may.
beforeAll(async () => {
    await import("@/components/profile/EndContractDialog")
    await import("@/components/profile/TeamHandOffDialog")
}, 60_000)

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const DIALOG = () => readFileSync("components/profile/EndContractDialog.tsx", "utf8")
const HANDOFF = () => readFileSync("components/profile/TeamHandOffDialog.tsx", "utf8")
const FORM = () => readFileSync("components/EmployeeProfileForm.tsx", "utf8")
const ROUTE = () => readFileSync("app/api/users/[id]/employment/route.ts", "utf8")

/** A field by its label, up to its end: its control, and its hint or its error. */
function field(html: string, label: string): string {
    const at = html.indexOf(`>${esc(label)}</label>`)
    expect(at, `no field labelled ${label}`).toBeGreaterThan(-1)
    const start = html.lastIndexOf('<div class="ui-field">', at)
    return html.slice(start, html.indexOf("</div>", at) + 6)
}
const tag = (chunk: string, element = "input") => chunk.match(new RegExp(`<${element}[^>]*>`))?.[0] ?? ""
const hint = (chunk: string) => chunk.match(/<span id="[^"]+" class="ui-hint">(.*?)<\/span><\/div>$/)?.[1] ?? null
const options = (chunk: string) => [...chunk.matchAll(/<option value="([^"]*)"[^>]*>(.*?)<\/option>/g)].map(m => [m[1], m[2]])
const line = (label: string, amount: string) => `<div class="ui-doc-line"><span>${esc(label)}</span><bdi class="ui-doc-amount">${amount}</bdi></div>`
const total = (label: string, amount: string) => `<div class="ui-doc-line ui-doc-total"><span>${esc(label)}</span><bdi class="ui-doc-amount">${amount}</bdi></div>`
const note = (tone: string, text: string) => `<p class="ui-doc-note" data-tone="${tone}">${esc(text)}</p>`
/** A text with {name} in it, the name kept whole in either direction. */
const named = (text: string, name: string) => { const [before, after] = text.split("{name}"); return `${esc(before)}<bdi>${name}</bdi>${esc(after)}` }

const SETTLEMENT = {
    daysWorked: 18, earned: 9000, paid: 10000, net: -1000, direction: "PERSON_OWES", paidSource: "PAYSLIP",
    debtsOutstanding: 0, debtRecovered: 0, cashAdvanceHeld: 0, payable: 0,
}

async function rendered<P>(load: () => Promise<(props: P) => unknown>, props: P) {
    const Component = await load()
    // Its portal is a stand-in's here, which still asks where it goes.
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(Component as never, props as never))
    } finally {
        vi.unstubAllGlobals()
    }
}
const endDialog = (over: Record<string, unknown> = {}) => rendered(async () => (await import("@/components/profile/EndContractDialog")).EndContractDialog as never,
    { userId: "u1", name: "Laila Fouad", status: "ACTIVE", today: "2026-11-05", onClose: () => {}, onDone: () => {}, ...over })
const figures = (over: Record<string, unknown> = {}) => rendered(async () => (await import("@/components/profile/EndContractDialog")).SettlementPreview as never,
    { settlement: SETTLEMENT, undecided: 0, ...over })

const REPORTS = [{ id: "e-1", firstName: "Laila", lastName: "Fouad" }, { id: "e-2", firstName: "Nour", lastName: "Adel" }]
const LEADERS = [
    { id: "tl-1", firstName: "Omar", lastName: "Said", status: "ACTIVE" },
    { id: "tl-2", firstName: "Sara", lastName: "Kamal", status: "ACTIVE" },
    { id: "tl-3", firstName: "Hany", lastName: "Aziz", status: "ARCHIVED" },
    { id: "tl-4", firstName: "Mai", lastName: "Samy", status: "OFFLINE" },
]
const handoff = (over: Record<string, unknown> = {}) => rendered(async () => (await import("@/components/profile/TeamHandOffDialog")).TeamHandOffDialog as never,
    { leaderId: "tl-1", leaderName: "Omar Said", reports: REPORTS, leaders: LEADERS, onCancel: () => {}, onConfirm: async () => null, ...over })

describe("the two windows", () => {
    it("are the building blocks' dialogs, and the old ones are gone", () => {
        expect(existsSync("components/EndContractModal.tsx")).toBe(false)
        expect(existsSync("components/TeamHandOffModal.tsx")).toBe(false)
        for (const src of [DIALOG(), HANDOFF()]) {
            expect(src).toContain("<Dialog open onClose={cancel}")
            expect(src).toContain("<DialogActions>")
            // Nothing styled, portalled or sided by hand.
            expect(src).not.toMatch(/style=\{\{|modal-overlay|modal-content|createPortal|className="btn|textAlign|paddingRight|paddingLeft/)
        }
    })
})

describe("ending a contract", () => {
    it("is a form under their name: the last working day from today, the settlement, the reason, then Cancel and End contract", async () => {
        const html = await endDialog()
        expect(html).toContain(`class="ui-dialog-title">${named(en.end_contract_title, "Laila Fouad")}</h2>`)
        expect(html).toMatch(/<form class="ui-form" novalidate="">/i)
        const date = field(html, en.last_working_day)
        expect(tag(date)).toMatch(/type="date"/)
        expect(tag(date)).toContain('name="lastWorkingDay"')
        // Today in the company's calendar, as its parent works it out.
        expect(tag(date)).toContain('value="2026-11-05"')
        // Not a sign-in field: nothing for a password manager to offer.
        expect(tag(date)).toMatch(/autocomplete="off"/i)
        expect(hint(date)).toBe(esc(en.last_working_day_hint))
        expect(html).toContain(`<h3 id="`)
        expect(html).toContain(`class="ui-settlement-title">${esc(en.settlement_preview)}</h3>`)
        expect(tag(field(html, en.end_contract_reason), "textarea")).toContain('name="reason"')
        expect(html.indexOf(en.settlement_preview)).toBeLessThan(html.indexOf(esc(en.end_contract_reason)))
    })

    // The figure confirmed is the figure recorded: while the date's own
    // settlement is worked out, the button waits. It took the date on the form
    // with the last one's figures on screen, and after a preview that didn't
    // load, with none (found reading the code).
    it("says the settlement is being worked out, and End contract waits for the date's own", async () => {
        const html = await endDialog()
        // Heard by screen readers as the region it's in changes (web interface audit).
        expect(html).toContain(`<p class="ui-hint">${esc(en.loading)}</p>`)
        expect(html).toContain(`<div class="ui-dialog-actions"><button type="button" class="ui-btn ui-btn-secondary">${esc(en.cancel)}</button><button type="submit" class="ui-btn ui-btn-danger" disabled="">${esc(en.end_contract_confirm)}</button></div>`)
        const src = DIALOG()
        expect(src).toContain("const current = shown?.for === lastWorkingDay ? shown : null")
        // Nor once it didn't load, with what it said and Try again above it.
        expect(src).toContain("const unavailable = !!current && 'failed' in current")
        expect(src).toContain("disabled={loading || unavailable}")
    })

    // A contract ending today ends at the start of tomorrow (endOfContractInstant):
    // it was said to end access at once, and in the viewer's calendar (found
    // reading the code).
    it("says when access ends as the server has it: at once only for a day before today", async () => {
        const { accessEndsNow } = await import("@/lib/end-contract")
        expect(accessEndsNow("2026-11-04", "2026-11-05")).toBe(true)
        expect(accessEndsNow("2026-11-05", "2026-11-05")).toBe(false)
        expect(accessEndsNow("2026-12-01", "2026-11-05")).toBe(false)
        expect(await endDialog()).toContain(`<p class="ui-hint">${esc(en.end_contract_effective_later)}</p>`)
        expect(await endDialog({ today: "2026-11-06" })).toContain(`<p class="ui-hint">${esc(en.end_contract_effective_later)}</p>`)
    })

    it("asks for a date, typed in full, before anything is sent", async () => {
        const { lastDayErrors } = await import("@/lib/end-contract")
        expect(lastDayErrors({ lastWorkingDay: "2026-11-05", unreadable: false })).toEqual({})
        expect(lastDayErrors({ lastWorkingDay: "", unreadable: false })).toEqual({ lastWorkingDay: "end_contract_date_needed" })
        // A date the browser couldn't read reads as empty.
        expect(lastDayErrors({ lastWorkingDay: "", unreadable: true })).toEqual({ lastWorkingDay: "end_contract_date_incomplete" })
    })

    it("reinstates under their name, with what it does, then Cancel and Reinstate", async () => {
        const html = await endDialog({ status: "ARCHIVED" })
        expect(html).toContain(`class="ui-dialog-title">${named(en.reinstate_title, "Laila Fouad")}</h2>`)
        expect(html).toContain(`<p>${esc(en.reinstate_msg)}</p>`)
        expect(html).not.toContain(`>${esc(en.last_working_day)}</label>`)
        expect(html).toContain(`<div class="ui-dialog-actions"><button type="button" class="ui-btn ui-btn-secondary">${esc(en.cancel)}</button><button type="submit" class="ui-btn ui-btn-primary">${esc(en.reinstate)}</button></div>`)
    })

    it("stays open while it's sent: Cancel off, the button busy, Escape ignored", () => {
        const src = DIALOG()
        expect(src).toContain("const cancel = () => { if (!busy) onClose() }")
        expect(src).toContain("<Button onClick={cancel} disabled={busy}>{t('cancel')}</Button>")
        expect(src).toMatch(/<Button type="submit" variant="danger" busy=\{busy\} disabled=\{loading \|\| unavailable\}>/)
    })
})

describe("the settlement, before it's recorded", () => {
    // The statement's own lines (DESIGN.md §5.5, Document), as it will have them.
    it("shows the statement's lines and its net, what was paid taken off", async () => {
        const html = await figures()
        expect(html).toContain(`<div class="ui-doc-group">${line(en.settlement_days_worked, "18")}${line(en.settlement_earned, "9,000.00")}${line(en.settlement_paid, "−10,000.00")}${total(en.settlement_net, "1,000.00")}</div>`)
        // Nothing paid is no amount taken off: no minus sign on nothing.
        expect(await figures({ settlement: { ...SETTLEMENT, paid: 0, net: 9000, direction: "COMPANY_OWES" } })).toContain(line(en.settlement_paid, "0.00"))
    })

    it("says who owes whom in the colour of what it means for them", async () => {
        expect(await figures()).toContain(note("problem", en.settlement_person_owes))
        expect(await figures({ settlement: { ...SETTLEMENT, net: 1000, direction: "COMPANY_OWES" } })).toContain(note("good", en.settlement_company_owes))
        expect(await figures({ settlement: { ...SETTLEMENT, net: 0, direction: "SETTLED" } })).toContain(note("neutral", en.settlement_settled))
    })

    it("marks a month whose payroll isn't paid yet as the one to act on, and says the others quietly", async () => {
        expect(await figures()).toContain(`<p class="ui-hint">${esc(en.settlement_paid_from_payslip)}</p>`)
        expect(await figures({ settlement: { ...SETTLEMENT, paidSource: "NO_RUN" } })).toContain(`<p class="ui-hint">${esc(en.settlement_provisional)}</p>`)
        const unpaid = await figures({ settlement: { ...SETTLEMENT, paidSource: "RUN_NOT_PAID" } })
        expect(unpaid).toContain(note("waiting", en.settlement_run_not_paid))
        expect(unpaid).not.toContain(esc(en.settlement_paid_from_payslip))
    })

    it("takes the debts they owe from what they're paid, and says what's left of them", async () => {
        const owed = { ...SETTLEMENT, net: 1000, direction: "COMPANY_OWES", debtsOutstanding: 1500, debtRecovered: 1000, payable: 0, cashAdvanceHeld: 300 }
        const html = await figures({ settlement: owed })
        expect(html).toContain(`<p class="ui-hint">${esc(en.settlement_advance_to_debt.replace("{amount}", "300.00"))}</p>`)
        expect(html).toContain(`${line(en.settlement_debt_recovered, "−1,000.00")}${total(en.settlement_payable, "0.00")}`)
        expect(html).toContain(note("waiting", en.settlement_debt_remains.replace("{amount}", "500.00")))
        // No debts, no lines for them.
        expect(await figures()).not.toContain(esc(en.settlement_debt_recovered))
    })

    it("says the days nobody has ruled on, counted in words", async () => {
        const { undecidedDays } = await import("@/lib/end-contract")
        expect(undecidedDays({ suspensions: [{ fromDay: 3, toDay: 5, deduct: null }, { fromDay: 9, toDay: 9, deduct: true }, { fromDay: 20, toDay: 20, deduct: null }] })).toBe(4)
        expect(undecidedDays(null)).toBe(0)
        expect(await figures({ undecided: 3 })).toContain(note("waiting", en.end_contract_undecided.replace("{days}", "3 days")))
        expect(en.end_contract_undecided).not.toContain("(s)")
        expect(ar.end_contract_undecided).not.toContain("/")
    })

    it("is in the page's language, digits too", async () => {
        state.locale = "ar"
        const money = (n: number) => new Intl.NumberFormat("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
        const html = await figures()
        expect(html).toContain(line(ar.settlement_days_worked, "١٨"))
        expect(html).toContain(line(ar.settlement_earned, money(9000)))
        expect(await figures({ undecided: 3 })).toContain(note("waiting", ar.end_contract_undecided.replace("{days}", "٣ أيام")))
    })

    // Worked out again for another date, its figures were redrawn without a
    // word to a screen reader. They're said once they're in, not while the
    // last date's stand in for them (web interface audit).
    it("is said to screen readers once it's in, and not while it's worked out again", async () => {
        expect(await figures()).toMatch(/<section class="ui-settlement" aria-labelledby="[^"]+" aria-live="polite">/)
        expect(await figures({ stale: true })).toMatch(/<section class="ui-settlement" aria-labelledby="[^"]+" aria-live="polite" aria-busy="true">/)
    })

    it("says so when it couldn't be worked out, with Try again", async () => {
        const html = await figures({ settlement: null, failed: true })
        expect(html).toContain(`<p class="ui-error">${esc(en.end_contract_preview_failed)}</p>`)
        expect(html).toContain(`<button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">${esc(en.try_again)}</button>`)
    })
})

describe("what's wrong, in the reader's language", () => {
    it("is said under the date, or above the buttons, by the server's code", async () => {
        const { endContractRefusal } = await import("@/lib/end-contract")
        expect(endContractRefusal({ code: "NO_SALARY" })).toEqual({ field: "lastWorkingDay", key: "end_contract_no_salary" })
        expect(endContractRefusal({ code: "NOT_A_DATE" })).toEqual({ field: "lastWorkingDay", key: "end_contract_date_incomplete" })
        expect(endContractRefusal({ code: "LAST_ADMIN" })).toEqual({ key: "end_contract_last_admin" })
        expect(endContractRefusal({ code: "ADMIN_IS_SUPER_ADMINS" })).toEqual({ key: "end_contract_admin" })
        expect(endContractRefusal({ code: "USER_HAS_NO_COMPANY" })).toEqual({ key: "end_contract_no_company" })
        // The code prompt for a high-risk action, turned down: they know.
        expect(endContractRefusal({ code: "STEP_UP_REQUIRED" })).toBe("quiet")
        expect(endContractRefusal({ code: "MFA_ENROL_REQUIRED" })).toBe("quiet")
        expect(endContractRefusal({ code: "toString" })).toBeNull()
        expect(endContractRefusal(null)).toBeNull()
    })

    // What to do next, not only what's wrong (web interface audit).
    it("says what to do about a month with no salary", () => {
        expect(en.end_contract_no_salary).toMatch(/Choose a day in a month they're paid for\.$/)
        expect(ar.end_contract_no_salary).toMatch(/يُرجى تحديد يوم في شهر مسجّل فيه راتب\.$/)
    })

    it("is answered by the server with its code beside its words", async () => {
        const { ApiResponse } = await import("@/lib/api-response")
        const res = ApiResponse.refused(400, "No salary in effect for 2026-11", "NO_SALARY")
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ success: false, error: "No salary in effect for 2026-11", code: "NO_SALARY" })
        const route = ROUTE()
        expect(route).toContain(`ApiResponse.refused(400, "lastWorkingDay must be YYYY-MM-DD", "NOT_A_DATE")`)
        expect(route).toContain(`ApiResponse.refused(400, message, "NO_SALARY")`)
        expect(route).toContain(`"USER_HAS_NO_COMPANY")`)
        // An Admin's, and the company's last Admin's, as a role's are (lib/role-errors.ts).
        expect(route).toContain("adminRefusal(error)")
        expect(route).not.toContain("ApiResponse.badRequest(\"A company must keep at least one Admin")
    })

    it("is said under the leader picked, when that leader can't take the team", async () => {
        const { handoffRefusal } = await import("@/lib/end-contract")
        expect(handoffRefusal({ code: "LEADER_UNAVAILABLE" })).toBe("handoff_leader_archived")
        expect(handoffRefusal({ code: "TEAM_LEADER_NOT_FOUND" })).toBe("handoff_leader_gone")
        expect(handoffRefusal({ code: "NOT_A_LEADER" })).toBe("handoff_leader_gone")
        expect(handoffRefusal({ code: "DIFFERENT_COMPANY" })).toBe("handoff_leader_refused")
        expect(handoffRefusal({ code: "REASSIGN_TARGET_IS_LEAVING" })).toBe("handoff_leader_refused")
        expect(handoffRefusal({ code: "LAST_ADMIN" })).toBeNull()
        const { teamRefusalResponse } = await import("./team-handoff-response")
        const res = teamRefusalResponse(new Error("LEADER_UNAVAILABLE"))!
        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ code: "LEADER_UNAVAILABLE" })
    })
})

describe("handing over a team", () => {
    it("names who leaves and who's in the team, then asks who takes them", async () => {
        const html = await handoff()
        expect(html).toContain(`class="ui-dialog-title">${esc(en.handoff_title)}</h2>`)
        expect(html).toContain(`<p>${named(en.handoff_body, "Omar Said").replace("{count}", "2 employees")}</p>`)
        // Named, not counted.
        expect(html).toContain(`<ul class="ui-dialog-list"><li><bdi>Laila Fouad</bdi></li><li><bdi>Nour Adel</bdi></li></ul>`)
        const to = field(html, en.handoff_move_to)
        expect(tag(to, "select")).toContain('name="handoffTo"')
        // Not the leader who's going, nor one whose account is archived, which the server refuses.
        expect(options(to)).toEqual([["", en.handoff_unassign], ["tl-2", "Sara Kamal"], ["tl-4", "Mai Samy"]])
        expect(hint(to)).toBe(esc(en.handoff_unassign_note))
        expect(html).toContain(`<div class="ui-dialog-actions"><button type="button" class="ui-btn ui-btn-secondary">${esc(en.handoff_cancel)}</button><button type="submit" class="ui-btn ui-btn-primary">${esc(en.handoff_confirm)}</button></div>`)
    })

    // A name with no space in it breaks where it must, as the dialog's title
    // and paragraphs do, rather than run past the dialog (web interface audit).
    it("breaks a name with no space in it, rather than run past the dialog", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        const at = css.indexOf(".ui-dialog-list {")
        expect(css.slice(at, css.indexOf("}", at))).toContain("overflow-wrap: anywhere;")
    })

    it("says the leaders are loading, and waits for them", async () => {
        const html = await handoff({ leaders: null })
        const to = field(html, en.handoff_move_to)
        expect(tag(to, "select")).toMatch(/disabled=""/)
        expect(options(to)).toEqual([["", esc(en.loading)]])
        expect(hint(to)).toBeNull()
        expect(html).toContain(`<button type="submit" class="ui-btn ui-btn-primary" disabled="">${esc(en.handoff_confirm)}</button>`)
    })

    it("leaves out the leader who's going and archived accounts", async () => {
        const { handoffLeaders } = await import("@/lib/end-contract")
        expect(handoffLeaders(LEADERS, "tl-1").map(l => l.id)).toEqual(["tl-2", "tl-4"])
    })

    // Once answered, it stays open until the change is sent, as a confirmation
    // does (DESIGN.md §5.5, Dialog), so a leader who can't take them is said
    // under the leader picked: it closed first, and the refusal was a toast,
    // or a line above the form's buttons, in English.
    it("sends the answer and stays open until it's sent, saying under the leader why one can't take them", () => {
        const src = HANDOFF()
        // The empty option means unassign, so it goes as null.
        expect(src).toContain("const problem = await onConfirm(handoffTo || null)")
        expect(src).toMatch(/if \(problem\) \{\s*setError\(problem\)\s*focusFirstWrong\(form\.current\)/)
        expect(src).toContain("const cancel = () => { if (!busy) onCancel() }")
        expect(src).toContain("handoffLeaders(leaders, leaderId)")
    })
})

describe("the profile, wired to them", () => {
    it("opens ending a contract from their details, from today in the company's calendar", () => {
        const form = FORM()
        expect(form).toContain("import { EndContractDialog } from './profile/EndContractDialog'")
        expect(form).toContain("const today = calendarDateStr(openedAt, companyZone ?? DEFAULT_TIME_ZONE)")
        expect(form).toMatch(/<EndContractDialog[\s\S]{0,200}today=\{today\}/)
        expect(form).not.toMatch(/EndContractModal|TeamHandOffModal/)
    })

    it("asks the form's hand-off in the one dialog, open until the save settles", () => {
        const form = FORM()
        expect(form).toContain("import { TeamHandOffDialog } from './profile/TeamHandOffDialog'")
        expect(form).toMatch(/<TeamHandOffDialog[\s\S]{0,80}leaderId=\{userId\}/)
        expect(form).toContain("onConfirm={reassignTo => executeSubmit(reassignTo)}")
        // A leader who can't take them, after an answer, goes back to the dialog.
        expect(form).toContain("const handedOff = reassignTo !== undefined ? handoffRefusal(answer) : null")
        expect(form).toContain("if (handedOff) {")
    })

    it("asks ending a contract's hand-off in the same dialog, with leaders asked for only then", () => {
        const src = DIALOG()
        expect(src).toMatch(/<TeamHandOffDialog[\s\S]{0,80}leaderId=\{userId\}/)
        expect(src).toContain("useSWR(handoff ? TEAM_LEADERS : null, fetcher)")
        // No answer on the first attempt, so the server can ask.
        expect(src).toContain("...(reassignTo !== undefined && { reassignReportsTo: reassignTo })")
        expect(src).toContain("const handedOff = reassignTo !== undefined ? handoffRefusal(answer) : null")
    })

    // A Super Admin has no contract, nor a company to settle with: End contract
    // was offered on another Super Admin's details, and refused (found reading
    // the code).
    it("offers End contract on no Super Admin's details", async () => {
        const { profileAccess } = await import("@/lib/profile-access")
        const can = () => true
        expect(profileAccess({ can, viewer: { id: "sa1", role: "SUPER_ADMIN" }, person: { id: "sa2", role: "SUPER_ADMIN" } }).endContract).toBe(false)
        expect(profileAccess({ can, viewer: { id: "sa1", role: "SUPER_ADMIN" }, person: { id: "a1", role: "ADMIN" } }).endContract).toBe(true)
        expect(profileAccess({ can, viewer: { id: "a1", role: "ADMIN" }, person: { id: "e1", role: "EMPLOYEE" } }).endContract).toBe(true)
    })
})

describe("the words", () => {
    const KEYS = [
        "end_contract_title", "reinstate_title", "reinstate_msg", "last_working_day", "last_working_day_hint", "end_contract_reason",
        "settlement_preview", "settlement_days_worked", "settlement_earned", "settlement_paid", "settlement_net", "settlement_company_owes",
        "settlement_person_owes", "settlement_settled", "settlement_paid_from_payslip", "settlement_run_not_paid", "settlement_debt_recovered",
        "settlement_payable", "settlement_debt_remains", "settlement_advance_to_debt", "settlement_provisional", "end_contract_confirm",
        "end_contract_effective_now", "end_contract_effective_later", "end_contract_undecided", "end_contract_preview_failed",
        "end_contract_no_salary", "end_contract_date_needed", "end_contract_date_incomplete", "end_contract_last_admin", "end_contract_admin",
        "end_contract_no_company", "end_contract_ended", "end_contract_recorded", "reinstate_done", "handoff_title", "handoff_body",
        "handoff_move_to", "handoff_unassign", "handoff_unassign_note", "handoff_confirm", "handoff_cancel", "handoff_leader_archived",
        "handoff_leader_gone", "handoff_leader_refused",
    ]

    it("are in both languages, in sentence case, under their name", () => {
        for (const key of KEYS) {
            expect((en as Record<string, string>)[key], key).toBeTruthy()
            expect((ar as Record<string, string>)[key], key).toBeTruthy()
        }
        expect(en.end_contract_title).toBe("End {name}'s contract")
        expect(en.reinstate_title).toBe("Reinstate {name}")
        for (const words of [en, ar] as Record<string, string>[]) {
            for (const key of ["end_contract_title", "reinstate_title", "handoff_body"]) expect(words[key], key).toContain("{name}")
            expect(words.handoff_body).toContain("{count}")
            expect(words.end_contract_undecided).toContain("{days}")
            expect(words.end_contract_recorded).toContain("{date}")
        }
    })

    // Gender-neutral Arabic: nothing asked in the masculine, and nobody
    // spoken of as "him" (اختر، انقلهم، اتركهم، سجّل، حصّلها، معه، يكون فيه).
    it("ask nothing in the masculine in Arabic", () => {
        for (const key of KEYS) {
            expect((ar as Record<string, string>)[key], key).not.toMatch(/(^|[\s،.:—]|و)(أدخل|اختر|حاول|اكتب|انسخ|تحقق|اتركه|اتركهم|اطلب|انقل|انقلهم|سجّل|شغّل|حصّلها|أعفِ|تابع|أكّد|امسح|انتظر|معه|عمله)([\s،.:—]|$)|هل أنت متأكد|هل تريد|أنك تريد|يكون فيه/)
        }
    })
})
