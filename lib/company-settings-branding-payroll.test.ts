import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { MAX_PAYROLL_DAY } from "./payday"

/**
 * Company settings on the building blocks, part 2 (UI_PLAN.md §5 step 5):
 * the Branding tab's logo card and the Payroll tab's card. The brand colour
 * card beside the logo was built on them already.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))

const esc = (s: string) => s.replace(/'/g, "&#x27;")

async function logo(props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") {
    state.locale = locale
    const { default: Card } = await import("@/components/CompanyLogoCard")
    return renderToStaticMarkup(h(Card, { companyId: "c1", companyName: "Delta Sites", logoUrl: null, onChanged: () => {}, ...props } as never))
}
async function payroll(props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") {
    state.locale = locale
    const { default: Card } = await import("@/components/CompanyPayrollCard")
    return renderToStaticMarkup(h(Card, {
        companyId: "c1", payrollDay: 25, payslipsVisible: false, timezone: "Africa/Cairo", debtRecoveryPercent: 25,
        onSaved: () => {}, ...props,
    } as never))
}

describe("the logo card", () => {
    it("is a card that says what the logo is for and which files it takes", async () => {
        const html = await logo()
        expect(html).toContain(`<h2 class="ui-card-title">${en.company_logo_setting}</h2>`)
        expect(html).toContain(`<p class="ui-card-note">${esc(en.company_logo_setting_hint)}</p>`)
    })

    it("shows the logo as the side bar will, beside the company's name", async () => {
        const html = await logo({ logoUrl: "https://files.test/logo.png" })
        expect(html).toContain(`<p class="ui-label">${en.company_logo_preview}</p>`)
        expect(html).toMatch(/<div class="ui-logo-preview">[\s\S]*<img src="https:\/\/files.test\/logo.png" alt=""[^>]*class="ui-logo-plate"\/>[\s\S]*<bdi>Delta Sites<\/bdi>/)
        expect(html).toContain(esc(en.company_logo_plate_note))
    })

    it("offers Replace and Remove for a logo, and Upload a logo without one", async () => {
        const has = await logo({ logoUrl: "https://files.test/logo.png" })
        expect(has).toMatch(new RegExp(`<div class="ui-card-actions">[\\s\\S]*ui-btn-secondary[^>]*>${en.company_logo_remove}</button>[\\s\\S]*ui-btn-primary[^>]*>${en.company_logo_replace}</button>`))
        const none = await logo()
        expect(none).toContain(en.company_logo_none)
        expect(none).toMatch(new RegExp(`ui-btn-primary[^>]*>${en.company_logo_upload}</button>`))
        expect(none).not.toContain(`>${en.company_logo_remove}</button>`)
    })

    it("shows the logo without its buttons to whoever can only look", async () => {
        const html = await logo({ logoUrl: "https://files.test/logo.png", readOnly: true })
        expect(html).toContain("ui-logo-plate")
        expect(html).not.toContain("</button>")
    })

    it("is in the page's language", async () => {
        const html = await logo({}, "ar")
        expect(html).toContain(ar.company_logo_setting)
        expect(html).toContain(ar.company_logo_upload)
    })
})

describe("the payroll card", () => {
    it("is a card with a label over each field, and its hint under it", async () => {
        const html = await payroll()
        expect(html).toContain(`<h2 class="ui-card-title">${en.payroll_policy}</h2>`)
        expect(html).toContain(`<p class="ui-card-note">${esc(en.payroll_policy_hint)}</p>`)
        for (const label of [en.payroll_day_label, en.company_timezone_label, en.debt_recovery_percent_label]) {
            expect(html, label).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${esc(label).replace(/[()]/g, "\\$&")}</label>`))
        }
        expect(html).toContain(en.payroll_day_hint.replace("{max}", String(MAX_PAYROLL_DAY)))
        expect(html).toContain(en.company_timezone_hint)
        expect(html).toContain(esc(en.debt_recovery_hint_capped.replace("{n}", "25")))
    })

    it("picks the calendar from a select, keeping a stored zone that's not on the list", async () => {
        const html = await payroll({ timezone: "Pacific/Auckland" })
        expect(html).toMatch(/<select id="[^"]+"[^>]*class="ui-select"/)
        expect(html).toContain('<option value="Pacific/Auckland" selected="">Pacific/Auckland</option>')
        expect(html).toContain('<option value="Africa/Cairo">Africa/Cairo</option>')
    })

    it("asks about payslips with a checkbox whose hint is read with it", async () => {
        const html = await payroll()
        const box = html.match(/<input type="checkbox" class="ui-check" aria-describedby="([^"]+)"/)
        expect(box).not.toBeNull()
        expect(html).toContain(`<span id="${box![1]}" class="ui-hint ui-choice-hint">${en.payslips_visible_hint}</span>`)
        expect(html).toMatch(new RegExp(`<label class="ui-choice">[\\s\\S]*${en.payslips_visible_label}</label>`))
    })

    it("lets the Super Admin set the debt cap, and says to a company it's theirs to set", async () => {
        const sa = await payroll({ debtRecoveryEditable: true })
        expect(sa).not.toContain(en.settings_set_by_super_admin)
        const own = await payroll({ debtRecoveryEditable: false })
        expect(own).toMatch(/<input[^>]*disabled=""[^>]*value="25"/)
        expect(own).toContain(en.settings_set_by_super_admin)
    })

    it("saves with one button on the card's end side, off until something changes", async () => {
        const html = await payroll()
        expect(html).toMatch(new RegExp(`<div class="ui-card-actions"><button type="submit" class="ui-btn ui-btn-primary[^"]*" disabled="">${en.save}</button></div>`))
    })

    it("shows the policy without a Save to whoever can only look", async () => {
        const html = await payroll({ readOnly: true })
        expect(html).not.toContain(`>${en.save}</button>`)
        expect(html).toMatch(/<select[^>]*disabled=""/)
        expect(html).toMatch(/<input type="checkbox"[^>]*disabled=""/)
    })

    it("is in the page's language", async () => {
        const html = await payroll({}, "ar")
        expect(html).toContain(ar.payroll_policy)
        expect(html).toContain(ar.debt_recovery_percent_label)
    })
})

describe("the payroll card's errors", () => {
    it("says under the field what's wrong with a payday or a debt cap before sending it", async () => {
        const { payrollFieldErrors } = await import("@/components/CompanyPayrollCard")
        for (const day of ["", "0", String(MAX_PAYROLL_DAY + 1), "2.5", "-3"]) {
            expect(payrollFieldErrors(day, "25"), day).toEqual({ payrollDay: "payroll_day_invalid" })
        }
        for (const cap of ["", "-1", "101", "12.5"]) {
            expect(payrollFieldErrors("25", cap), cap).toEqual({ debtRecoveryPercent: "debt_recovery_invalid" })
        }
        expect(payrollFieldErrors("1", "0")).toEqual({})
        expect(payrollFieldErrors(String(MAX_PAYROLL_DAY), "100")).toEqual({})
        expect(en.payroll_day_invalid).toContain("{max}")
        expect(ar.payroll_day_invalid).toContain("{max}")
        expect(ar.debt_recovery_invalid).toBeTruthy()
    })

    it("puts the server's reason for a field under that field, and anything else in a message", async () => {
        const { refusalsByField } = await import("@/components/CompanyPayrollCard")
        const zone = "Zones more than 3 hours behind UTC miss the nightly jobs."
        expect(refusalsByField({ error: "Validation Error", details: { timezone: { _errors: [zone] } } })).toEqual({ fields: { timezone: zone } })
        expect(refusalsByField({ error: "Validation Error", details: { payrollDay: { _errors: ["Payroll day must be between 1 and 28."] } } }))
            .toEqual({ fields: { payrollDay: "Payroll day must be between 1 and 28." } })
        expect(refusalsByField({ error: "Forbidden" })).toEqual({ fields: {}, message: "Forbidden" })
        expect(refusalsByField(null)).toEqual({ fields: {} })
    })
})

describe("nothing of the old cards is left", () => {
    it("has no hand-set styles, glass panels or old inputs", () => {
        for (const file of ["components/CompanyLogoCard.tsx", "components/CompanyPayrollCard.tsx"]) {
            const src = readFileSync(file, "utf8")
            for (const old of ["style={", "className=\"glass", "className=\"input\"", "className=\"btn", "isRtl", "|| 'Settings saved'"]) {
                expect(src, `${file}: ${old}`).not.toContain(old)
            }
        }
    })
})

describe("found in the browser and the audit (company settings part 2)", () => {
    it("keeps the calendar's zone clear of its arrow in Arabic, and doesn't let a page translator rename it", async () => {
        // Set left to right, the select started its text under the arrow,
        // which sits on the end side: the left, in Arabic.
        const html = await payroll({}, "ar")
        const select = html.match(/<select[^>]*>/)![0]
        expect(select).not.toContain('dir="ltr"')
        expect(select).toContain('translate="no"')
    })

    it("clears a field's error as soon as the field is changed, as the other forms do", () => {
        const src = readFileSync("components/CompanyPayrollCard.tsx", "utf8")
        for (const field of ["payrollDay", "timezone", "debtRecoveryPercent"]) expect(src, field).toContain(`clear('${field}')`)
    })

    it("asks before removing the logo, which can't be undone", async () => {
        const src = readFileSync("components/CompanyLogoCard.tsx", "utf8")
        expect(src).toMatch(/<Dialog[\s\S]*variant="danger"[\s\S]*company_logo_remove_confirm/)
        // Remove only asks; the dialog's own button removes.
        expect(src).toMatch(/onClick=\{\(\) => setRemoving\(true\)\}[^>]*>\s*\{t\('company_logo_remove'\)\}/)
        expect(src.match(/void handleRemove\(\)/g)).toHaveLength(1)
        expect(src).toMatch(/variant="danger"[^>]*onClick=\{\(\) => \{ void handleRemove\(\) \}\}/)
        for (const key of ["company_logo_remove_title", "company_logo_remove_question", "company_logo_remove_confirm"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
    })

    it("gives the logo's preview its size, so the card doesn't move as it loads", async () => {
        expect(await logo({ logoUrl: "https://files.test/logo.png" })).toMatch(/<img [^>]*width="32" height="32"/)
    })

    it("keeps the browser from offering saved entries for the payday and the debt cap", async () => {
        const html = await payroll()
        for (const name of ["payrollDay", "debtRecoveryPercent"]) {
            expect(html, name).toMatch(new RegExp(`<input[^>]*autoComplete="off"[^>]*name="${name}"`, "i"))
        }
    })
})
