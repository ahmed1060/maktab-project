import { describe, it, expect } from "vitest"
import {
    MODULE_KEYS,
    MODULES,
    emptyToNull,
    isModuleKey,
    isValidModuleIcon,
    moduleForTitleKey,
    modulesFrom,
    parseModuleIcons,
    parseModuleOverrides,
    planOverrideWrite,
    resolveModuleIcon,
    resolveModuleLabel,
    sameOverrides,
} from "./modules"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { resolveTitleKey } from "./page-title"
import { COMPANY_GROUPS, PAGES } from "./side-bar"

describe("the module registry", () => {
    it("covers the nine company-facing modules and no more", () => {
        // Day off is a kind of request on the Requests page, with no entry of its own to name (UI_PLAN.md §2.3, part 5c).
        expect([...MODULE_KEYS].sort()).toEqual([
            "clients", "costs", "dashboard", "employees",
            "locations", "obligations", "records", "requests", "tasks",
        ])
    })

    it("drops a name or icon a company kept for Day off, which has no entry now (part 5c)", () => {
        expect(parseModuleOverrides({ dayOff: "Leave", requests: "Asks" })).toEqual({ requests: "Asks" })
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

    it("is the only place the sidebar's module entries are written", () => {
        // E1 asserted the registry matched a sidebar that still spelled its own
        // entries out. E2 made the sidebar read the registry, so the thing worth
        // guarding flipped: no module may reappear as a literal in the nav, or
        // renaming it would silently stop working for that one entry.
        // Nor among the app's own pages in lib/side-bar.ts.
        const shell = readFileSync("components/DashboardShell.tsx", "utf8")
        for (const key of MODULE_KEYS) {
            const { href, labelKey } = MODULES[key]
            expect(shell, `${key}: sidebar hardcodes href ${href}`).not.toContain(`href: '${href}'`)
            expect(shell, `${key}: sidebar hardcodes label ${labelKey}`).not.toContain(`t('${labelKey}')`)
            expect(Object.values(PAGES).map(p => p.href), `${key}: a page of the side bar's own`).not.toContain(href)
        }
    })

    it("puts every module in exactly one side bar group", () => {
        // The Company Settings preview draws these same groups. A module in
        // none would be missing there and in the real side bar; one in two
        // would appear twice in each.
        const grouped = COMPANY_GROUPS.flatMap(g => g.items).filter(isModuleKey)
        expect(new Set(grouped).size, "a module is in two groups").toBe(grouped.length)
        expect([...grouped].sort()).toEqual([...MODULE_KEYS].sort())
    })

    it("gives every module a distinct label key", () => {
        // moduleForTitleKey answers with whichever module claimed a key last, so
        // two modules sharing one would make a tab title silently wrong.
        const keys = MODULE_KEYS.map(k => MODULES[k].labelKey)
        expect(new Set(keys).size).toBe(keys.length)
    })
})

describe("parsing overrides out of an untyped Json column", () => {
    it("keeps known keys with string values", () => {
        expect(parseModuleOverrides({ records: "Patients", tasks: "Jobs" }))
            .toEqual({ records: "Patients", tasks: "Jobs" })
    })

    it("drops unknown keys rather than trusting them", () => {
        // These maps are edited through a UI and stored untyped, so a stale or
        // renamed key is a real possibility, not a hypothetical.
        expect(parseModuleOverrides({ records: "Patients", superAdmins: "Owners", nonsense: "x" }))
            .toEqual({ records: "Patients" })
    })

    it("drops non-string values", () => {
        expect(parseModuleOverrides({ records: 42, tasks: null, costs: { a: 1 }, employees: "Crew" }))
            .toEqual({ employees: "Crew" })
    })

    it("treats an empty or whitespace value as no override at all", () => {
        // Storing one would render a module with no name.
        expect(parseModuleOverrides({ records: "", tasks: "   " })).toEqual({})
    })

    it("trims, so a stray space does not shift a sidebar row", () => {
        expect(parseModuleOverrides({ records: "  Patients  " })).toEqual({ records: "Patients" })
    })

    it("returns an empty map for anything that is not an object", () => {
        for (const value of [null, undefined, "string", 7, [], [1, 2]]) {
            expect(parseModuleOverrides(value), String(value)).toEqual({})
        }
    })

    it("survives the backfill's exact shape", () => {
        // What the migration wrote for all four live companies.
        expect(parseModuleOverrides({ clients: "Clinics" })).toEqual({ clients: "Clinics" })
    })
})

// A stand-in for the app's `t`, which returns the English string for a key.
const t = ((key: string) => (en as Record<string, string>)[key]) as (key: any) => string

describe("resolving a module's name and icon", () => {
    it("falls back to the translated default when nothing is overridden", () => {
        expect(resolveModuleLabel("clients", {}, t)).toBe(en.clients)
        expect(resolveModuleLabel("clients", null, t)).toBe(en.clients)
        expect(resolveModuleIcon("clients", null)).toBe("🚚")
    })

    it("prefers the company's own name and icon", () => {
        expect(resolveModuleLabel("clients", { clients: "Suppliers" }, t)).toBe("Suppliers")
        expect(resolveModuleIcon("clients", { clients: "🏥" })).toBe("🏥")
    })

    it("treats an empty override as no override, not as a blank name", () => {
        // parseModuleOverrides already drops these, but the resolvers are also
        // called with maps straight off a form, which has not.
        expect(resolveModuleLabel("records", { records: "" }, t)).toBe(en.records)
        expect(resolveModuleIcon("records", { records: "" })).toBe("🗂️")
    })

    it("renames a module in every locale, because a name is not a translation", () => {
        // A company that calls Clients "Patients" calls them that in Arabic too:
        // there is no Arabic translation of a name this company invented.
        const arT = ((key: string) => (ar as Record<string, string>)[key]) as (key: any) => string
        expect(resolveModuleLabel("records", { records: "Patients" }, arT)).toBe("Patients")
        expect(resolveModuleLabel("records", {}, arT)).toBe(ar.records)
    })
})

describe("modulesFrom", () => {
    it("reads both maps off a session user and answers for any module", () => {
        const modules = modulesFrom(
            { moduleLabels: { clients: "Suppliers" }, moduleIcons: { clients: "🏥" } },
            t
        )
        expect(modules.entry("clients")).toEqual({
            key: "clients",
            href: "/dashboard/clients",
            label: "Suppliers",
            icon: "🏥",
        })
        expect(modules.entry("tasks")).toEqual({
            key: "tasks",
            href: "/dashboard/tasks",
            label: en.tasks,
            icon: "✅",
        })
    })

    it("answers with defaults for a Super Admin, who belongs to no company", () => {
        const modules = modulesFrom(undefined, t)
        for (const key of MODULE_KEYS) {
            expect(modules.label(key)).toBe((en as Record<string, string>)[MODULES[key].labelKey])
            expect(modules.icon(key)).toBe(MODULES[key].icon)
        }
    })

    it("ignores an icon override that is not an emoji", () => {
        // The write path rejects these, but a row predating that validation —
        // or written by anything other than this app — must not put the word
        // "Clients" where a 1.4rem glyph belongs.
        const modules = modulesFrom({ moduleIcons: { clients: "VEND" } }, t)
        expect(modules.icon("clients")).toBe("🚚")
    })
})

describe("validating an icon", () => {
    it("accepts a plain emoji", () => {
        for (const emoji of ["🚚", "🤝", "📊", "🌴"]) {
            expect(isValidModuleIcon(emoji), emoji).toBe(true)
        }
    })

    it("accepts emoji built out of several code points", () => {
        // A variation selector, a flag, a ZWJ sequence and a skin tone are all
        // longer than one UTF-16 unit; rejecting them would rule out most of
        // what an admin would actually paste.
        for (const emoji of ["🛡️", "🇪🇬", "🧑‍💼", "👍🏽", "👨‍👩‍👧‍👦"]) {
            expect(isValidModuleIcon(emoji), emoji).toBe(true)
        }
    })

    it("rejects text, punctuation and whitespace", () => {
        for (const bad of ["", "V", "Clients", "...", "→", "🚚 trucks", " ", "🚚 "]) {
            expect(isValidModuleIcon(bad), JSON.stringify(bad)).toBe(false)
        }
    })

    it("rejects a pasted essay even if it starts with an emoji", () => {
        expect(isValidModuleIcon("🚚".repeat(9))).toBe(false)
    })
})

describe("parsing icon overrides", () => {
    it("keeps valid emoji and drops everything else", () => {
        expect(parseModuleIcons({ clients: "🏥", records: "Patients", tasks: "" }))
            .toEqual({ clients: "🏥" })
    })

    it("drops unknown modules the same way labels do", () => {
        expect(parseModuleIcons({ superAdmins: "🛡️", costs: "🏦" })).toEqual({ costs: "🏦" })
    })
})

describe("storing overrides", () => {
    it("stores an empty map as no overrides at all", () => {
        // So a company that cleared every rename reads back identical to one
        // that never renamed anything.
        expect(emptyToNull({})).toBeNull()
        expect(emptyToNull({ clients: "Suppliers" })).toEqual({ clients: "Suppliers" })
    })

    it("compares two maps by what they say, not by key order", () => {
        expect(sameOverrides({ clients: "S", tasks: "J" }, { tasks: "J", clients: "S" })).toBe(true)
        expect(sameOverrides(null, {})).toBe(true)
        expect(sameOverrides(null, { clients: "S" })).toBe(false)
        expect(sameOverrides({ clients: "S" }, { clients: "T" })).toBe(false)
        expect(sameOverrides({ clients: "S" }, {})).toBe(false)
    })
})

describe("mapping a tab title back to a module", () => {
    it("answers for every module's own label key", () => {
        for (const key of MODULE_KEYS) {
            expect(moduleForTitleKey(MODULES[key].labelKey), key).toBe(key)
        }
    })

    it("answers null for routes that are not modules", () => {
        // These keep their translated names: a company renaming Requests has
        // not renamed the Audit Log, and "History" names a view, not a module.
        for (const key of ["history", "audit_logs", "system_health", "packages", null, undefined, ""]) {
            expect(moduleForTitleKey(key), String(key)).toBeNull()
        }
    })

    it("covers every module key the route table actually produces", () => {
        // page-title.ts and this registry are two tables that have to agree; a
        // module whose route resolves to a key nothing here claims would show
        // the default name in the browser tab while the sidebar showed the
        // custom one.
        for (const key of MODULE_KEYS) {
            const { href, labelKey } = MODULES[key]
            expect(resolveTitleKey(href), `${key}: ${href}`).toBe(labelKey)
        }
    })
})

describe("deciding what a company update stores", () => {
    it("leaves the column alone when the update is about something else", () => {
        expect(planOverrideWrite(undefined, "labels")).toBeUndefined()
        expect(planOverrideWrite(undefined, "icons")).toBeUndefined()
    })

    it("distinguishes an explicit null from an absent field", () => {
        // The distinction the whole function exists for. null is "clear every
        // override"; undefined is "this update is not about them". Conflating
        // the two would make either a rename survive a reset, or an unrelated
        // save silently wipe one.
        expect(planOverrideWrite(null, "labels")).toBeNull()
        expect(planOverrideWrite(null, "icons")).toBeNull()
    })

    it("replaces the whole map when the settings form saves", () => {
        // The form holds all nine and posts all nine, so a key it left out was
        // cleared, not left alone.
        expect(planOverrideWrite({ records: "Patients" }, "labels"))
            .toEqual({ records: "Patients" })
    })

    it("stores nothing rather than an empty map when the last override goes", () => {
        // So a company that cleared every rename reads back identical to one
        // that never renamed anything.
        expect(planOverrideWrite({}, "labels")).toBeNull()
        expect(planOverrideWrite({ clients: "" }, "labels")).toBeNull()
        expect(planOverrideWrite({ clients: "not an emoji" }, "icons")).toBeNull()
    })

    it("narrows labels and icons differently, which is what the kind selects", () => {
        // The only difference left between the two now that vendorsLabel is
        // gone: a label is kept as typed, an icon that is not an emoji is not
        // an icon.
        const incoming = { clients: "Suppliers", records: "🏥" }
        expect(planOverrideWrite(incoming, "labels")).toEqual({ clients: "Suppliers", records: "🏥" })
        expect(planOverrideWrite(incoming, "icons")).toEqual({ records: "🏥" })
    })

    it("drops unknown module keys whichever kind it is asked for", () => {
        expect(planOverrideWrite({ superAdmins: "Owners", costs: "Spend" }, "labels"))
            .toEqual({ costs: "Spend" })
        expect(planOverrideWrite({ superAdmins: "🛡️", costs: "🏦" }, "icons"))
            .toEqual({ costs: "🏦" })
    })
})

describe("the contract step", () => {
    // Every file that ever touched the dropped column, plus the resolver layer
    // that replaced it. Listed rather than globbed so a new file cannot quietly
    // reintroduce the name without somebody adding it here deliberately.
    const SOURCES = [
        "prisma/schema.prisma",
        "lib/auth.ts",
        "lib/modules.ts",
        "lib/services/company.service.ts",
        "lib/validations/company.schema.ts",
        "types/next-auth.d.ts",
        "app/api/companies/route.ts",
        "components/DashboardShell.tsx",
        "components/PageTitle.tsx",
        "components/DashboardHeader.tsx",
        "components/BulkTaskReviewModal.tsx",
        "app/(dashboard)/dashboard/clients/page.tsx",
        "app/(dashboard)/dashboard/tasks/new/page.tsx",
        "app/(dashboard)/dashboard/companies/[id]/settings/page.tsx",
    ]

    it("leaves the dropped column named nowhere but in prose", () => {
        // E2's version of this guarded the session field only, because the
        // column still existed and still had to be written. Now that it is
        // gone, any surviving `vendorsLabel` identifier is either a read of a
        // column that no longer exists — which Postgres answers with an error,
        // not a default — or a Prisma select that will throw. Comments are
        // allowed: the column's history is worth keeping, its name is not.
        for (const path of SOURCES) {
            const code = stripComments(readFileSync(path, "utf8"))
            expect(code, `${path} still names vendorsLabel outside a comment`)
                .not.toMatch(/vendorsLabel/)
        }
    })

    it("keeps the clients module itself, which is the point", () => {
        // Dropping the column must not drop the feature. Clients is still a
        // module, still renameable, and still reachable at its own route — via
        // the maps now rather than a column of its own.
        expect(isModuleKey("clients")).toBe(true)
        expect(MODULES.clients.href).toBe("/dashboard/clients")
        expect(modulesFrom({ moduleLabels: { clients: "Suppliers" } }, t).label("clients"))
            .toBe("Suppliers")
    })
})
