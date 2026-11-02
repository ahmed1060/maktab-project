import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { MODULES, MODULE_KEYS } from "./modules"

/**
 * Company settings on the building blocks, part 4a (UI_PLAN.md §5 step 5):
 * two of the Super Admin's own tabs, Admin access (whether a company's own
 * people see its settings, and which tabs) and Modules (what the company
 * calls each module, and its icon).
 */

const state = { locale: "en" as "en" | "ar" }

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
    usePathname: () => "/dashboard/companies/c1/settings",
    useSearchParams: () => new URLSearchParams("tab=modules"),
}))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")

function render(element: Parameters<typeof renderToStaticMarkup>[0], locale: "en" | "ar" = "en") {
    state.locale = locale
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(element)
    } finally {
        vi.unstubAllGlobals()
    }
}

const access = async (props: Partial<{ enabled: boolean; tabs: string[] }> = {}) => {
    const { default: Card } = await import("@/components/CompanySettingsAccessCard")
    return render(h(Card, { companyId: "c1", enabled: true, tabs: ["general", "payroll"], onSaved: () => {}, ...props }))
}
const modules = async (props: Partial<{ moduleLabels: unknown; moduleIcons: unknown }> = {}, locale: "en" | "ar" = "en") => {
    const { default: Card } = await import("@/components/CompanyModulesCard")
    return render(h(Card, { companyId: "c1", moduleLabels: { clients: "Vendors" }, moduleIcons: { clients: "🚚" }, onSaved: () => {}, ...props }), locale)
}

describe("the Admin access tab", () => {
    it("is a card with the switch, its hint under it, and the tabs as checkboxes in a group of their own", async () => {
        const html = await access()
        expect(html).toContain(`<h2 class="ui-card-title">${en.settings_tab_access}</h2>`)
        expect(html).toMatch(new RegExp(`<label class="ui-choice"><input type="checkbox" class="ui-check" aria-describedby="([^"]+)" name="adminSettingsEnabled" checked=""/>${esc(en.admin_settings_label)}</label><span id="\\1" class="ui-hint ui-choice-hint">`))
        expect(html).toContain(`<legend class="ui-label">${en.admin_settings_tabs_label}</legend>`)
        for (const [key, label] of [["general", en.settings_tab_general], ["branding", en.settings_tab_branding], ["payroll", en.settings_tab_payroll], ["attendance", en.settings_tab_attendance]]) {
            expect(html, key).toMatch(new RegExp(`<label class="ui-choice"><input type="checkbox" class="ui-check" name="tab-${key}"[^>]*/>${label}</label>`))
        }
        // The Super Admin's own tabs are never offered.
        for (const key of ["roles", "modules", "access"]) expect(html, key).not.toContain(`name="tab-${key}"`)
        expect(html).toMatch(/name="tab-general" checked=""/)
        expect(html).not.toMatch(/name="tab-branding" checked=""/)
        expect(html).toContain(esc(en.admin_settings_never_shown))
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary"[^>]*disabled=""[^>]*>${en.save}</button>`))
    })

    it("greys the tabs while the switch is off", async () => {
        const off = await access({ enabled: false })
        expect(off).toMatch(/<fieldset class="ui-field ui-fieldset"[^>]* disabled="">/)
        expect(await access()).not.toMatch(/<fieldset[^>]* disabled="">/)
    })
})

