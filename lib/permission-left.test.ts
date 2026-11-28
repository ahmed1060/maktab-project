import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"
import { balanceAsShown, permissionAllowance } from "./attendance/permission-left"
import { settingsTab } from "./company-settings-tabs"
import { updateCompanySchema } from "./validations/company.schema"

/**
 * Hiding what's left of permission hours (LATER_CHANGES_PLAN.md §7.18;
 * DESIGN.md §5.5, Permission hours left): a company's one switch, on the
 * Attendance tab. Off, what's left of one's own permission hours isn't
 * shown or sent: the Attendance page's tile, the Requests page's
 * Permission hours, the sentence when asking, and the check-in page's late
 * arrival. The policy's limits stay.
 */

vi.setConfig({ testTimeout: 60_000 })

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => ((state.locale === "ar" ? ar : en) as Record<string, string>)[key] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))

const balance = {
    month: "2026-11", enabled: true, types: ["LATE_ARRIVAL", "EARLY_LEAVE"],
    allowanceMinutes: 240, carriedMinutes: 30, approvedMinutes: 60, pendingMinutes: 20, remainingMinutes: 190, overdrawnMinutes: 0,
    requests: 2, maxRequests: 4, minPerRequestMinutes: 15, maxPerRequestMinutes: 120, afterTheFactHours: 24,
}
const FIGURES = ["allowanceMinutes", "carriedMinutes", "approvedMinutes", "pendingMinutes", "remainingMinutes", "overdrawnMinutes", "requests"]

describe("what's sent of one's balance", () => {
    it("is all of it while what's left is shown", () => {
        expect(balanceAsShown({ ...balance, leftShown: true })).toEqual({ ...balance, leftShown: true })
        // A balance read before the switch, with nothing said, is shown.
        expect(balanceAsShown(balance)).toEqual(balance)
    })

    it("is the policy's limits alone while it's hidden: nothing of what's left, spent or waiting", () => {
        const sent = balanceAsShown({ ...balance, leftShown: false })
        for (const figure of FIGURES) expect(sent, figure).not.toHaveProperty(figure)
        expect(sent).toEqual({
            month: "2026-11", enabled: true, types: ["LATE_ARRIVAL", "EARLY_LEAVE"], maxRequests: 4,
            minPerRequestMinutes: 15, maxPerRequestMinutes: 120, afterTheFactHours: 24, leftShown: false,
        })
    })
})

describe("the Requests page's Permission hours", () => {
    it("is what's left, of the month's and what was carried, while shown", () => {
        expect(permissionAllowance({ ...balance, leftShown: true })).toEqual({ left: 190, total: 270, pending: 20, carried: 30 })
    })

    it("isn't there while hidden, or while the policy has no permission hours", () => {
        expect(permissionAllowance({ ...balance, leftShown: false })).toBeNull()
        expect(permissionAllowance({ ...balance, enabled: false, leftShown: true })).toBeNull()
    })

    it("is read on the server with the switch", () => {
        const server = stripComments(readFileSync("app/(dashboard)/dashboard/requests/page.tsx", "utf8"))
        expect(server).toContain("permissionAllowance(")
        expect(server).not.toContain("left: balance.remainingMinutes")
    })
})

describe("the balance the pages ask for", () => {
    it("is sent as shown, so a hidden one never reaches the page", () => {
        const route = stripComments(readFileSync("app/api/attendance/permissions/balance/route.ts", "utf8"))
        expect(route).toContain("balanceAsShown(")
    })

    it("carries the company's switch, read with it", () => {
        const service = stripComments(readFileSync("lib/services/attendance-request.service.ts", "utf8"))
        expect(service).toMatch(/permissionLeftShown/)
    })
})

