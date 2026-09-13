import { describe, it, expect } from "vitest"
import { MODULE_KEYS, MODULES, isModuleKey, parseModuleOverrides } from "./modules"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"
import { readFileSync } from "node:fs"

describe("the module registry", () => {
    it("covers the nine company-facing modules and no more", () => {
        expect([...MODULE_KEYS].sort()).toEqual([
            "clients", "costs", "dashboard", "dayOff", "employees",
            "obligations", "requests", "tasks", "vendors",
        ])
    })

    it("excludes the System modules", () => {
        // A company's own users never see these; only a Super Admin does, while
        // looking at many companies at once. Renaming them per company would
        // customise a screen for an audience of one who is looking at everybody.
        for (const key of ["superAdmins", "companies", "packages", "allUsers", "auditLogs", "health", "systemSettings"]) {
            expect(isModuleKey(key), key).toBe(false)
        }
    })

    it("defines a label key, an icon and an href for every module", () => {
        for (const key of MODULE_KEYS) {
            const def = MODULES[key]
            expect(def, key).toBeDefined()
            expect(def.labelKey, key).toBeTruthy()
            expect(def.icon, key).toBeTruthy()
            expect(def.href.startsWith("/dashboard"), key).toBe(true)
        }
    })

    it("names every module in both locales", () => {
        for (const key of MODULE_KEYS) {
            const labelKey = MODULES[key].labelKey
            expect(en, `${key} → ${labelKey} missing in en`).toHaveProperty(labelKey)
            expect(ar, `${key} → ${labelKey} missing in ar`).toHaveProperty(labelKey)
        }
    })

    it("gives every module a distinct icon", () => {
        // Two modules sharing an emoji makes the sidebar unreadable at a glance,
        // which is the only thing an icon is for.
        const icons = MODULE_KEYS.map(k => MODULES[k].icon)
        expect(new Set(icons).size).toBe(icons.length)
    })

    it("matches what the sidebar actually renders today", () => {
        // The registry is only useful if it describes the real nav. This reads
        // the component rather than trusting the constant.
        const shell = readFileSync("components/DashboardShell.tsx", "utf8")
        for (const key of MODULE_KEYS) {
            const { href, icon, labelKey } = MODULES[key]
            const line = shell.split("\n").find(l => l.includes(`href: '${href}'`))
            expect(line, `no sidebar entry for ${href}`).toBeDefined()
            expect(line, `${key}: icon drifted from the sidebar`).toContain(icon)
            expect(line, `${key}: label key drifted from the sidebar`).toContain(`t('${labelKey}')`)
        }
    })
})

describe("parsing overrides out of an untyped Json column", () => {
    it("keeps known keys with string values", () => {
        expect(parseModuleOverrides({ clients: "Patients", tasks: "Jobs" }))
            .toEqual({ clients: "Patients", tasks: "Jobs" })
    })

    it("drops unknown keys rather than trusting them", () => {
        // These maps are edited through a UI and stored untyped, so a stale or
        // renamed key is a real possibility, not a hypothetical.
        expect(parseModuleOverrides({ clients: "Patients", superAdmins: "Owners", nonsense: "x" }))
            .toEqual({ clients: "Patients" })
    })

    it("drops non-string values", () => {
        expect(parseModuleOverrides({ clients: 42, tasks: null, costs: { a: 1 }, employees: "Crew" }))
            .toEqual({ employees: "Crew" })
    })

    it("treats an empty or whitespace value as no override at all", () => {
        // Storing one would render a module with no name.
        expect(parseModuleOverrides({ clients: "", tasks: "   " })).toEqual({})
    })

    it("trims, so a stray space does not shift a sidebar row", () => {
        expect(parseModuleOverrides({ clients: "  Patients  " })).toEqual({ clients: "Patients" })
    })

    it("returns an empty map for anything that is not an object", () => {
        for (const value of [null, undefined, "string", 7, [], [1, 2]]) {
            expect(parseModuleOverrides(value), String(value)).toEqual({})
        }
    })

    it("survives the backfill's exact shape", () => {
        // What the migration wrote for all four live companies.
        expect(parseModuleOverrides({ vendors: "Clinics" })).toEqual({ vendors: "Clinics" })
    })
})
