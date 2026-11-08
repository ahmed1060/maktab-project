import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import {
    MODULES,
    MODULE_ICON_NAMES,
    MODULE_KEYS,
    isModuleIconName,
    modulesFrom,
    parseModuleIcons,
    planOverrideWrite,
    resolveModuleIcon,
} from "./modules"
import { MODULE_ICONS } from "./module-icons"
import { ITEM_ICONS } from "./side-bar-icons"
import { updateCompanySchema } from "./validations/company.schema"

/**
 * A module's icon, chosen by its company (DESIGN.md §6, UI_PLAN.md §4.4):
 * one of 48 of the app's own icons, by its Phosphor name, where it was any
 * emoji at all. Each module's own is among them.
 */

/** "map-trifold" → "MapTrifold", as Phosphor names its icons. */
const pascal = (name: string) => name.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join("")
const t = (key: string) => en[key as keyof typeof en] ?? key

describe("the list", () => {
    it("is 48 icons, each once, in the order DESIGN.md §6 gives", () => {
        expect(MODULE_ICON_NAMES).toHaveLength(48)
        expect(new Set(MODULE_ICON_NAMES).size).toBe(48)
        const design = readFileSync("DESIGN.md", "utf8")
        const start = design.indexOf("**A module's icon, chosen by its company**")
        expect(start).toBeGreaterThan(-1)
        const section = design.slice(design.indexOf("In this order:", start), design.indexOf("- Each module's icon is a button", start))
        expect([...section.matchAll(/`([A-Za-z]+)`/g)].map(m => m[1])).toEqual(MODULE_ICON_NAMES.map(pascal))
    })

    it("draws each with the Phosphor icon of its name", () => {
        expect(Object.keys(MODULE_ICONS).sort()).toEqual([...MODULE_ICON_NAMES].sort())
        for (const name of MODULE_ICON_NAMES) {
            const glyph = MODULE_ICONS[name].glyph as { displayName?: string }
            expect(glyph.displayName, name).toBe(`${pascal(name)}Icon`)
        }
    })

    it("names each for what it draws, in both languages, no two alike", () => {
        for (const dict of [en, ar]) {
            const names = MODULE_ICON_NAMES.map(name => dict[MODULE_ICONS[name].labelKey as keyof typeof dict])
            for (const [i, name] of names.entries()) expect(name, MODULE_ICON_NAMES[i]).toBeTruthy()
            expect(new Set(names).size).toBe(48)
        }
        // Sentence case in English; Arabic letters in Arabic.
        for (const name of MODULE_ICON_NAMES) {
            const english = en[MODULE_ICONS[name].labelKey as keyof typeof en] as string
            expect(english, name).toMatch(/^[A-Z][A-Za-z]*( [a-z]+)*$/)
            expect(ar[MODULE_ICONS[name].labelKey as keyof typeof ar], name).toMatch(/[؀-ۿ]/)
        }
    })

    it("holds each module's own icon, the side bar's", () => {
        for (const key of MODULE_KEYS) {
            const own = MODULES[key].icon
            expect(MODULE_ICON_NAMES, key).toContain(own)
            expect(MODULE_ICONS[own].glyph, key).toBe(ITEM_ICONS[key])
        }
    })
})

describe("what a company keeps", () => {
    it("is a name on the list", () => {
        expect(isModuleIconName("truck")).toBe(true)
        for (const bad of ["Truck", "TruckIcon", "🚚", "", " truck", "rocket", null, 5]) expect(isModuleIconName(bad), String(bad)).toBe(false)
    })

    it("keeps names on the list and drops anything else, an emoji too, so the module shows its own", () => {
        expect(parseModuleIcons({ clients: "truck", records: "🗂️", tasks: "rocket", costs: 5, dayoff: "bell" })).toEqual({ clients: "truck" })
        expect(parseModuleIcons(null)).toEqual({})
        expect(parseModuleIcons(["truck"])).toEqual({})
    })

    it("keeps nothing for a module's own icon, which is no choice of the company's", () => {
        expect(parseModuleIcons({ clients: "handshake", tasks: "handshake" })).toEqual({ tasks: "handshake" })
        expect(planOverrideWrite({ clients: "handshake" }, "icons")).toBeNull()
        expect(planOverrideWrite({ clients: "truck", records: "folders" }, "icons")).toEqual({ clients: "truck" })
    })

    it("resolves to the company's icon for a module, or the module's own", () => {
        expect(resolveModuleIcon("clients", { clients: "truck" })).toBe("truck")
        expect(resolveModuleIcon("clients", null)).toBe("handshake")
        expect(resolveModuleIcon("clients", { clients: "🚚" })).toBe("handshake")
        const modules = modulesFrom({ moduleLabels: { clients: "Suppliers" }, moduleIcons: { clients: "truck" } }, t)
        expect(modules.entry("clients")).toEqual({ key: "clients", href: "/dashboard/clients", label: "Suppliers", icon: "truck" })
        expect(modules.icon("tasks")).toBe("check-square")
    })

    it("is refused by the API when it isn't on the list", () => {
        const ok = (moduleIcons: unknown) => updateCompanySchema.safeParse({ id: "c1", moduleIcons }).success
        expect(ok({ clients: "truck" })).toBe(true)
        expect(ok({ clients: "" })).toBe(true)
        expect(ok({ clients: "handshake" })).toBe(true)
        expect(ok({ clients: "🚚" })).toBe(false)
        expect(ok({ clients: "rocket" })).toBe(false)
        expect(ok({ vendors: "truck" })).toBe(false)
    })
})

describe("the icon dialog's buttons", () => {
    it("take a tap at once, with no grey flash, as every control does (web interface audit)", () => {
        const ui = readFileSync("components/ui/ui.css", "utf8")
        const shared = ui.slice(0, ui.indexOf("touch-action: manipulation;"))
        expect(shared.slice(shared.lastIndexOf("}") + 1)).toMatch(/\.ui-icon-choice,\n/)
    })
})

describe("no emoji left", () => {
    it("in the side bar, the Modules tab, the stylesheet or the words", () => {
        const files = ["components/SideBar.tsx", "components/CompanyModulesCard.tsx", "components/ui/ui.css", "lib/modules.ts", "lib/validations/company.schema.ts"]
        for (const file of files) {
            const source = readFileSync(file, "utf8")
            expect(source, file).not.toMatch(/ui-side-emoji|ui-emoji|isValidModuleIcon|Extended_Pictographic/)
        }
        for (const key of ["module_icon_custom", "module_icon_use", "module_icon_invalid", "module_icon_required"]) {
            expect(en, key).not.toHaveProperty(key)
            expect(ar, key).not.toHaveProperty(key)
        }
        for (const dict of [en, ar]) {
            for (const [key, value] of Object.entries(dict).filter(([k]) => k.startsWith("module_icon"))) {
                expect(value, key).not.toMatch(/emoji|إيموجي/i)
            }
        }
    })
})
