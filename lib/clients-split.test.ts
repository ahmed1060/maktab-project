import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { PERMISSIONS, CATALOGUE_VERSION, type Permission } from "@/lib/permissions/catalogue"
import { encodeGrants, type Grants } from "@/lib/permissions/grants"
import { PERMISSION_GROUPS } from "@/lib/permissions/matrix"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { stepUpConfirmed } from "@/lib/permissions/test-actors"
import { state, prismaMock, url, withBody } from "@/lib/permissions/client-access.harness"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

vi.setConfig({ testTimeout: 120_000 })

/**
 * clients.manage split by what it does (LATER_CHANGES_PLAN.md §2, PR 365):
 * clients.create adds a client; clients.edit changes its details and picks
 * its responsible accountant; clients.delete deletes or archives one,
 * deletes an archived one for good, and restores one from the archive.
 *
 * Until the grant for companies already there rewrites their roles, a role
 * still holding clients.manage is read as holding each part, at its scope,
 * so nobody loses access in between. The real routes run, as people holding
 * one part and not the others.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

const PARTS = ["clients.create", "clients.edit", "clients.delete"] as const

/** An Admin of the first company holding exactly these. */
const holding = (grants: Grants) => ({ id: "admin", role: "ADMIN", companyId: "c1", grants: encodeGrants(grants) })
const signIn = (grants: Grants) => {
    state.session = { user: stepUpConfirmed(holding(grants)) }
    state.written = []
    state.created = []
}
const viewAnd = (...parts: Permission[]): Grants => Object.fromEntries([["clients.view", "COMPANY"], ...parts.map(p => [p, "COMPANY"])])

const clientsApi = () => import("@/app/api/clients/route")
const P = { params: {} }
const add = async () => (await clientsApi()).POST(withBody("POST", "/api/clients", { name: "V", ownerName: "O", mobileNumber: "0100000000", hq: { name: "Cairo", latitude: 30.0444, longitude: 31.2357 } }), P)
const edit = async () => (await clientsApi()).PUT(withBody("PUT", "/api/clients", { id: "v-1", name: "Renamed" }), P)
const restore = async () => (await clientsApi()).PUT(withBody("PUT", "/api/clients", { id: "v-1", restore: true }), P)
const remove = async () => (await clientsApi()).DELETE(new Request(url("/api/clients?id=v-1"), { method: "DELETE" }), P)

describe("the catalogue", () => {
    it("has clients.create, clients.edit and clients.delete, each with a code of its own, for the company, and none high-risk", () => {
        expect(PARTS.map(p => PERMISSIONS[p].code)).toEqual([72, 73, 74])
        for (const p of PARTS) {
            expect(PERMISSIONS[p]).toMatchObject({ module: "CLIENTS", scopes: ["COMPANY"], implies: ["clients.view"] })
            expect((PERMISSIONS[p] as { highRisk?: string }).highRisk, p).toBeUndefined()
        }
    })

    it("offers the three in the role editor, and clients.manage no more", () => {
        const clients = PERMISSION_GROUPS.find(g => g.key === "clients")!.permissions
        for (const p of PARTS) expect(clients).toContain(p)
        expect(PERMISSION_GROUPS.flatMap(g => g.permissions)).not.toContain("clients.manage")
    })

    it("goes up a version, so every session reloads its grants once and holds the parts", () => {
        // 5 for this split; 6 since the obligations one (PR 367).
        expect(CATALOGUE_VERSION).toBeGreaterThanOrEqual(5)
    })

    it("seeds the built-in Admin with the three, and nobody with clients.manage", () => {
        for (const p of PARTS) expect(BUILT_IN_GRANTS.ADMIN[p]).toBe("COMPANY")
        for (const role of Object.values(BUILT_IN_GRANTS)) expect((role as Record<string, unknown>)["clients.manage"]).toBeUndefined()
        expect(BUILT_IN_GRANTS.TEAM_LEADER["clients.edit"]).toBeUndefined()
    })
})