describe("the Modules tab", () => {
    it("is a card with a field for each module, named for the module, and its icon a button that says what it does", async () => {
        const html = await modules()
        expect(html).toContain(`<h2 class="ui-card-title">${en.module_names_setting}</h2>`)
        expect(html).toContain(`<p class="ui-card-note">${esc(en.module_names_setting_hint)}</p>`)
        for (const key of MODULE_KEYS) {
            const name = en[MODULES[key].labelKey as keyof typeof en]
            expect(html, key).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${name}</label>`))
            expect(html, key).toContain(`aria-label="${esc(en.module_icon_choose_for.replace("{name}", name))}"`)
            expect(html, key).toMatch(new RegExp(`<input[^>]*name="label-${key}"`))
        }
        // The company's own name and icon, where it has them; the default icon otherwise.
        expect(html).toMatch(/<input[^>]*name="label-clients"[^>]*value="Vendors"/)
        expect(html).toMatch(new RegExp(`aria-label="${esc(en.module_icon_choose_for.replace("{name}", en.clients))}"[^>]*>🚚</button>`))
        expect(html).toMatch(new RegExp(`aria-label="${esc(en.module_icon_choose_for.replace("{name}", en.tasks))}"[^>]*>${MODULES.tasks.icon}</button>`))
    })

    it("shows the side bar as it would be, on the side bar's own ground, its icons hidden from screen readers", async () => {
        const html = await modules()
        expect(html).toContain(`<p class="ui-label">${en.module_names_preview}</p>`)
        expect(html).toContain('<div class="ui-sidebar-preview">')
        expect(html).toContain(`<span class="ui-sidebar-preview-item"><span aria-hidden="true">🚚</span><bdi>Vendors</bdi></span>`)
        expect(html).toContain(`<p class="ui-sidebar-preview-group">${en.nav_group_work}</p>`)
    })

    it("has Reset all and Save as the building blocks' buttons, Save off until something changes", async () => {
        const html = await modules()
        expect(html).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-secondary"[^>]*>${en.module_reset_all}</button>`))
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary"[^>]*disabled=""[^>]*>${en.save}</button>`))
        // Nothing to reset: Reset all is off too.
        expect(await modules({ moduleLabels: null, moduleIcons: null })).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-secondary"[^>]*disabled=""[^>]*>${en.module_reset_all}</button>`))
    })

    it("picks an icon in the building blocks' dialog: the palette, any emoji pasted, and the default", async () => {
        const { IconDialog } = await import("@/components/CompanyModulesCard")
        const html = render(h(IconDialog, { name: "Clients", current: "🚚", fallback: "🤝", onPick: () => {}, onClose: () => {} }))
        expect(html).toContain('role="dialog"')
        expect(html).toContain(`class="ui-dialog-title">${en.module_icon_title.replace("{name}", "Clients")}</h2>`)
        expect(html).toContain('<div class="ui-emoji-grid">')
        // The one in use is marked as chosen.
        expect(html).toMatch(/<button type="button" class="ui-emoji" aria-pressed="true">🚚<\/button>/)
        expect(html).toMatch(/<button type="button" class="ui-emoji" aria-pressed="false">📊<\/button>/)
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.module_icon_custom}</label>`))
        expect(html).toContain(`${en.module_icon_reset} (🤝)</button>`)
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary"[^>]*>${en.module_icon_use}</button>`))
    })

    it("says what's wrong with a pasted icon under its field", async () => {
        const { iconError } = await import("@/components/CompanyModulesCard")
        expect(iconError("")).toBe("module_icon_required")
        expect(iconError("  ")).toBe("module_icon_required")
        expect(iconError("abc")).toBe("module_icon_invalid")
        expect(iconError("🚚")).toBeNull()
    })

    it("reads in Arabic", async () => {
        const html = await modules({}, "ar")
        expect(html).toContain(`<h2 class="ui-card-title">${ar.module_names_setting}</h2>`)
        expect(html).toContain(`aria-label="${esc(ar.module_icon_choose_for.replace("{name}", ar.clients))}"`)
    })
})

describe("nothing of the old cards is left", () => {
    it("has no inline styles, glass panels or old buttons", () => {
        for (const file of ["components/CompanySettingsAccessCard.tsx", "components/CompanyModulesCard.tsx"]) {
            const source = readFileSync(file, "utf8")
            expect(source, file).not.toContain("style={")
            expect(source, file).not.toContain('"glass')
            expect(source, file).not.toMatch(/className="btn/)
            expect(source, file).not.toContain("isRtl")
        }
    })

    it("keeps asking before edits are left unsaved", () => {
        expect(readFileSync("components/CompanyModulesCard.tsx", "utf8")).toContain("useReportUnsaved('modules', isDirty)")
        expect(readFileSync("components/CompanySettingsAccessCard.tsx", "utf8")).toContain("useReportUnsaved('access', dirty)")
    })
})

describe("found in the browser and the audit (company settings part 4a)", () => {
    it("marks the icon in use in the dialog, the module's own among them, and picking that one sets nothing", async () => {
        // With no icon of its own chosen, nothing in the palette was marked.
        expect(readFileSync("components/CompanyModulesCard.tsx", "utf8")).toContain("current={icons[pickerFor] || MODULES[pickerFor].icon}")
        const { overrideFor } = await import("@/components/CompanyModulesCard")
        expect(overrideFor("clients", MODULES.clients.icon)).toBeNull()
        expect(overrideFor("clients", null)).toBeNull()
        expect(overrideFor("clients", "🏗️")).toBe("🏗️")
    })

    it("offers the module's own icon beside the palette, leaving the dialog's buttons to Cancel and Use this emoji", async () => {
        // In the dialog's buttons it pushed Use this emoji onto a line of its own.
        const { IconDialog } = await import("@/components/CompanyModulesCard")
        const html = render(h(IconDialog, { name: "Clients", current: "🚚", fallback: "🤝", onPick: () => {}, onClose: () => {} }))
        expect(html).toMatch(new RegExp(`<div class="ui-emoji-grid">[^]*?</div><p><button type="button" class="ui-btn ui-btn-secondary"[^>]*>${en.module_icon_reset} \\(🤝\\)</button></p><form`))
        expect(html).toMatch(new RegExp(`<div class="ui-dialog-actions"><button type="button" class="ui-btn ui-btn-secondary"[^>]*>${en.cancel}</button><button type="submit" class="ui-btn ui-btn-primary"[^>]*>${en.module_icon_use}</button></div>`))
    })

    it("says what to do when a pasted icon isn't an emoji", () => {
        expect(en.module_icon_invalid).toMatch(/pick one above/)
        expect(ar.module_icon_invalid).toMatch(/اختر واحدًا من الأعلى/)
    })

    it("ties the line saying which tabs stay the Super Admin's to the tabs it's about", async () => {
        const html = await access()
        expect(html).toMatch(new RegExp(`<fieldset class="ui-field ui-fieldset" aria-describedby="([^"]+)">[^]*<span id="\\1" class="ui-hint">${esc(en.admin_settings_never_shown)}</span></fieldset>`))
    })
})