describe("the switch", () => {
    it("is saved with the Attendance tab's settings, by whoever may change them", () => {
        const tab = settingsTab("attendance")!
        expect(tab.fields).toContain("permissionLeftShown")
        expect(tab.superAdminOnly ?? []).not.toContain("permissionLeftShown")
        expect(updateCompanySchema.safeParse({ id: "c1", permissionLeftShown: false }).success).toBe(true)
        expect(updateCompanySchema.safeParse({ id: "c1", permissionLeftShown: "no" }).success).toBe(false)
    })

    it("is saved, and read back from both places the settings page reads a company", () => {
        const sql = readFileSync("prisma/migrations/20270131000000_permission_left_shown/migration.sql", "utf8").replace(/\s+/g, " ")
        expect(sql).toContain(`ALTER TABLE "Company" ADD COLUMN "permissionLeftShown" BOOLEAN NOT NULL DEFAULT true;`)
        expect(readFileSync("prisma/schema.prisma", "utf8")).toMatch(/permissionLeftShown\s+Boolean\s+@default\(true\)/)
        const service = stripComments(readFileSync("lib/services/company.service.ts", "utf8"))
        expect(service).toContain("...(permissionLeftShown !== undefined && { permissionLeftShown }),")
        expect(stripComments(readFileSync("app/api/company-settings/route.ts", "utf8"))).toContain("permissionLeftShown: true,")
        // The Super Admin's page reads the company here: without it the switch would read On after the page loads again.
        expect(stripComments(readFileSync("app/api/companies/route.ts", "utf8"))).toContain("permissionLeftShown: true,")
    })

    it("is in the audit log in both languages", () => {
        expect(en.audit_field_permissionLeftShown).toBeTruthy()
        expect(ar.audit_field_permissionLeftShown).toBeTruthy()
        const service = stripComments(readFileSync("lib/services/company.service.ts", "utf8"))
        expect(service).toContain("changes.permissionLeftShown = { old: existing.permissionLeftShown, new: permissionLeftShown }")
    })

    const card = async (on: boolean, { readOnly = false, locale = "en" as "en" | "ar" } = {}) => {
        state.locale = locale
        const { default: PermissionLeftCard } = await import("@/components/PermissionLeftCard")
        return renderToStaticMarkup(h(PermissionLeftCard, { companyId: "c1", on, readOnly, onSaved: () => {} }))
    }
    const has = (html: string, text: string) => html.includes(text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;"))

    it("is a card of one row: on, with where it's shown, and Turn off", async () => {
        const html = await card(true)
        expect(has(html, en.perm_left_title)).toBe(true)
        expect(has(html, en.perm_left_label)).toBe(true)
        expect(has(html, en.perm_left_on_hint)).toBe(true)
        expect(html).toContain(`>${en.perm_left_on_badge}<`)
        expect(html).toContain(`>${en.settings_turn_off}</button>`)
        expect(html).not.toContain(`>${en.settings_turn_on}</button>`)
    })

    it("off, says it's hidden and that asking for more is still refused, with Turn on", async () => {
        const html = await card(false)
        expect(has(html, en.perm_left_off_hint)).toBe(true)
        expect(en.perm_left_off_hint).toMatch(/still refused/)
        expect(html).toContain(`>${en.perm_left_off_badge}<`)
        expect(html).toContain(`>${en.settings_turn_on}</button>`)
    })

    it("for whoever may only look: the badge and no button", async () => {
        const html = await card(true, { readOnly: true })
        expect(html).toContain(`>${en.perm_left_on_badge}<`)
        expect(html).not.toContain("<button")
    })

    it("in Arabic, in Arabic", async () => {
        const html = await card(true, { locale: "ar" })
        expect(html).toContain(ar.perm_left_title)
        expect(html).toContain(ar.perm_left_label)
    })

    it("sits on the Attendance tab under Attendance policy", () => {
        const attendance = stripComments(readFileSync("components/CompanyAttendanceCard.tsx", "utf8"))
        const policy = attendance.indexOf("<AttendancePolicyPanel")
        expect(policy).toBeGreaterThan(-1)
        expect(attendance.indexOf("{permissionLeft}")).toBeGreaterThan(policy)
        expect(attendance.indexOf("{permissionLeft}")).toBeLessThan(attendance.indexOf("<FaceLegalPanel"))
        const tabs = stripComments(readFileSync("components/CompanySettingsTabs.tsx", "utf8"))
        expect(tabs).toMatch(/permissionLeft=\{<PermissionLeftCard companyId=\{companyId\} on=\{company\.permissionLeftShown !== false\} readOnly=\{readOnly\} onSaved=\{onSaved\} \/>\}/)
    })
})