describe("the clients routes, each part alone", () => {
    it("adds a client with clients.create, and not with the others", async () => {
        signIn(viewAnd("clients.edit", "clients.delete"))
        expect((await add()).status).toBe(403)
        signIn(viewAnd("clients.create"))
        expect((await add()).status).toBe(201)
    })

    it("edits one with clients.edit, and not with the others", async () => {
        signIn(viewAnd("clients.create", "clients.delete"))
        expect((await edit()).status).toBe(403)
        signIn(viewAnd("clients.edit"))
        expect((await edit()).status).toBe(200)
    })

    it("deletes or archives one with clients.delete, and not with the others", async () => {
        signIn(viewAnd("clients.create", "clients.edit"))
        expect((await remove()).status).toBe(403)
        signIn(viewAnd("clients.delete"))
        expect((await remove()).status).toBe(200)
    })

    it("restores one from the archive with clients.delete, since it undoes archiving, and not with clients.edit", async () => {
        signIn(viewAnd("clients.create", "clients.edit"))
        expect((await restore()).status).toBe(403)
        signIn(viewAnd("clients.delete"))
        expect((await restore()).status).toBe(200)
    })

    it("says whether deleting archives instead only to whoever may delete", () => {
        const route = readFileSync("app/api/clients/route.ts", "utf8")
        expect(route).toContain(`const deletes = can(session.user, "clients.delete")`)
        expect(route).not.toContain("clients.manage")
    })

    // The service asks again behind each, so a route's own check is read from it.
    it("asks each route's own question before the service's", () => {
        const route = readFileSync("app/api/clients/route.ts", "utf8")
        expect(route).toContain(`if (!can(session.user, "clients.create")) {`)
        expect(route).toContain(`if (!can(session.user, "clients.edit") && !can(session.user, "clients.delete")) {`)
        expect(route).toContain(`if (!can(session.user, validation.data.restore ? "clients.delete" : "clients.edit")) {`)
        expect(route.slice(route.indexOf("export const DELETE"))).toContain(`if (!can(session.user, "clients.delete")) {`)
    })
})

describe("the clients service, behind the routes", () => {
    const as = (grants: Grants) => ({ user: stepUpConfirmed(holding(grants)) })
    const service = async () => (await import("@/lib/services/client.service")).ClientService

    it("edits only with clients.edit", async () => {
        await expect((await service()).update({ id: "v-1", name: "Renamed" } as never, as(viewAnd("clients.create", "clients.delete")))).rejects.toThrow("FORBIDDEN")
    })

    it("deletes, archives and restores only with clients.delete", async () => {
        await expect((await service()).delete("v-1", as(viewAnd("clients.create", "clients.edit")))).rejects.toThrow("FORBIDDEN")
        await expect((await service()).delete("v-1", as(viewAnd("clients.create", "clients.edit")), { archive: true })).rejects.toThrow("FORBIDDEN")
        await expect((await service()).restore("v-1", as(viewAnd("clients.create", "clients.edit")))).rejects.toThrow("FORBIDDEN")
    })
})

describe("the responsible accountant", () => {
    it("is picked with clients.edit", async () => {
        const { accountantCandidates } = await import("@/lib/services/client-accountant.service")
        await expect(accountantCandidates(holding(viewAnd("clients.create", "clients.delete")), "v-1")).rejects.toThrow("CLIENTS_EDIT_REQUIRED")
        await expect(accountantCandidates(holding(viewAnd("clients.edit")), "v-1")).resolves.toEqual({ people: [] })
        const route = readFileSync("app/api/clients/accountant/route.ts", "utf8")
        expect(route.match(/\{ permission: "clients\.edit" \}/g)).toHaveLength(2)
        expect(readFileSync("lib/api-errors.ts", "utf8")).toContain(`CLIENTS_EDIT_REQUIRED: { status: 403, message: "You may not edit clients." },`)
    })
})

describe("the screens", () => {
    it("on a client's page, offers Restore to whoever may delete, and the accountant's select to whoever may edit", () => {
        const page = readFileSync("app/(dashboard)/dashboard/clients/[id]/page.tsx", "utf8")
        expect(page).toContain("? can('clients.delete') && <Button variant=\"primary\" icon={ArrowCounterClockwiseIcon}")
        expect(page).toContain("picks={can('clients.edit')}")
        expect(page).not.toContain("clients.manage")
    })

    it("names each part in both languages, and keeps the old one's name for the audit log", () => {
        expect([en.perm_clients_create, en.perm_clients_edit, en.perm_clients_delete]).toEqual(["Add clients", "Edit clients and pick their accountant", "Delete, archive and restore clients"])
        expect([ar.perm_clients_create, ar.perm_clients_edit, ar.perm_clients_delete]).toEqual(["إضافة العملاء", "تعديل العملاء واختيار المحاسب المسؤول", "حذف العملاء وأرشفتهم واستعادتهم"])
        expect(en.perm_clients_manage).toBe("Manage clients")
    })

    it("lists each part, with its routes, in the roles plan", () => {
        const plan = readFileSync("ROLES_PLAN.md", "utf8")
        const row = (p: string) => plan.split("\n").find(l => l.startsWith("|") && l.includes(`\`${p}\` |`))
        expect(row("clients.create")).toContain("`POST /clients`")
        expect(row("clients.edit")).toContain("`PUT /clients`")
        expect(row("clients.edit")).toContain("`/clients/accountant`")
        expect(row("clients.delete")).toContain("`DELETE /clients`")
        expect(row("clients.manage")).toContain("Retired (#386): split into the three above")
    })
})
