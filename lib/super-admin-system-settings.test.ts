import { beforeAll, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The Super Admin's pages on the building blocks, Operations part 4a
 * (UI_PLAN.md §5 step 5): System settings' page and its four forms. The face
 * checks switch follows in part 4b; the brand colour card was moved with the
 * company's Branding tab (company settings part 2).
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    viewer: { id: "sa1", role: "SUPER_ADMIN" } as Record<string, unknown> | null,
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
}

vi.mock("@/lib/useCan", () => ({ useViewer: () => state.viewer, useCan: () => ({ can: () => true }) }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/dashboard/system-settings", useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/HeaderContext", () => ({ useHeader: () => ({ setTitle: () => {}, setSubtitle: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
// Their own requests, and their own tests: the face switch is part 4b's, the brand colour card company settings part 2's.
vi.mock("@/components/FaceSystemSwitch", () => ({ default: () => h("div", { "data-card": "face" }) }))
vi.mock("@/components/BrandColourCard", () => ({ default: (p: { saved: string }) => h("div", { "data-card": "brand", "data-saved": p.saved }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        const loaded: Loaded = key ? state.swr[key] ?? {} : {}
        return { data: undefined, error: undefined, isValidating: false, mutate: async () => {}, ...loaded }
    },
}))

const PAGE = "app/(dashboard)/dashboard/system-settings/page.tsx"
const CARDS = "components/SystemSettingsCards.tsx"
const SETTINGS = "/api/system-settings"
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
/** As HTML has it, and as a regular expression matches it literally. */
const lit = (s: string) => esc(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const section = (html: string, title: string) => {
    const at = html.indexOf(`<h2 class="ui-section-title">${esc(title)}</h2>`)
    if (at < 0) return ""
    const next = html.indexOf('<section class="ui-section">', at)
    return html.slice(at, next < 0 ? undefined : next)
}
const card = (html: string, title: string) => {
    const at = html.indexOf(`<h2 class="ui-card-title">${esc(title)}</h2>`)
    if (at < 0) return ""
    const start = html.lastIndexOf("<section", at)
    return html.slice(start, html.indexOf("</section>", at))
}
const stored = (s: Record<string, unknown> = {}) => ({ data: { success: true, data: {
    id: "1", locationVerifyRadiusMeters: 150, showPoweredBy: true, poweredByName: "SHSD", defaultTimezone: "Africa/Cairo",
    stepUpMinutes: 60, brandColour: "#4f46e5", maintenanceMode: false, maintenanceMessage: null, updatedAt: "2026-11-01T00:00:00Z", ...s,
} } })

async function render(swr: Record<string, Loaded>, options: { locale?: "en" | "ar"; viewer?: Record<string, unknown> | null } = {}) {
    Object.assign(state, { swr, keys: [], locale: options.locale ?? "en" })
    state.viewer = options.viewer === undefined ? { id: "sa1", role: "SUPER_ADMIN" } : options.viewer
    const { default: Page } = await import("@/app/(dashboard)/dashboard/system-settings/page")
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(Page))
    } finally {
        vi.unstubAllGlobals()
    }
}

beforeAll(async () => {
    await import("@/app/(dashboard)/dashboard/system-settings/page")
}, 120000)

describe("the System settings page", () => {
    it("has the page header, its name in sentence case, and leaves the old top bar's title alone", async () => {
        const html = await render({ [SETTINGS]: stored() })
        expect(en.system_settings).toBe("System settings")
        expect(html).toContain(`<h1 class="ui-page-title">${en.system_settings}</h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${esc(en.system_settings_subtitle)}</p>`)
        expect(readFileSync(PAGE, "utf8")).not.toContain("useHeader")
    })

    it("is the Super Admin's only, and asks the server nothing for anyone else", async () => {
        // It asked for the settings for whoever opened its address.
        const html = await render({ [SETTINGS]: stored() }, { viewer: { id: "a1", role: "ADMIN", companyId: "c1" } })
        // It says so, in place of the page (lib/access-denied-page.test.ts).
        expect(html).toContain(en.access_denied_super_admins)
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("puts its cards in three sections: defaults, security and branding", async () => {
        const html = await render({ [SETTINGS]: stored() })
        const titles = [...html.matchAll(/<h2 class="ui-section-title">([^<]+)<\/h2>/g)].map(m => m[1])
        expect(titles).toEqual([en.sys_section_defaults, en.sys_section_security, en.branding_settings].map(esc))
        const defaults = section(html, en.sys_section_defaults)
        expect(defaults).toContain(`<h2 class="ui-card-title">${esc(en.location_verification_settings)}</h2>`)
        expect(defaults).toContain(`<h2 class="ui-card-title">${esc(en.default_timezone_label)}</h2>`)
        const security = section(html, en.sys_section_security)
        expect(security).toContain(`<h2 class="ui-card-title">${esc(en.step_up_minutes_label)}</h2>`)
        expect(security).toContain('data-card="face"')
        const branding = section(html, en.branding_settings)
        expect(branding).toContain(`<h2 class="ui-card-title">${esc(en.sys_signature_title)}</h2>`)
        expect(branding).toContain('data-card="brand" data-saved="#4f46e5"')
    })

    it("takes the auto-verify distance as a number with its label, its range, and Save off until it's changed", async () => {
        const html = card(await render({ [SETTINGS]: stored() }), en.location_verification_settings)
        expect(html).toContain(esc(en.location_verify_radius_hint))
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${lit(en.location_verify_radius_label)}</label>`))
        expect(html).toMatch(/<input(?=[^>]*name="locationVerifyRadiusMeters")(?=[^>]*type="number")(?=[^>]*inputMode="numeric")(?=[^>]*value="150")[^>]*>/)
        expect(html).toContain(esc(en.sys_range_meters.replace("{min}", "1").replace("{max}", "10,000")))
        expect(html).toMatch(new RegExp(`<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>${esc(en.save)}</button>`))
    })

    it("picks the default calendar from the same zones as a company's, keeping a stored one that isn't among them", async () => {
        const html = card(await render({ [SETTINGS]: stored() }), en.default_timezone_label)
        expect(html).toContain(esc(en.default_timezone_hint))
        expect(html).toMatch(/<select(?=[^>]*name="defaultTimezone")(?=[^>]*translate="no")[^>]*>/)
        expect(html).toContain('<option value="Africa/Cairo" selected="">Africa/Cairo</option>')
        expect(html).toContain('<option value="Europe/London">Europe/London</option>')
        const other = card(await render({ [SETTINGS]: stored({ defaultTimezone: "Pacific/Auckland" }) }), en.default_timezone_label)
        expect(other).toContain('<option value="Pacific/Auckland" selected="">Pacific/Auckland</option>')
    })

    it("takes the high-risk confirmation's minutes as a number with its range", async () => {
        const html = card(await render({ [SETTINGS]: stored() }), en.step_up_minutes_label)
        expect(html).toContain(esc(en.step_up_minutes_hint))
        expect(html).toMatch(/<input(?=[^>]*name="stepUpMinutes")(?=[^>]*type="number")(?=[^>]*value="60")[^>]*>/)
        expect(html).toContain(esc(en.sys_range_minutes.replace("{min}", "5").replace("{max}", "480")))
    })

    it("shows the signature switch, its name, and what it will look like before it's saved", async () => {
        const on = card(await render({ [SETTINGS]: stored({ poweredByName: "Nizmo" }) }), en.sys_signature_title)
        expect(on).toContain(esc(en.powered_by_hint))
        expect(on).toMatch(/<input(?=[^>]*type="checkbox")(?=[^>]*class="ui-check")(?=[^>]*name="showPoweredBy")(?=[^>]*checked="")[^>]*>/)
        expect(on).toContain(esc(en.show_powered_by_label))
        expect(on).toMatch(/<input(?=[^>]*name="poweredByName")(?=[^>]*maxLength="40")(?=[^>]*value="Nizmo")(?![^>]*disabled)[^>]*>/)
        expect(on).toContain(`<figcaption class="ui-hint">${en.sys_signature_preview}</figcaption>`)
        expect(on).toContain(`<span class="ui-signature-by">${en.powered_by}</span><span class="ui-signature-name" translate="no">Nizmo</span>`)
        const off = card(await render({ [SETTINGS]: stored({ showPoweredBy: false }) }), en.sys_signature_title)
        // Off, the name is kept and shown, only not to be changed: it isn't lost.
        expect(off).toMatch(/<input(?=[^>]*name="poweredByName")(?=[^>]*disabled="")[^>]*>/)
        expect(off).toContain(esc(en.powered_by_hidden))
    })

    it("writes the ranges in the language's digits", async () => {
        const html = await render({ [SETTINGS]: stored() }, { locale: "ar" })
        expect(html).toContain(ar.sys_range_meters.replace("{min}", "١").replace("{max}", "١٠٬٠٠٠"))
        expect(html).toContain(ar.sys_range_minutes.replace("{min}", "٥").replace("{max}", "٤٨٠"))
    })

    it("says while it loads, and when it didn't, with the server's reason and Try again, where it showed empty forms", async () => {
        const loading = await render({})
        expect(loading).toContain('role="status"')
        expect(loading).toContain(en.loading)
        expect(loading).not.toContain("ui-card-title")
        const failed = await render({ [SETTINGS]: { error: Object.assign(new Error("x"), { status: 500, info: { error: "Database unavailable" } }) } })
        expect(failed).toContain(`<p class="ui-empty-title">${esc(en.sys_load_failed)}</p>`)
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(`>${en.try_again}</button>`)
        expect(failed).not.toContain("ui-card-title")
    })

    it("asks before leaving edits that aren't saved, as company settings does", () => {
        const page = readFileSync(PAGE, "utf8")
        expect(page).toContain("<UnsavedChangesProvider")
        expect(page).toContain("useGuardLinks(dirty,")
        expect(page).toContain("t('settings_unsaved_title')")
        // Each card says when it holds edits: the two numbers, the calendar and the signature.
        const cards = readFileSync(CARDS, "utf8")
        for (const report of ["useReportUnsaved(field, dirty)", "useReportUnsaved('defaultTimezone', dirty)", "useReportUnsaved('signature', dirty)"]) expect(cards).toContain(report)
    })

    it("leaves its styles typed in and its untyped labels behind", () => {
        for (const file of [PAGE, CARDS]) {
            const src = readFileSync(file, "utf8")
            for (const old of ["style={", "className=\"glass", "fetchRetrying", "className=\"btn", "input-field", "|| 'Settings saved'"]) expect(src, `${file}: ${old}`).not.toContain(old)
            expect(src, file).not.toMatch(/\bas any\b/)
        }
    })
})

describe("System settings' checks", () => {
    it("says which numbers are wrong before anything is sent", async () => {
        const { settingsErrors } = await import("@/components/SystemSettingsCards")
        expect(settingsErrors({ locationVerifyRadiusMeters: "150", stepUpMinutes: "60" })).toEqual({})
        for (const radius of ["", "0", "10001", "1.5", "abc", "-3"]) expect(settingsErrors({ locationVerifyRadiusMeters: radius }), radius).toEqual({ locationVerifyRadiusMeters: "invalid_radius_value" })
        for (const minutes of ["", "4", "481", "7.5"]) expect(settingsErrors({ stepUpMinutes: minutes }), minutes).toEqual({ stepUpMinutes: "step_up_minutes_invalid" })
    })

    it("shares the company's shortlist of zones, from one place", () => {
        expect(readFileSync(CARDS, "utf8")).toContain("ZONE_SHORTLIST")
        expect(readFileSync("components/CompanyPayrollCard.tsx", "utf8")).toContain("ZONE_SHORTLIST")
        expect(readFileSync("components/CompanyPayrollCard.tsx", "utf8")).not.toContain("const ZONES = [")
    })
})

describe("System settings, found in the browser", () => {
    it("says a number is wrong with its range in the language's digits, as the hint above it does", async () => {
        // "أدخل مسافة بين 1 و10000 متر": Western digits in Arabic, and 10000 where the hint said 10,000.
        for (const key of ["invalid_radius_value", "step_up_minutes_invalid"] as const) {
            for (const dict of [en, ar]) {
                expect(dict[key], key).toContain("{min}")
                expect(dict[key], key).toContain("{max}")
                expect(dict[key], key).not.toMatch(/\d/)
            }
        }
        expect(readFileSync(CARDS, "utf8")).toContain("setError(t(wrong).replace('{min}', num(min)).replace('{max}', num(max)))")
    })
})

describe("System settings, found in the web interface audit", () => {
    it("quotes “Powered by” with the language's own marks, as the card's title does", () => {
        // Straight quotes, "Powered by", where the title beside it has “Powered by”.
        expect(en.show_powered_by_label).toBe("Show the “Powered by” signature")
        expect(ar.show_powered_by_label).toBe("إظهار توقيع «بدعم من»")
        for (const dict of [en, ar]) expect(dict.show_powered_by_label).not.toContain('"')
    })

    it("says why the name can't be changed while the signature is off (DESIGN.md §5.3)", async () => {
        // It said how many characters were used, of a field nobody could type in.
        const off = card(await render({ [SETTINGS]: stored({ showPoweredBy: false }) }), en.sys_signature_title)
        expect(off).toMatch(new RegExp(`<span id="[^"]+" class="ui-hint">${lit(en.sys_signature_name_off)}</span>`))
        expect(off).not.toContain(esc(en.ui_characters_used.replace("{used}", "4").replace("{max}", "40")))
        const on = card(await render({ [SETTINGS]: stored({ poweredByName: "Nizmo" }) }), en.sys_signature_title)
        expect(on).toContain(esc(en.ui_characters_used.replace("{used}", "5").replace("{max}", "40")))
        expect(on).not.toContain(esc(en.sys_signature_name_off))
        expect(ar.sys_signature_name_off).toBeTruthy()
    })

    it("leaves the brand name to itself: no spelling marks, and no page translator", async () => {
        const on = card(await render({ [SETTINGS]: stored({ poweredByName: "Nizmo" }) }), en.sys_signature_title)
        expect(on).toMatch(/<input(?=[^>]*name="poweredByName")(?=[^>]*spellCheck="false")(?=[^>]*translate="no")[^>]*>/)
        expect(on).toContain('<span class="ui-signature-name" translate="no">Nizmo</span>')
    })
})

describe("System settings, found in Codex's review", () => {
    it("keeps what was typed while a save was on its way", async () => {
        // 200 saved, 300 typed before the answer came: the answer put back
        // 200, Save went off and the 300 was lost, the leave guard with it.
        const { afterSave } = await import("@/components/SystemSettingsCards")
        expect(afterSave("300", "200", "200")).toBe("300")
        expect(afterSave("200", "200", "200")).toBe("200")
        // What was saved, 50 where "050" was typed, when nothing was typed since.
        expect(afterSave("050", "050", "50")).toBe("50")
        const cards = readFileSync(CARDS, "utf8")
        expect(cards).toContain("if (next) setText(current => afterSave(current, sent, String(next[field])))")
        expect(cards).toContain("if (next) setName(current => afterSave(current, sent, next.poweredByName ?? ''))")
        expect(cards).not.toContain("setText(String(next[field]))")
        expect(cards).not.toContain("setName(next.poweredByName ?? '')")
    })

    it("follows a newer stored value in a field nobody touched, and leaves an edit alone", async () => {
        // Another Super Admin set the distance to 90 and this one saved the
        // calendar: the untouched distance still said 70, with Save on, and
        // saving it would have put 70 back over the 90.
        const { followStored } = await import("@/components/SystemSettingsCards")
        const whole = (text: string, n: number) => /^\d+$/.test(text.trim()) && Number(text.trim()) === n
        expect(followStored("70", 70, 90, whole, String)).toBe("90")
        expect(followStored("070", 70, 90, whole, String)).toBe("90")
        expect(followStored("300", 70, 90, whole, String)).toBe("300")
        // Emptied on the way to another number is an edit too.
        expect(followStored("", 70, 90, whole, String)).toBe("")
        const same = (a: string, b: string) => a === b
        const itself = (s: string) => s
        expect(followStored("Africa/Cairo", "Africa/Cairo", "Europe/London", same, itself)).toBe("Europe/London")
        expect(followStored("Asia/Dubai", "Africa/Cairo", "Europe/London", same, itself)).toBe("Asia/Dubai")
    })

    it("has every field follow its stored value", () => {
        const cards = readFileSync(CARDS, "utf8")
        for (const call of [
            "useFollowStored(saved, text, setText, sameWhole, String)",
            "useFollowStored(stored.defaultTimezone, zone, setZone, same, itself)",
            "useFollowStored(stored.showPoweredBy, shown, setShown, same, itself)",
            "useFollowStored(stored.poweredByName ?? '', name, setName, same, itself)",
        ]) expect(cards, call).toContain(call)
    })
})

describe("System settings, found in Codex's second review", () => {
    it("lets a save's answer change only the fields it sent, then reads the row again", async () => {
        // The distance saved, then the calendar: the calendar's answer came
        // first and the distance's, older, last, and put the calendar back
        // to Cairo with Save off while London was saved.
        const { withSaved } = await import("@/components/SystemSettingsCards")
        const base = { locationVerifyRadiusMeters: 70, defaultTimezone: "Africa/Cairo", stepUpMinutes: 60, showPoweredBy: true, poweredByName: "SHSD", brandColour: "#123456" }
        const afterCalendar = { ...base, locationVerifyRadiusMeters: 200, defaultTimezone: "Europe/London" }
        const olderAnswer = { ...base, locationVerifyRadiusMeters: 200 }
        expect(withSaved(afterCalendar, { locationVerifyRadiusMeters: 200 }, olderAnswer)).toEqual(afterCalendar)
        // Its own fields as the server saved them; nobody else's.
        const answer = { ...base, stepUpMinutes: 45, defaultTimezone: "Asia/Dubai" }
        expect(withSaved(base, { stepUpMinutes: 45 }, answer)).toEqual({ ...base, stepUpMinutes: 45 })
        const page = readFileSync(PAGE, "utf8")
        expect(page).toContain("mutate(current => current?.success ? { ...current, data: withSaved(current.data, sent, next) } : current, { revalidate: true })")
        expect(page).not.toContain("mutate({ success: true, data: next }, { revalidate: false })")
        expect(page).toContain("saved(result.data, { brandColour })")
        expect(readFileSync(CARDS, "utf8")).toContain("onSaved(result.data, patch)")
    })
})

describe("System settings, found in Codex's third review", () => {
    it("holds each card's fields still while its save is on its way", () => {
        // 70 stored, 200 sent, 70 typed again before the answer: 70 looked
        // untouched, the answer's 200 replaced it, and Save went off. Told
        // apart by value, an edit back to what was stored can't be seen.
        const cards = readFileSync(CARDS, "utf8")
        for (const control of [
            'name={field} type="number" inputMode="numeric" min={min} max={max} autoComplete="off" readOnly={saving}',
            'name="defaultTimezone" translate="no" disabled={saving}',
            'name="showPoweredBy" checked={shown} disabled={saving}',
            'name="poweredByName" dir="auto" maxLength={NAME_MAX} autoComplete="off" spellCheck={false} translate="no" readOnly={saving}',
        ]) expect(cards, control).toContain(control)
    })
})
