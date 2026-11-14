import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync, readdirSync } from "node:fs"
import { PERMISSIONS, CATALOGUE_VERSION } from "./permissions/catalogue"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { normalizeGrants } from "./permissions/grant-rules"
import { encodeGrants } from "./permissions/grants"
import { settingsTab } from "./company-settings-tabs"
import { maySetField } from "./company-settings-access"
import { mayTerminals } from "./attendance/terminals-access"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"

/**
 * Who may set fingerprint terminals up (ATTENDANCE_PLAN.md §17.10, round 9;
 * Phase 4 part 2, PR 277): a permission of its own, high-risk, held by the
 * built-in Admin, opening the Fingerprint terminals section only where the
 * Super Admin's switch lets the company set its own terminals up.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, isRtl: state.locale === "ar", t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))

describe("Set up fingerprint terminals, in the catalogue", () => {
    it("is its own permission: company-wide, affecting pay, and useless without seeing settings", () => {
        expect(PERMISSIONS["attendance.manage_terminals"]).toEqual({
            code: 66, module: "ATTENDANCE", scopes: ["COMPANY"], implies: ["settings.view"], highRisk: "Affects pay",
        })
        // A role given it is given settings.view too: the section is on a settings tab.
        const verdict = normalizeGrants([{ permission: "attendance.manage_terminals", scope: "COMPANY" }])
        expect(verdict).toEqual({ ok: true, grants: { "attendance.manage_terminals": "COMPANY", "settings.view": "COMPANY" } })
    })

    it("is held by the built-in Admin, and not by a Team Leader or an Employee", () => {
        expect(BUILT_IN_GRANTS.ADMIN["attendance.manage_terminals"]).toBe("COMPANY")
        expect(BUILT_IN_GRANTS.TEAM_LEADER["attendance.manage_terminals"]).toBeUndefined()
        expect(BUILT_IN_GRANTS.EMPLOYEE["attendance.manage_terminals"]).toBeUndefined()
    })

    it("leaves the catalogue's version as it is: no role already there holds it until a later release's migration", () => {
        expect(CATALOGUE_VERSION).toBe(4)
    })

    it("is named in both languages, the Arabic without a gendered command", () => {
        expect(en.perm_attendance_manage_terminals).toBe("Set up fingerprint terminals: agents, their codes and terminals")
        expect(ar.perm_attendance_manage_terminals).toBe("إعداد أجهزة البصمة: برامج المزامنة وأكوادها والأجهزة")
    })
})

describe("the company's switch", () => {
    it("is a field of the Attendance tab only the Super Admin sets", () => {
        const tab = settingsTab("attendance")!
        expect(tab.fields).toEqual(["terminalsSetupByCompany"])
        expect(tab.superAdminOnly).toEqual(["terminalsSetupByCompany"])
        expect(maySetField({ role: "ADMIN", companyId: "c1" }, "attendance", "terminalsSetupByCompany")).toBe(false)
        expect(maySetField({ role: "SUPER_ADMIN" }, "attendance", "terminalsSetupByCompany")).toBe(true)
    })

    it("comes with a migration that only adds the column, off for every company", () => {
        const name = readdirSync("prisma/migrations").find(m => m.endsWith("_terminals_setup"))
        expect(name).toBe("20261220000000_terminals_setup")
        const sql = readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8").split("\n").filter(line => !line.startsWith("--")).join("\n")
        const statements = sql.split(";").map(s => s.trim()).filter(Boolean)
        expect(statements).toEqual([`ALTER TABLE "Company" ADD COLUMN "terminalsSetupByCompany" BOOLEAN NOT NULL DEFAULT false`])
        expect(readFileSync("prisma/schema.prisma", "utf8")).toMatch(/terminalsSetupByCompany\s+Boolean\s+@default\(false\)/)
    })

    it("is written to the audit log by name, in both languages", () => {
        expect(en.audit_field_terminalsSetupByCompany).toBe("Company sets up its own fingerprint terminals")
        expect(ar.audit_field_terminalsSetupByCompany).toBe("الشركة تُعِدّ أجهزة البصمة الخاصة بها")
        expect(readFileSync("lib/validations/company.schema.ts", "utf8")).toContain("terminalsSetupByCompany: z.boolean().optional()")
    })
})

describe("who reaches Fingerprint terminals", () => {
    const company = (fields: Partial<{ terminalsSetupByCompany: boolean; adminSettingsTabs: string[]; adminSettingsEnabled: boolean }> = {}) => ({
        id: "c1", adminSettingsEnabled: true, adminSettingsTabs: ["attendance"], package: null, terminalsSetupByCompany: true, ...fields,
    })
    const person = (grants: Record<string, string>) => ({ id: "p", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants(grants as any) })
    const holder = person({ "attendance.manage_terminals": "COMPANY", "settings.view": "COMPANY" })
    const admin = { id: "a", role: "ADMIN", companyId: "c1", grants: encodeGrants(BUILT_IN_GRANTS.ADMIN) }

    it("the Super Admin always, the company's switch on or off", () => {
        expect(mayTerminals({ role: "SUPER_ADMIN" }, company({ terminalsSetupByCompany: false }))).toBe(true)
        expect(mayTerminals({ role: "SUPER_ADMIN" }, company({ adminSettingsEnabled: false }))).toBe(true)
    })

    it("in the company, those holding the permission, where the switch is on and the Attendance tab is shown to them", () => {
        expect(mayTerminals(holder, company())).toBe(true)
        expect(mayTerminals(admin, company())).toBe(true)
        expect(mayTerminals(holder, company({ terminalsSetupByCompany: false }))).toBe(false)
        expect(mayTerminals(admin, company({ terminalsSetupByCompany: false }))).toBe(false)
        expect(mayTerminals(holder, company({ adminSettingsTabs: ["general"] }))).toBe(false)
        expect(mayTerminals(holder, company({ adminSettingsEnabled: false }))).toBe(false)
    })

    it("not whoever only sees or saves settings, nor another company's people", () => {
        expect(mayTerminals(person({ "settings.view": "COMPANY", "settings.edit": "COMPANY" }), company())).toBe(false)
        expect(mayTerminals({ ...holder, companyId: "c2" }, company())).toBe(false)
    })
})

describe("its routes", () => {
    const source = (path: string) => stripComments(readFileSync(path, "utf8"))
    const ASKS = ["app/api/attendance/agents/route.ts", "app/api/attendance/agents/[id]/code/route.ts", "app/api/attendance/devices/[id]/route.ts"]

    it("ask for the step-up code where an agent's code is issued or a terminal retired", () => {
        for (const path of ASKS) expect(source(path), path).toContain(`assertStepUp(session, "attendance.manage_terminals")`)
        // Retiring is DELETE; renaming and setting a mode, PATCH, don't ask.
        const device = source("app/api/attendance/devices/[id]/route.ts")
        expect(device.indexOf("assertStepUp(session")).toBeGreaterThan(device.indexOf("export const DELETE"))
    })

    it("don't ask to look, to revoke an agent or to put a terminal back", () => {
        for (const path of ["app/api/attendance/devices/route.ts", "app/api/attendance/agents/[id]/route.ts", "app/api/attendance/devices/[id]/restore/route.ts"]) {
            expect(source(path), path).not.toContain("assertStepUp")
        }
    })

    it("ask the same one question, with no view-or-edit of the Attendance tab left", () => {
        for (const path of [...ASKS, "app/api/attendance/devices/route.ts", "app/api/attendance/agents/[id]/route.ts", "app/api/attendance/devices/[id]/restore/route.ts"]) {
            expect(source(path), path).toMatch(/denyTerminals\(session, [\w.!]+\)/)
            expect(source(path), path).not.toMatch(/denyTerminals\([^)]*"(view|edit)"\)/)
        }
    })
})

describe("the alerts about a silent agent or terminal", () => {
    it("go to those holding the permission where the switch is on, and to the Super Admin otherwise", () => {
        const alerts = stripComments(readFileSync("lib/services/attendance-terminal-alerts.ts", "utf8"))
        expect(alerts).toContain(`holdersOf("attendance.manage_terminals")`)
        expect(alerts).not.toContain(`holdersOf("settings.view")`)
        expect(alerts).toContain("company.terminalsSetupByCompany")
    })
})

describe("on the Attendance tab", () => {
    async function card(on: boolean, locale: "en" | "ar" = "en") {
        state.locale = locale
        const { default: TerminalsSetupCard } = await import("@/components/TerminalsSetupCard")
        return renderToStaticMarkup(h(TerminalsSetupCard, { companyId: "c1", on, onSaved: () => {} }))
    }

    it("the Super Admin's card says who sets the company's terminals up, off to start", async () => {
        const off = await card(false)
        expect(off).toContain(en.att_term_setup_title)
        expect(off).toContain(en.att_term_setup_label)
        expect(off).toContain(en.att_term_setup_off_hint.replace(/'/g, "&#x27;"))
        expect(off).toContain(`>${en.att_term_setup_off_badge}<`)
        expect(off).toContain(`>${en.att_term_setup_turn_on}<`)
        const on = await card(true)
        expect(on).toContain(en.att_term_setup_on_hint.replace(/'/g, "&#x27;"))
        expect(on).toContain(`>${en.att_term_setup_on_badge}<`)
        expect(on).toContain(`>${en.att_term_setup_turn_off}<`)
    })

    it("in Arabic, its badge saying what its hint does", async () => {
        const off = await card(false, "ar")
        expect(off).toContain(ar.att_term_setup_title)
        expect(off).toContain(ar.att_term_setup_turn_on)
        expect(ar.att_term_setup_off_hint.startsWith(`${ar.att_term_setup_off_badge}:`)).toBe(true)
        expect(ar.att_term_setup_on_hint.startsWith(`${ar.att_term_setup_on_badge}:`)).toBe(true)
        expect(en.att_term_setup_off_hint.startsWith(`${en.att_term_setup_off_badge}:`)).toBe(true)
        expect(en.att_term_setup_on_hint.startsWith(`${en.att_term_setup_on_badge}:`)).toBe(true)
    })

    it("keeps its question open when turning the switch on fails, to try again or cancel", () => {
        const source = stripComments(readFileSync("components/TerminalsSetupCard.tsx", "utf8"))
        expect(source).toContain("if (await save(true)) setAsking(false)")
        expect(source).toContain("return false")
    })

    it("shows the card to the Super Admin alone, for a company holding the Terminals add-on", () => {
        const tabs = readFileSync("components/CompanySettingsTabs.tsx", "utf8")
        expect(tabs).toMatch(/superAdmin && company\.terminalsOffered && \(\s*<TerminalsSetupCard/)
        const route = readFileSync("app/api/company-settings/route.ts", "utf8")
        expect(route).toContain(`shown.terminalsOffered = hasBundle(resolveBundles(company.package), "ATTENDANCE_TERMINALS")`)
    })

    it("lets whoever reaches Fingerprint terminals change them, whatever they may save on the rest of the tab", () => {
        // Shown only to those who may: no read-only view of it, whatever
        // else the person may save on the tab.
        const card = readFileSync("components/CompanyAttendanceCard.tsx", "utf8")
        expect(card).toContain("<AttendanceTerminalsPanel companyId={companyId} />")
        expect(readFileSync("components/AttendanceTerminalsPanel.tsx", "utf8")).toContain("export default function AttendanceTerminalsPanel({ companyId }: { companyId: string })")
    })
})
