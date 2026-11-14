import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync, readdirSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { MEASURE_ONLY, SIX_DAY_FACTORY, STANDARD_OFFICE } from "./attendance/policy"

/**
 * Company settings on the building blocks, part 3b (UI_PLAN.md §5 step 5):
 * the Attendance tab's policy, that is what lateness, early leave, overtime
 * and absence cost and how permission hours work, and the dialog that changes
 * it, which the policy templates page shares.
 */

type Loaded = { data?: unknown; error?: unknown; isLoading?: boolean; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    swr: {} as Record<string, Loaded>,
}

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
    usePathname: () => "/dashboard/settings",
    useSearchParams: () => new URLSearchParams("tab=attendance"),
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me", role: "ADMIN" } } }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => {
    const useSWR = (key: string | null) => {
        const shown = key ? state.swr[key] : undefined
        return { data: undefined, error: undefined, isLoading: !!key && !shown, isValidating: false, mutate: async () => {}, ...shown }
    }
    return { default: useSWR, useSWRConfig: () => ({ mutate: async () => {} }) }
})

const KEY = "/api/attendance/policy?companyId=c1"
const POLICY = {
    versions: [
        { id: "p1", effectiveFrom: "2026-01-01", body: STANDARD_OFFICE, appliedTemplateId: "t1" },
        { id: "p2", effectiveFrom: "2026-12-01", body: { ...STANDARD_OFFICE, absence: { multiplier: 1.5 } }, appliedTemplateId: null },
    ],
    templates: [
        { id: "t1", name: "Standard Egyptian office", nameAr: "مكتب مصري قياسي", description: "Sunday to Thursday, 15 minutes' grace.", body: STANDARD_OFFICE },
        { id: "t2", name: "Six-day factory", nameAr: null, description: null, body: SIX_DAY_FACTORY },
    ],
    today: "2026-11-02",
    canEdit: true,
}
const loaded = (policy: unknown = POLICY) => ({ [KEY]: { data: { data: policy } } })
const esc = (s: string) => s.replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

async function card({ swr = loaded() as Record<string, Loaded>, locale = "en" as "en" | "ar", readOnly = false } = {}) {
    Object.assign(state, { swr, locale })
    const { default: Panel } = await import("@/components/AttendancePolicyPanel")
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(Panel, { companyId: "c1", readOnly, onChanged: () => {} }))
    } finally {
        vi.unstubAllGlobals()
    }
}

