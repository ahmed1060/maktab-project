import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, withBody, url, as } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed } from "./permissions/test-actors"
import { maySetField, maySettings, visibleSettingsTabs, ELIGIBLE_SETTINGS_TABS } from "./company-settings-access"
import { COMPANY_SETTINGS_TABS } from "./company-settings-tabs"
import { updateCompanySchema } from "./validations/company.schema"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { isReserved } from "./permissions/catalogue"

vi.setConfig({ testTimeout: 60_000 })

/**
 * A company's own people seeing its settings (ATTENDANCE_PLAN.md §5.2): the
 * Super Admin's switch, the tabs they tick, and the person's settings.view or
 * settings.edit, all asked on the server. The actors are the harness's: "admin"
 * is company c1's Admin, "admin2" company c2's.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
const audited: any[] = []
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async (...args: any[]) => { audited.push(args) }, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const C1 = {
    id: "c1", name: "One", isBanned: false,
    autoVerifyLocation: false, logoUrl: "https://example.test/logo.png",
    payrollDay: 25, payslipsVisible: false, timezone: "Africa/Cairo", debtRecoveryPercent: 100,
    moduleLabels: null, moduleIcons: null,
    adminSettingsEnabled: true, adminSettingsTabs: ["general", "payroll"],
}
let company: typeof C1

beforeEach(() => {
    company = { ...C1, adminSettingsTabs: [...C1.adminSettingsTabs] }
    audited.length = 0
    prismaMock.company.findUnique = async ({ where }: any) => where.id === "c1" ? { ...company } : null
    prismaMock.company.update = async ({ data }: any) => { state.written.push({ ...data }); company = { ...company, ...data }; return company }
})

const exposure = () => ({ id: company.id, adminSettingsEnabled: company.adminSettingsEnabled, adminSettingsTabs: company.adminSettingsTabs })
const settings = () => import("@/app/api/company-settings/route")
const get = async (query = "") => (await settings()).GET(new Request(url(`/api/company-settings${query}`)))
const put = async (body: unknown) => (await settings()).PUT(withBody("PUT", "/api/company-settings", body))

/** Somebody in c1 on a role holding just these. */
function onRole(grants: Record<string, string>) {
    state.session = { user: stepUpConfirmed({ id: "hr", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants(grants as any) }) }
    state.written = []
}

describe("who sees which tabs", () => {
    it("the Super Admin: every tab of every company", () => {
        expect(visibleSettingsTabs({ id: "sa", role: "SUPER_ADMIN" }, exposure())).toEqual(COMPANY_SETTINGS_TABS.map(t => t.key))
    })

    it("the company's Admin: the tabs ticked, once the switch is on", () => {
        const admin = { id: "admin", role: "ADMIN", companyId: "c1", grants: encodeGrants(BUILT_IN_GRANTS.ADMIN) }
        expect(visibleSettingsTabs(admin, exposure())).toEqual(["general", "payroll"])
        company.adminSettingsEnabled = false
        expect(visibleSettingsTabs(admin, exposure())).toEqual([])
    })

    it("never a tab that may not be shown, even if one were stored", () => {
        company.adminSettingsTabs = ["general", "roles", "modules", "access"]
        const admin = { id: "admin", role: "ADMIN", companyId: "c1", grants: encodeGrants(BUILT_IN_GRANTS.ADMIN) }
        expect(visibleSettingsTabs(admin, exposure())).toEqual(["general"])
        expect(ELIGIBLE_SETTINGS_TABS).toEqual(["general", "branding", "payroll"])
    })

    it("nobody without settings.view, nor anyone from another company", () => {
        expect(visibleSettingsTabs({ id: "emp", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants(BUILT_IN_GRANTS.EMPLOYEE) }, exposure())).toEqual([])
        expect(visibleSettingsTabs({ id: "admin2", role: "ADMIN", companyId: "c2", grants: encodeGrants(BUILT_IN_GRANTS.ADMIN) }, exposure())).toEqual([])
    })

    it("saves need settings.edit, and some fields stay the Super Admin's", () => {
        const viewer = { id: "hr", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "settings.view": "COMPANY" }) }
        expect(maySettings(viewer, exposure(), "general", "view")).toBe(true)
        expect(maySettings(viewer, exposure(), "general", "edit")).toBe(false)
        expect(maySetField(viewer, "payroll", "payrollDay")).toBe(true)
        expect(maySetField(viewer, "payroll", "debtRecoveryPercent")).toBe(false)
        expect(maySetField({ id: "sa", role: "SUPER_ADMIN" }, "payroll", "debtRecoveryPercent")).toBe(true)
        expect(maySetField(viewer, "general", "payrollDay")).toBe(false)
    })

    it("the built-in Admin role holds both permissions, which are offered in the matrix now", () => {
        expect(BUILT_IN_GRANTS.ADMIN["settings.view"]).toBe("COMPANY")
        expect(BUILT_IN_GRANTS.ADMIN["settings.edit"]).toBe("COMPANY")
        expect(isReserved("settings.view")).toBe(false)
        expect(isReserved("settings.edit")).toBe(false)
    })
})

