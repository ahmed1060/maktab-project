import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { MODULES, MODULE_ICON_NAMES, MODULE_KEYS } from "./modules"
import { MODULE_ICONS } from "./module-icons"
import { CheckSquareIcon, HandshakeIcon, TruckIcon } from "@phosphor-icons/react/ssr"
import { Icon } from "@/components/ui"

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
/** A side bar icon as the building blocks draw it (DESIGN.md §6). */
const icon = (glyph: typeof CheckSquareIcon, size = 18, weight: "regular" | "fill" = "regular") => renderToStaticMarkup(h(Icon, { icon: glyph, size, weight }))
/** What the button named `label` holds. */
function inside(html: string, label: string): string {
    const at = html.indexOf(`aria-label="${esc(label)}"`)
    expect(at, label).toBeGreaterThan(-1)
    const open = html.indexOf(">", at) + 1
    return html.slice(open, html.indexOf("</button>", open))
}

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
    return render(h(Card, { companyId: "c1", moduleLabels: { clients: "Vendors" }, moduleIcons: { clients: "truck" }, onSaved: () => {}, ...props }), locale)
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
        // The company's own name and icon, where it has them; the side bar's icon otherwise (DESIGN.md §6).
        expect(html).toMatch(/<input[^>]*name="label-clients"[^>]*value="Vendors"/)
        expect(inside(html, en.module_icon_choose_for.replace("{name}", en.clients))).toBe(icon(TruckIcon, 20))
        expect(inside(html, en.module_icon_choose_for.replace("{name}", en.tasks))).toBe(icon(CheckSquareIcon, 20))
    })

    it("shows the side bar as it would be, in its own look, its icons hidden from screen readers", async () => {
        const html = await modules()
        expect(html).toContain(`<p class="ui-label">${en.module_names_preview}</p>`)
        expect(html).toContain('<div class="ui-sidebar-preview">')
        expect(html).toContain(`<span class="ui-sidebar-preview-item">${icon(TruckIcon)}<bdi>Vendors</bdi></span>`)
        expect(html).toContain(`<span class="ui-sidebar-preview-item">${icon(CheckSquareIcon)}<bdi>${en.tasks}</bdi></span>`)
        expect(html).toContain(`<p class="ui-sidebar-preview-group">${en.nav_group_work}</p>`)
    })

    it("has Reset all and Save as the building blocks' buttons, Save off until something changes", async () => {
        const html = await modules()
        expect(html).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-secondary"[^>]*>${en.module_reset_all}</button>`))
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary"[^>]*disabled=""[^>]*>${en.save}</button>`))
        // Nothing to reset: Reset all is off too.
        expect(await modules({ moduleLabels: null, moduleIcons: null })).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-secondary"[^>]*disabled=""[^>]*>${en.module_reset_all}</button>`))
    })

    it("picks an icon in the building blocks' dialog: the 48, each named, the one in use marked, and the default", async () => {
        const { IconDialog } = await import("@/components/CompanyModulesCard")
        const html = render(h(IconDialog, { name: "Clients", current: "truck", own: "handshake", onPick: () => {}, onClose: () => {} }))
        expect(html).toContain('role="dialog"')
        expect(html).toContain(`class="ui-dialog-title">${en.module_icon_title.replace("{name}", "Clients")}</h2>`)
        expect(html).toContain('<div class="ui-icon-grid">')
        const choices = [...html.matchAll(/<button type="button" class="ui-icon-choice" aria-label="([^"]+)" aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g)]
        expect(choices.map(c => c[1])).toEqual(MODULE_ICON_NAMES.map(n => esc(en[MODULE_ICONS[n].labelKey as keyof typeof en])))
        // The one in use is marked as chosen and filled; the rest as they are.
        expect(choices.filter(c => c[2] === "true").map(c => c[1])).toEqual([en.icon_name_truck])
        expect(choices.find(c => c[1] === en.icon_name_truck)![3]).toBe(icon(TruckIcon, 24, "fill"))
        expect(choices.find(c => c[1] === en.icon_name_handshake)![3]).toBe(icon(HandshakeIcon, 24))
        // The module's own, drawn beside its words.
        expect(html).toContain(`<button type="button" class="ui-btn ui-btn-secondary">${icon(HandshakeIcon)}${en.module_icon_reset}</button>`)
        // No field for an emoji; Cancel closes it.
        expect(html).not.toContain('name="icon"')
        expect(html).not.toContain('type="submit"')
        expect(html).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-secondary"[^>]*>${en.cancel}</button>`))
        // While the company has none of its own, the module's own is the one marked.
        const none = render(h(IconDialog, { name: "Clients", current: "handshake", own: "handshake", onPick: () => {}, onClose: () => {} }))
        expect([...none.matchAll(/aria-label="([^"]+)" aria-pressed="true"/g)].map(m => m[1])).toEqual([en.icon_name_handshake])
    })

    it("keeps nothing for a module's own icon, picked from the list or with Use the default icon", async () => {
        const { overrideFor } = await import("@/components/CompanyModulesCard")
        expect(overrideFor("clients", "truck")).toBe("truck")
        expect(overrideFor("clients", "handshake")).toBeNull()
        expect(overrideFor("clients", null)).toBeNull()
    })

    it("reads in Arabic", async () => {
        const html = await modules({}, "ar")
        expect(html).toContain(`<h2 class="ui-card-title">${ar.module_names_setting}</h2>`)
        expect(html).toContain(`aria-label="${esc(ar.module_icon_choose_for.replace("{name}", ar.clients))}"`)
        // Each icon named in Arabic too.
        const { IconDialog } = await import("@/components/CompanyModulesCard")
        const dialog = render(h(IconDialog, { name: ar.clients, current: "handshake", own: "handshake", onPick: () => {}, onClose: () => {} }), "ar")
        for (const name of MODULE_ICON_NAMES) expect(dialog, name).toContain(`aria-label="${esc(ar[MODULE_ICONS[name].labelKey as keyof typeof ar])}"`)
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
    it("marks the icon in use in the dialog: the company's own, or the module's while it has none", () => {
        // The module's own is among the 48 (DESIGN.md §6), so one is marked
        // either way, as it was before the side bar's icons replaced its emoji.
        const source = readFileSync("components/CompanyModulesCard.tsx", "utf8")
        expect(source).toContain("current={preview.icon(pickerFor)}")
        expect(source).toContain("own={MODULES[pickerFor].icon}")
    })

    it("offers the module's own icon under the list, leaving the dialog's buttons to Cancel", async () => {
        // Among the dialog's buttons it pushed Use this emoji onto a line of its own (part 4a).
        const { IconDialog } = await import("@/components/CompanyModulesCard")
        const html = render(h(IconDialog, { name: "Clients", current: "truck", own: "handshake", onPick: () => {}, onClose: () => {} }))
        const reset = `<p><button type="button" class="ui-btn ui-btn-secondary">${icon(HandshakeIcon)}${en.module_icon_reset}</button></p>`
        expect(html).toMatch(new RegExp(`<div class="ui-icon-grid">[^]*?</div>${reset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<div class="ui-dialog-actions"><button type="button" class="ui-btn ui-btn-secondary"[^>]*>${en.cancel}</button></div>`))
    })

    it("ties the line saying which tabs stay the Super Admin's to the tabs it's about", async () => {
        const html = await access()
        expect(html).toMatch(new RegExp(`<fieldset class="ui-field ui-fieldset" aria-describedby="([^"]+)">[^]*<span id="\\1" class="ui-hint">${esc(en.admin_settings_never_shown)}</span></fieldset>`))
    })
})