describe("the policy card", () => {
    it("says it's loading, and that it didn't load, with the server's reason and Try again", async () => {
        expect(await card({ swr: {} })).toContain('<div class="ui-panel" role="status">')
        const failed = await card({ swr: { [KEY]: { error: Object.assign(new Error("x"), { status: 500, info: { error: "Database unavailable" } }) } } })
        expect(failed).toContain(esc(en.attendance_policy_load_failed))
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(">Try again</button>")
    })

    it("is a card saying what the policy is for", async () => {
        const html = await card()
        expect(html).toContain(`<h2 class="ui-card-title">${en.attendance_policy}</h2>`)
        expect(html).toContain(`<p class="ui-card-note">${esc(en.attendance_policy_hint)}</p>`)
    })

    it("shows the policy in force as details, each rule in lines of its own words", async () => {
        const html = await card()
        expect(html).toContain('<dl class="ui-details">')
        for (const label of [en.attendance_in_force, en.attendance_work_week, en.attendance_lateness, en.attendance_early_leave, en.attendance_overtime, en.attendance_absence, en.attendance_permission_hours]) {
            expect(html, label).toContain(`<dt>${label}</dt>`)
        }
        expect(html).toContain(`<dd>${en.attendance_since_date.replace("{date}", "1 Jan 2026")}</dd>`)
        expect(html).toContain("<dd>Sun Mon Tue Wed Thu</dd>")
        // Lateness: its grace, each band, the free ones and the cap, a line each.
        expect(html).toContain('<ul class="ui-detail-lines">')
        for (const line of [
            en.attendance_grace_n.replace("{n}", "15"),
            en.attendance_band_line.replace("{from}", "16").replace("{to}", "30").replace("{cost}", en.attendance_day_quarter),
            en.attendance_band_line.replace("{from}", "31").replace("{to}", "60").replace("{cost}", en.attendance_day_half),
            en.attendance_band_open_line.replace("{from}", "61").replace("{cost}", en.attendance_day_1),
            en.attendance_free_line.replace("{times}", "2 times"),
            en.attendance_cap_line.replace("{days}", "3 days"),
            en.attendance_overtime_rates.replace("{workday}", "1.35").replace("{restDay}", "2").replace("{holiday}", "3"),
            en.attendance_overtime_approved_only,
            en.attendance_absence_line.replace("{days}", "1 day"),
            en.attendance_permission_line.replace("{hours}", "4 hours"),
        ]) expect(html, line).toContain(`<li>${line}</li>`)
        // No drawn separators or arrows between them.
        expect(html).not.toContain(" · ")
        expect(html).not.toContain("→")
    })

    it("says there's no policy yet, with Start from a template as the way to set one", async () => {
        const html = await card({ swr: loaded({ ...POLICY, versions: [] }) })
        expect(html).toContain(esc(en.attendance_no_policy))
        expect(html).toMatch(new RegExp(`ui-btn-primary[^>]*>(<svg[\\s\\S]*?</svg>)?${re(en.attendance_start_from_template)}</button>`))
        expect(html).not.toContain(`${en.attendance_change_policy}</button>`)
        expect(html).not.toContain('<dl class="ui-details">')
    })

    it("offers Change policy and Start from a template to whoever may change it, and neither to whoever can only look", async () => {
        const html = await card()
        expect(html).toMatch(new RegExp(`ui-btn-primary[^>]*>(<svg[\\s\\S]*?</svg>)?${en.attendance_change_policy}</button>`))
        expect(html).toMatch(new RegExp(`ui-btn-secondary[^>]*>(<svg[\\s\\S]*?</svg>)?${re(en.attendance_start_from_template)}</button>`))
        // It was a select whose first option was the label, with an ellipsis.
        expect(html).not.toContain("<select")
        expect(en.attendance_start_from_template).not.toContain("…")
        for (const html of [await card({ readOnly: true }), await card({ swr: loaded({ ...POLICY, canEdit: false }) })]) {
            expect(html).not.toContain(`${en.attendance_change_policy}</button>`)
            expect(html).not.toContain(`${re(en.attendance_start_from_template)}</button>`)
        }
    })

    it("lists the policies to come under Changes to come, each with Withdraw named for it", async () => {
        const html = await card()
        const from = en.attendance_from_date.replace("{date}", "1 Dec 2026")
        expect(html).toContain(`<h3 class="ui-subsection-title">${en.attendance_changes_to_come}</h3>`)
        expect(html).toContain(from)
        expect(html).toContain(`aria-label="${en.attendance_withdraw_named.replace("{name}", from)}"`)
        expect(await card({ readOnly: true })).not.toContain(`aria-label="${en.attendance_withdraw_named.replace("{name}", from)}"`)
    })

    it("is in Arabic, its numbers in Arabic-Indic digits as its dates are (DESIGN.md §3.3)", async () => {
        const html = await card({ locale: "ar" })
        expect(html).toContain(`<h2 class="ui-card-title">${ar.attendance_policy}</h2>`)
        expect(html).toContain(ar.attendance_grace_n.replace("{n}", "١٥"))
        expect(html).toContain(ar.attendance_overtime_rates.replace("{workday}", "١٫٣٥").replace("{restDay}", "٢").replace("{holiday}", "٣"))
        expect(html).toContain(ar.attendance_since_date.replace("{date}", "١ يناير ٢٠٢٦"))
        expect(html).not.toMatch(/<li>[^<]*[0-9]/)
    })
})

