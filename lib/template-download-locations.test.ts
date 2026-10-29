import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, url } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed } from "./permissions/test-actors"
import { BUILT_IN_GRANTS } from "./permissions/built-in"

/**
 * The bulk upload's template lists the company's locations (CLIENTS_PLAN.md
 * §2.7), each with its client: only for someone who may see them, as the
 * task form's location picker is (LocationService.pickable). Who may create
 * tasks without seeing the locations gets the template without them.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/storage", () => ({ downloadTemplateBuffer: async () => Buffer.from("base") }))
const written: { locations: unknown[] }[] = []
vi.mock("@/lib/services/template-generator.service", () => ({
    generateBulkTaskTemplate: async (_base: unknown, _locale: unknown, _users: unknown, _clients: unknown, locations: unknown[]) => {
        written.push({ locations })
        return Buffer.from("xlsx")
    },
}))

const asked: unknown[] = []
beforeEach(() => {
    written.length = 0
    asked.length = 0
    prismaMock.location.findMany = async (query: unknown) => {
        asked.push(query)
        return [{ id: "l1", name: "Maadi branch", client: { name: "Acme" } }]
    }
})

function signIn(user: { id: string; role: string; companyId: string | null; grants?: Record<string, string> }) {
    state.session = { user: stepUpConfirmed({ ...user, grants: user.grants ? encodeGrants(user.grants as any) : undefined }) }
}
const download = async (query = "") => (await import("@/app/api/templates/download/route")).GET(new Request(url(`/api/templates/download?locale=en${query}`)))

describe("the bulk upload's template", () => {
    it("lists the company's locations for someone who may see them", async () => {
        signIn({ id: "admin", role: "ADMIN", companyId: "c1", grants: BUILT_IN_GRANTS.ADMIN })
        expect((await download()).status).toBe(200)
        expect(written[0].locations).toEqual([{ id: "l1", label: "Acme - Maadi branch", client: "Acme" }])
    })

    it("lists them for the Super Admin, in the company named", async () => {
        signIn({ id: "sa", role: "SUPER_ADMIN", companyId: null })
        expect((await download("&companyId=c1")).status).toBe(200)
        expect(written[0].locations).toHaveLength(1)
    })

    it("leaves them out, unread, for someone who may create tasks but not see the locations", async () => {
        signIn({ id: "desk", role: "EMPLOYEE", companyId: "c1", grants: { "tasks.create": "COMPANY", "employees.view": "COMPANY" } })
        expect((await download()).status).toBe(200)
        expect(written[0].locations).toEqual([])
        expect(asked).toEqual([])
    })
})
