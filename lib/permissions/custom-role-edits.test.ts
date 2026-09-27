import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, withBody, fieldsWritten } from "./employee-access.harness"
import { encodeGrants, type Grants } from "./grants"
import { stepUpConfirmed } from "./test-actors"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Editing and creating people as somebody on a company's own role — access the
 * built-in roles never had, at team scope or without a neighbouring grant — and
 * editing a Super Admin's account as anyone else. The built-in roles are the
 * employee record's (employee-access.characterization.test.ts); this is what
 * custom roles opened up.
 *
 * The actor is the harness's Team Leader ("tl"), whose team is "emp"; "loner"
 * is in the company but not the team.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))
vi.mock("@/lib/services/salary-history.service", () => ({ SalaryHistoryService: { record: async () => {} } }))
vi.mock("@/lib/services/salary.service", () => ({ SalaryService: { ensureRecordExists: async () => {} } }))
vi.mock("@/lib/services/employment.service", () => ({ EmploymentService: { recordStatusChange: async () => {}, record: async () => ({ id: "ev" }), history: async () => [], timelineForMonth: async () => [] } }))
vi.mock("@/lib/services/settlement.service", () => ({ SettlementService: { preview: async () => ({}), settleAndEnd: async () => ({ event: {}, settlement: {}, debt: null, preview: {} }) } }))

const users = () => import("@/app/api/users/route")
const put = async (body: unknown) => (await users()).PUT(withBody("PUT", "/api/users", body))

function onRole(grants: Grants, who: { id: string; role: string; companyId: string | null } = { id: "tl", role: "EMPLOYEE", companyId: "c1" }) {
    state.session = { user: stepUpConfirmed({ ...who, grants: encodeGrants(grants) }) }
    state.written = []
    state.created = []
}

// A Super Admin's own row, which company people must never reach.
const SA_ROW = { id: "sa-row", firstName: "S", lastName: "A", email: "sa@x", gender: "MALE", avatar: null, username: "sa", isProtected: false }
beforeEach(() => {
    prismaMock.superAdmin.findUnique = async ({ where }: any) => where.id === SA_ROW.id ? SA_ROW : null
    prismaMock.superAdmin.update = async ({ data }: any) => { state.written.push({ ...data }); return { ...SA_ROW, ...data } }
})

describe("a Super Admin's account", () => {
    it("is not a company Admin's to edit, password or otherwise", async () => {
        onRole({ "employees.view": "COMPANY", "employees.edit": "COMPANY", "employees.reset_password": "COMPANY" }, { id: "admin", role: "ADMIN", companyId: "c1" })
        expect((await put({ id: "sa-row", password: "a-new-password-123" })).status).toBe(403)
        expect((await put({ id: "sa-row", firstName: "Mallory" })).status).toBe(403)
        expect(fieldsWritten()).toEqual([])
    })

    it("is the Super Admins'", async () => {
        onRole({}, { id: "sa", role: "SUPER_ADMIN", companyId: null })
        expect((await put({ id: "sa-row", firstName: "Sam" })).status).toBe(200)
        expect(fieldsWritten()).toEqual(["firstName"])
    })
})