describe("the company settings API", () => {
    it("shows the company's Admin only its shown tabs and their values", async () => {
        as("admin")
        const res = await get()
        expect(res.status).toBe(200)
        const { data } = await res.json()
        expect(data.tabs).toEqual(["general", "payroll"])
        expect(data.canEdit).toBe(true)
        expect(Object.keys(data.company).sort()).toEqual(["autoVerifyLocation", "debtRecoveryPercent", "id", "name", "payrollDay", "payslipsVisible", "timezone"])
    })

    it("answers nothing while the switch is off, or to someone without settings.view", async () => {
        as("employee")
        expect((await get()).status).toBe(403)
        company.adminSettingsEnabled = false
        as("admin")
        expect((await get()).status).toBe(403)
    })

    it("reads one's own company only: a company id in the query is ignored", async () => {
        as("otherAdmin")
        expect((await get("?companyId=c1")).status).toBe(404)
    })

    it("saves a shown tab's fields, audited with the person's name", async () => {
        as("admin")
        const res = await put({ tab: "payroll", payrollDay: 20, payslipsVisible: true })
        expect(res.status).toBe(200)
        expect(state.written).toEqual([{ payrollDay: 20, payslipsVisible: true }])
        expect(audited).toHaveLength(1)
        expect(audited[0][0]).toBe("UPDATE_COMPANY")
        expect(audited[0][3]).toMatchObject({ userId: "admin", details: { payrollDay: { old: 25, new: 20 }, payslipsVisible: { old: false, new: true } } })
        expect(audited[0][3].superAdminId).toBeUndefined()
    })

    it("refuses a hidden tab, a field of another tab, and a field only the Super Admin sets", async () => {
        as("admin")
        expect((await put({ tab: "branding" })).status).toBe(403)
        expect((await put({ tab: "modules", moduleLabels: {} })).status).toBe(403)
        expect((await put({ tab: "general", payrollDay: 20 })).status).toBe(400)
        expect((await put({ tab: "payroll", debtRecoveryPercent: 0 })).status).toBe(403)
        expect(state.written).toEqual([])
    })

    it("refuses saving to someone who may only look", async () => {
        onRole({ "settings.view": "COMPANY" })
        expect((await get()).status).toBe(200)
        expect((await put({ tab: "general", autoVerifyLocation: true })).status).toBe(403)
        expect(state.written).toEqual([])
    })

    it("lets a custom role holding settings.edit save, not just the Admin", async () => {
        onRole({ "settings.edit": "COMPANY", "settings.view": "COMPANY" })
        expect((await put({ tab: "general", autoVerifyLocation: true })).status).toBe(200)
        expect(state.written).toEqual([{ autoVerifyLocation: true }])
    })

    it("lets the Super Admin save any tab's fields, the debt cap included", async () => {
        as("superAdmin")
        company.adminSettingsEnabled = false
        expect((await put({ companyId: "c1", tab: "payroll", debtRecoveryPercent: 50 })).status).toBe(200)
        expect(state.written).toEqual([{ debtRecoveryPercent: 50 }])
        expect(audited[0][3]).toMatchObject({ superAdminId: "sa" })
    })
})

describe("the company logo", () => {
    const remove = async () => (await import("@/app/api/companies/logo/route")).DELETE(new Request(url("/api/companies/logo?companyId=c1"), { method: "DELETE" }))

    it("is the company's to change only when Branding is shown to it", async () => {
        as("admin")
        expect((await remove()).status).toBe(403)
        company.adminSettingsTabs = ["branding"]
        expect((await remove()).status).toBe(200)
        expect(state.written).toEqual([{ logoUrl: null }])
    })

    it("is never another company's", async () => {
        company.adminSettingsTabs = ["branding"]
        as("otherAdmin")
        expect((await remove()).status).toBe(403)
    })
})

describe("the Super Admin's switch", () => {
    it("takes only tabs that may be shown, each once", () => {
        expect(updateCompanySchema.safeParse({ id: "c1", adminSettingsEnabled: true, adminSettingsTabs: ["general", "branding", "payroll"] }).success).toBe(true)
        expect(updateCompanySchema.safeParse({ id: "c1", adminSettingsTabs: ["roles"] }).success).toBe(false)
        expect(updateCompanySchema.safeParse({ id: "c1", adminSettingsTabs: ["general", "general"] }).success).toBe(false)
    })

    it("is the Super Admin's alone", async () => {
        as("admin")
        const { PUT } = await import("@/app/api/companies/route")
        expect((await PUT(withBody("PUT", "/api/companies", { id: "c1", adminSettingsTabs: ["general", "branding", "payroll"] }))).status).toBe(403)
    })

    it("is audited when it changes", async () => {
        as("superAdmin")
        const { PUT } = await import("@/app/api/companies/route")
        expect((await PUT(withBody("PUT", "/api/companies", { id: "c1", adminSettingsEnabled: false, adminSettingsTabs: ["general"] }))).status).toBe(200)
        expect(audited[0][3].details).toEqual({
            adminSettingsEnabled: { old: true, new: false },
            adminSettingsTabs: { old: ["general", "payroll"], new: ["general"] },
        })
    })
})