const weekdayName = (d: number) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]

async function dialog(props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") {
    Object.assign(state, { locale, swr: {} })
    const { default: PolicyDialog } = await import("@/components/attendance-policy/PolicyDialog")
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(PolicyDialog, {
            title: en.attendance_change_policy, start: STANDARD_OFFICE, companyId: "c1", defaultFrom: "2026-12-01", today: "2026-11-02",
            startOn: () => STANDARD_OFFICE, weekdayName, onClose: () => {}, onSave: async () => {}, ...props,
        } as never))
    } finally {
        vi.unstubAllGlobals()
    }
}

describe("the policy dialog", () => {
    it("is the building blocks' dialog: from when, with From today and From next month, and each field labelled", async () => {
        const html = await dialog()
        expect(html).toContain('role="dialog"')
        expect(html).toContain(`<h2 id="${html.match(/aria-labelledby="([^"]+)"/)?.[1]}" class="ui-dialog-title">${en.attendance_change_policy}</h2>`)
        expect(html).toContain(en.attendance_from_when)
        expect(html).toContain(esc(en.attendance_policy_from_hint))
        expect(html).toMatch(new RegExp(`ui-btn-quiet[^>]*>${en.attendance_from_today}</button>`))
        expect(html).toMatch(new RegExp(`ui-btn-quiet[^>]*>${en.attendance_from_next_month}</button>`))
        for (const label of [en.attendance_grace_minutes, en.attendance_charge, en.attendance_free_per_month, en.attendance_cap_days, en.attendance_overtime_minimum,
            en.attendance_rate_workday, en.attendance_absence_label, en.attendance_permission_allowance, en.attendance_permission_min, en.attendance_permission_max,
            en.attendance_permission_max_requests, en.attendance_permission_after, en.attendance_permission_carry]) {
            expect(html, label).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${re(label)}</label>`))
        }
        // An empty cap or limit means none, which its hint says, not a placeholder.
        expect(html).toContain(esc(en.attendance_no_cap_hint))
        expect(html).not.toContain("placeholder=")
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary[^"]*">${en.save}</button>`))
        expect(html).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-secondary[^"]*">${en.cancel}</button>`))
    })

    it("groups each rule's settings under its own heading, with a box to switch it on", async () => {
        const html = await dialog()
        for (const legend of [en.attendance_lateness, en.attendance_early_leave, en.attendance_overtime, en.attendance_permission_hours]) {
            expect(html, legend).toContain(`<legend class="ui-subsection-title">${legend}</legend>`)
        }
        expect(html).toContain(`<legend class="ui-label">${en.attendance_work_week}</legend>`)
        expect(html).toContain(`<legend class="ui-label">${en.attendance_permission_types}</legend>`)
        for (const box of [en.attendance_rule_on, en.attendance_overtime_on, en.attendance_overtime_approval, en.attendance_permission_on, en.attendance_escalation]) {
            expect(html, box).toMatch(new RegExp(`<label class="ui-choice"><input type="checkbox" class="ui-check"[^>]*/>${re(box)}</label>`))
        }
    })

    it("names each band by where it starts: its end, its cost and Remove; the last is open-ended", async () => {
        const html = await dialog()
        expect(html).toContain(`<legend class="ui-label">${en.attendance_bands_legend}</legend>`)
        expect(html).toContain(en.attendance_from_minute.replace("{n}", "16"))
        expect(html).toContain(`aria-label="${en.attendance_band_end_label.replace("{n}", "16")}"`)
        expect(html).toContain(`aria-label="${en.attendance_band_cost_label.replace("{n}", "16")}"`)
        expect(html).toContain(`aria-label="${en.attendance_band_remove.replace("{n}", "16")}"`)
        // The last band runs on: it says so, and has no end to type.
        expect(html).toContain(en.attendance_and_over)
        expect(html).not.toContain(`aria-label="${en.attendance_band_end_label.replace("{n}", "61")}"`)
        expect(html).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-secondary[^"]*">(<svg[\\s\\S]*?</svg>)?${en.attendance_add_band}</button>`))
    })

    it("offers a preview on last month, in a group of its own", async () => {
        const html = await dialog()
        expect(html).toContain(`<legend class="ui-subsection-title">${en.sim_title}</legend>`)
        expect(html).toContain(esc(en.sim_hint))
        expect(html).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-secondary[^"]*">${en.sim_run}</button>`))
    })

    it("has no from when and no preview for a template, and the template's own fields above the rules", async () => {
        const { default: TemplateFields } = await import("@/components/attendance-policy/TemplateFields")
        const header = h(TemplateFields, { value: { name: "", nameAr: "", description: "" }, error: en.attendance_template_name_required, onChange: () => {} })
        const html = await dialog({ companyId: undefined, defaultFrom: undefined, today: undefined, startOn: undefined, header, title: en.ptpl_new })
        expect(html).not.toContain(en.attendance_from_when)
        expect(html).not.toContain(en.sim_title)
        for (const label of [en.ptpl_name, en.ptpl_name_ar, en.ptpl_description]) {
            expect(html, label).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${label}</label>`))
        }
        // A name is asked for under its field, not by a Save that does nothing.
        expect(html).toMatch(new RegExp(`aria-invalid="true"[^>]*/></span><span id="[^"]+" class="ui-error">${en.attendance_template_name_required}</span>`))
        expect(html).toContain('dir="rtl"')
        expect(html).not.toContain("disabled=")
    })
})

describe("the policy form", () => {
    it("turns a policy into the form and back unchanged", async () => {
        const { bodyFromForm, formFromBody } = await import("@/components/attendance-policy/policy-form")
        for (const body of [STANDARD_OFFICE, SIX_DAY_FACTORY, MEASURE_ONLY, { ...STANDARD_OFFICE, faceVerificationAvailable: true, faceReverifyMonths: 12 }]) {
            expect(bodyFromForm(formFromBody(body), body)).toEqual({ ok: true, body })
        }
        const escalated = { ...STANDARD_OFFICE, lateness: { ...STANDARD_OFFICE.lateness, escalation: { fromOccurrence: 3, multiplier: 1.5 } } }
        expect(bodyFromForm(formFromBody(escalated), escalated)).toEqual({ ok: true, body: escalated })
    })

    it("says what's wrong with each number, under its field, before anything is sent", async () => {
        const { bodyFromForm, formFromBody } = await import("@/components/attendance-policy/policy-form")
        const form = formFromBody(STANDARD_OFFICE)
        const wrong = (edit: (f: typeof form) => void) => {
            const f = structuredClone(form)
            edit(f)
            const result = bodyFromForm(f, STANDARD_OFFICE)
            return result.ok ? {} : result.errors
        }
        // An emptied field was sent as 0.
        expect(wrong(f => { f.lateness.graceMinutes = "" })).toEqual({ "lateness.graceMinutes": { key: "number_whole_between", min: 0, max: 1440 } })
        expect(wrong(f => { f.overtime.multipliers.workday = "0.5" })).toEqual({ "overtime.multipliers.workday": { key: "number_between", min: 1, max: 5 } })
        expect(wrong(f => { f.lateness.bands[0].toMinutes = "10" })).toEqual({ "lateness.bands.0": { key: "number_whole_between", min: 16, max: 1440 } })
        expect(wrong(f => { f.permissionHours.minPerRequestMinutes = "200" })).toEqual({ "permissionHours.maxPerRequestMinutes": { key: "attendance_permission_limits_reversed" } })
        expect(wrong(f => { f.permissionHours.allowanceHours = "1" })).toEqual({ "permissionHours.maxPerRequestMinutes": { key: "attendance_permission_over_allowance" } })
        expect(wrong(f => { f.permissionHours.types = [] })).toEqual({ "permissionHours.types": { key: "attendance_permission_types_empty" } })
        expect(wrong(f => { f.workWeek = [] })).toEqual({ workWeek: { key: "attendance_work_week_empty" } })
        expect(wrong(f => { f.permissionHours.maxRequestsPerMonth = "40" })).toEqual({ "permissionHours.maxRequestsPerMonth": { key: "number_whole_between_or_empty", min: 1, max: 31 } })
        // Empty means none, where none is allowed.
        const none = structuredClone(form)
        Object.assign(none.lateness, { monthlyCapDays: "" })
        none.permissionHours.maxRequestsPerMonth = ""
        expect(bodyFromForm(none, STANDARD_OFFICE)).toMatchObject({ ok: true, body: { lateness: { monthlyCapDays: null }, permissionHours: { maxRequestsPerMonth: null } } })
        for (const key of ["number_whole_between", "number_whole_between_or_empty", "number_between", "number_between_or_empty", "attendance_permission_limits_reversed",
            "attendance_permission_over_allowance", "attendance_permission_types_empty"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
    })

    it("keeps a switched-off rule's last good numbers, so a field left wrong there doesn't stop the save", async () => {
        const { bodyFromForm, formFromBody } = await import("@/components/attendance-policy/policy-form")
        const form = formFromBody(STANDARD_OFFICE)
        form.lateness.enabled = false
        form.lateness.graceMinutes = ""
        form.permissionHours.enabled = false
        form.permissionHours.minPerRequestMinutes = "500"
        form.permissionHours.types = []
        const result = bodyFromForm(form, STANDARD_OFFICE)
        expect(result).toMatchObject({ ok: true, body: { lateness: { enabled: false, graceMinutes: 15 }, permissionHours: { enabled: false, minPerRequestMinutes: 30, maxPerRequestMinutes: 120 } } })
        expect(result.ok && result.body.permissionHours.types).toEqual(STANDARD_OFFICE.permissionHours.types)
    })

    it("starts each band right after the grace, or after the band before", async () => {
        const { bandStarts, formFromBody } = await import("@/components/attendance-policy/policy-form")
        const rule = formFromBody(STANDARD_OFFICE).lateness
        expect(bandStarts(rule)).toEqual([16, 31, 61])
        expect(bandStarts({ ...rule, graceMinutes: "20" })).toEqual([21, 31, 61])
        // Until an end is a number, the band after it can't say where it starts.
        expect(bandStarts({ ...rule, bands: [{ ...rule.bands[0], toMinutes: "" }, ...rule.bands.slice(1)] })).toEqual([16, null, 61])
    })
})

describe("nothing of the old panel is left", () => {
    it("has no hand-set styles, glass panels, old windows, drawn separators or arrows", () => {
        const files = ["components/AttendancePolicyPanel.tsx", ...readdirSync("components/attendance-policy").map(f => `components/attendance-policy/${f}`)]
        for (const file of files) {
            const src = readFileSync(file, "utf8")
            for (const old of ["style={", "className=\"glass", "ConfirmModal", "@/components/Modal", "className=\"btn", "className=\"input\"", "' · '", "→", "'…'", "<table"]) {
                expect(src, `${file}: ${old}`).not.toContain(old)
            }
        }
    })
})

describe("found in the browser and the audit (company settings part 3b)", () => {
    it("lets a card's head wrap when it has more than one button, so they stay inside the card on a phone", () => {
        // Start from a template and Change policy, beside the title, ran past the card's edge on a phone and widened the page.
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-card-head:has\(> \.ui-btn \+ \.ui-btn\) \{\s*flex-wrap: wrap;/)
    })

    it("writes the preview's month as the page's language writes a month", async () => {
        const { monthText } = await import("@/components/attendance-policy/Simulation")
        expect(monthText("2026-10", "en-GB")).toBe("October 2026")
        expect(monthText("2026-10", "ar-EG")).toBe("أكتوبر ٢٠٢٦")
        // It was "2026-10", in Latin digits in Arabic too.
        const src = readFileSync("components/attendance-policy/Simulation.tsx", "utf8")
        expect(src.match(/\.replace\('\{month\}', monthText\(data\.month, intl\)\)/g)).toHaveLength(2)
    })

    it("names each of the dialog's number fields", async () => {
        const html = await dialog()
        const numbers = html.match(/<input[^>]*type="number"[^>]*>/g) ?? []
        expect(numbers.length).toBeGreaterThan(10)
        for (const input of numbers) expect(input, input).toMatch(/ name="[a-zA-Z.0-9]+"/)
        for (const name of ["lateness.graceMinutes", "lateness.bands.0", "overtime.multipliers.workday", "permissionHours.maxPerRequestMinutes"]) {
            expect(html, name).toContain(`name="${name}"`)
        }
    })

    it("doesn't say where a band starts after one whose end comes before its own start", async () => {
        // "From minute 11" followed "From minute 16" while the first band's end was typed as 10.
        const { bandStarts, formFromBody } = await import("@/components/attendance-policy/policy-form")
        const rule = formFromBody(STANDARD_OFFICE).lateness
        expect(bandStarts({ ...rule, bands: [{ ...rule.bands[0], toMinutes: "10" }, ...rule.bands.slice(1)] })).toEqual([16, null, 61])
    })

    it("gives each band a line saying where it starts, with Remove, over its end and cost half each", async () => {
        // All four on one line didn't fit: Remove fell to a line of its own on a computer, and a phone cut a cost short ("نصف يو").
        const html = await dialog()
        expect(html).toMatch(new RegExp(`<div class="ui-band-head"><span class="ui-band-from">${en.attendance_from_minute.replace("{n}", "16")}</span><button[^>]*aria-label="${en.attendance_band_remove.replace("{n}", "16")}"`))
        expect(html).toMatch(/<div class="ui-band-fields"><span class="ui-control"><input[^>]*name="lateness\.bands\.0"[^>]*\/><\/span><span class="ui-control"><select/)
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-band-fields > \.ui-control,\s*\.ui-band-fields > \.ui-band-open \{\s*flex: 1 1 0;\s*min-width: 0;/)
    })
})

describe("the focus on the first field that's wrong", () => {
    it("goes to the control marked wrong, not the first button in its field, such as a band's Remove", async () => {
        const { focusFirstWrong } = await import("@/components/attendance-calendar/focus")
        const focused: string[] = []
        const control = (name: string, invalid = false) => ({ name, invalid, focus: () => focused.push(name) })
        const field = (controls: ReturnType<typeof control>[], wrong: boolean) => ({
            querySelector: (sel: string) => sel === ":scope > .ui-error" ? (wrong ? {} : null)
                : sel === '[aria-invalid="true"]' ? controls.find(c => c.invalid) ?? null
                    : controls[0] ?? null,
        })
        const form = { querySelectorAll: () => [field([control("grace")], false), field([control("remove"), control("end", true)], true)] }
        vi.stubGlobal("requestAnimationFrame", (run: () => void) => run())
        try {
            focusFirstWrong(form as never)
        } finally {
            vi.unstubAllGlobals()
        }
        expect(focused).toEqual(["end"])
    })
})

describe("found by Codex on #163", () => {
    it("takes every number the policy itself takes, so a saved policy saves again unchanged", async () => {
        // A grace or an overtime minimum over 240 minutes is a policy the server takes (up to a day),
        // which the dialog refused, so it couldn't be saved again without changing it.
        const { bodyFromForm, formFromBody } = await import("@/components/attendance-policy/policy-form")
        const { policyBodySchema } = await import("@/lib/attendance/policy")
        const long = {
            ...STANDARD_OFFICE,
            lateness: { ...STANDARD_OFFICE.lateness, graceMinutes: 300, bands: [{ fromMinutes: 301, toMinutes: null, dayFraction: 1 }] },
            overtime: { ...STANDARD_OFFICE.overtime, minimumMinutes: 300 },
        }
        expect(policyBodySchema.safeParse(long).success).toBe(true)
        expect(bodyFromForm(formFromBody(long), long)).toEqual({ ok: true, body: long })
        // Past a day is still said to be wrong.
        const form = formFromBody(long)
        form.overtime.minimumMinutes = "1441"
        const result = bodyFromForm(form, long)
        expect(result.ok ? {} : result.errors).toEqual({ "overtime.minimumMinutes": { key: "number_whole_between", min: 0, max: 1440 } })
    })
})

describe("scans close together count as one (ATTENDANCE_PLAN.md §6.9, round 10, decision 8, PR 273)", () => {
    it("is 5 minutes to start, anything from 1 to 60, and a version saved before it reads as 5", async () => {
        const { policyBodySchema, DEFAULT_SCAN_WINDOW_MINUTES } = await import("@/lib/attendance/policy")
        expect(DEFAULT_SCAN_WINDOW_MINUTES).toBe(5)
        for (const body of [STANDARD_OFFICE, SIX_DAY_FACTORY, MEASURE_ONLY]) expect(body.scanWindowMinutes).toBe(5)
        // A version saved before the window: the same body without it.
        const saved: Record<string, unknown> = { ...STANDARD_OFFICE }
        delete saved.scanWindowMinutes
        expect(policyBodySchema.parse(saved).scanWindowMinutes).toBe(5)
        for (const minutes of [1, 60]) expect(policyBodySchema.safeParse({ ...STANDARD_OFFICE, scanWindowMinutes: minutes }).success).toBe(true)
        for (const minutes of [0, 61, 2.5]) expect(policyBodySchema.safeParse({ ...STANDARD_OFFICE, scanWindowMinutes: minutes }).success, String(minutes)).toBe(false)
    })

    it("says it on the policy card, with how a day is read", async () => {
        const html = await card()
        expect(html).toContain(`<dt>${en.attendance_scans}</dt>`)
        expect(html).toContain(esc(en.attendance_scans_line.replace("{minutes}", "5 minutes")))
        const arabic = await card({ locale: "ar" })
        expect(arabic).toContain(`<dt>${ar.attendance_scans}</dt>`)
        expect(arabic).toContain(ar.attendance_scans_line.replace("{minutes}", "٥ دقائق"))
    })

    it("is changed in the dialog, a whole number of minutes under its own label, said wrong under it outside 1 to 60", async () => {
        const html = await dialog()
        expect(html).toContain(esc(en.attendance_scan_window))
        expect(html).toContain(esc(en.attendance_scan_window_hint))
        expect(html).toMatch(/<input[^>]*name="scanWindowMinutes"[^>]*value="5"/)
        const { bodyFromForm, formFromBody } = await import("@/components/attendance-policy/policy-form")
        const form = formFromBody(STANDARD_OFFICE)
        expect(form.scanWindowMinutes).toBe("5")
        for (const typed of ["0", "61", "", "2.5"]) {
            const result = bodyFromForm({ ...form, scanWindowMinutes: typed }, STANDARD_OFFICE)
            expect(result.ok ? {} : result.errors, typed).toEqual({ scanWindowMinutes: { key: "number_whole_between", min: 1, max: 60 } })
        }
        expect(bodyFromForm({ ...form, scanWindowMinutes: "10" }, STANDARD_OFFICE)).toMatchObject({ ok: true, body: { scanWindowMinutes: 10 } })
        for (const key of ["attendance_scans", "attendance_scans_line", "attendance_scan_window", "attendance_scan_window_hint"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
    })
})
