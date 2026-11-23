import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { PERMISSIONS, CATALOGUE_VERSION, splitParts, isSplit } from "@/lib/permissions/catalogue"
import { normalizeGrants, grantsFromRows } from "@/lib/permissions/grant-rules"
import { encodeGrants, type Grants } from "@/lib/permissions/grants"
import { can } from "@/lib/permissions/can"
import { PERMISSION_GROUPS } from "@/lib/permissions/matrix"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { holdersOf } from "@/lib/permissions/holders"
import { stepUpConfirmed } from "@/lib/permissions/test-actors"
import { state, prismaMock as clientsPrisma, withBody } from "@/lib/permissions/client-access.harness"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

vi.setConfig({ testTimeout: 120_000 })

/**
 * locations.add renamed locations.create (LATER_CHANGES_PLAN.md §2, PR 378),
 * as the owner asked, to match the other areas' adding. It's done as a split
 * into one, with the splits' own machinery: locations.add stays in the
 * catalogue, split into locations.create, so a role still holding it holds
 * locations.create, and nobody loses access until the grant for companies
 * already there rewrites the rows. The real route and service run.
 */

const added: Record<string, any> = {}
const locationModel = {
    findUnique: async ({ where }: any) => (added[where.id] ? { ...added[where.id], createdAt: new Date(0), client: null, company: { name: "c1" } } : null),
    findFirst: async () => null,
    create: async ({ data }: any) => { added.new = { id: "new", ...data }; return { id: "new" } },
}
const prismaMock: any = new Proxy({}, {
    get(_t, prop: string) {
        if (prop === "location") return locationModel
        if (prop === "$transaction") return async (fn: any) => (typeof fn === "function" ? fn(prismaMock) : Promise.all(fn))
        return clientsPrisma[prop]
    },
})

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

const actor = (grants: Grants) => ({ id: "admin", role: "ADMIN", companyId: "c1", grants: encodeGrants(grants) })
const signIn = (grants: Grants) => { state.session = { user: stepUpConfirmed(actor(grants)) } }
const SEES = { "locations.view": "COMPANY" } as Grants
/** A role saved before PR 378, still holding the old name. */
const OLD_ROLE = grantsFromRows([{ permission: "locations.view", scope: "COMPANY" }, { permission: "locations.add", scope: "COMPANY" }])

const add = async () => (await import("@/app/api/locations/route")).POST(withBody("POST", "/api/locations", { name: "Shared yard", latitude: 30.05, longitude: 31.25 }), { params: {} })

beforeEach(() => { delete added.new })

describe("the catalogue", () => {
    it("has locations.create, with a code of its own, for the company, including See locations, and not high-risk", () => {
        expect(PERMISSIONS["locations.create"].code).toBe(81)
        expect(PERMISSIONS["locations.create"]).toMatchObject({ module: "CLIENTS", scopes: ["COMPANY"], implies: ["locations.view"] })
        expect((PERMISSIONS["locations.create"] as { highRisk?: string }).highRisk).toBeUndefined()
    })

    it("keeps locations.add, split into locations.create alone, its code kept until it's retired", () => {
        expect(splitParts("locations.add")).toEqual(["locations.create"])
        expect(isSplit("locations.add")).toBe(true)
        expect(PERMISSIONS["locations.add"].code).toBe(56)
    })

    it("offers locations.create in the role editor, where Add locations was, and locations.add no more", () => {
        const group = PERMISSION_GROUPS.find(g => g.key === "clients")!.permissions
        const all = PERMISSION_GROUPS.flatMap(g => g.permissions)
        expect(group.filter(p => p.startsWith("locations."))).toEqual(["locations.view", "locations.create", "locations.edit", "locations.archive"])
        expect(all).not.toContain("locations.add")
    })

    it("goes up a version, so every session reloads its grants once and holds the new name", () => {
        expect(CATALOGUE_VERSION).toBe(8)
    })

    it("seeds the built-in Admin and Team Leader with locations.create, and nobody with locations.add", () => {
        expect(BUILT_IN_GRANTS.ADMIN["locations.create"]).toBe("COMPANY")
        expect(BUILT_IN_GRANTS.TEAM_LEADER["locations.create"]).toBe("COMPANY")
        expect(BUILT_IN_GRANTS.EMPLOYEE["locations.create"]).toBeUndefined()
        for (const role of Object.values(BUILT_IN_GRANTS)) expect(role["locations.add"]).toBeUndefined()
    })
})

describe("a role still holding locations.add", () => {
    it("is read as holding locations.create, and not the old name", () => {
        expect(OLD_ROLE["locations.create"]).toBe("COMPANY")
        expect(OLD_ROLE["locations.add"]).toBeUndefined()
    })

    it("is saved as locations.create, for a role or a template that still names it", () => {
        const verdict = normalizeGrants([{ permission: "locations.add", scope: "COMPANY" }])
        expect(verdict.ok).toBe(true)
        if (verdict.ok) {
            expect(verdict.grants["locations.create"]).toBe("COMPANY")
            expect(verdict.grants["locations.add"]).toBeUndefined()
        }
    })

    it("is found when asking who may add locations", () => {
        expect(holdersOf("locations.create", "COMPANY")).toEqual({ assignedRole: { grants: { some: { permission: { in: ["locations.create", "locations.add"] }, scope: "COMPANY" } } } })
    })

    it("gives a session made from it locations.create", () => {
        expect(can(actor(OLD_ROLE), "locations.create", { companyId: "c1" })).toBe(true)
    })
})

describe("adding a location", () => {
    it("asks locations.create, on the route and in the service", async () => {
        signIn(SEES)
        expect((await add()).status).toBe(403)
        expect(added.new).toBeUndefined()
        signIn({ ...SEES, "locations.create": "COMPANY" })
        expect((await add()).status).toBe(201)
        expect(added.new).toMatchObject({ name: "Shared yard", companyId: "c1", clientId: null })
    })

    it("is still open to a role saved with locations.add", async () => {
        signIn(OLD_ROLE)
        expect((await add()).status).toBe(201)
    })

    it("is offered by its new name on every screen that offered it", () => {
        const screens: [string, string[]][] = [
            ["app/(dashboard)/dashboard/locations/page.tsx", ["action={can('locations.create') && <Button", "adding={adding && can('locations.create')}"]],
            ["app/(dashboard)/dashboard/clients/[id]/page.tsx", ["action={!archived && can('locations.create') && <Button", "adding={!archived && addingLocation && can('locations.create')}"]],
            ["components/locations/LocationsList.tsx", ["const canAdd = can('locations.create')"]],
            ["components/locations/TaskPlacePicker.tsx", ["{can('locations.create') && ("]],
        ]
        for (const [file, gates] of screens) {
            const source = stripComments(readFileSync(file, "utf8"))
            for (const gate of gates) expect(source, file).toContain(gate)
            expect(source, file).not.toContain("locations.add")
        }
        const service = stripComments(readFileSync("lib/services/location.service.ts", "utf8"))
        expect(service.match(/allow\(session, "locations\.create", companyId\)/g)).toHaveLength(2)
        expect(service).not.toContain("locations.add")
    })
})

describe("the words", () => {
    it("keep the name it had, in both languages", () => {
        expect(en.perm_locations_create).toBe(en.perm_locations_add)
        expect(ar.perm_locations_create).toBe(ar.perm_locations_add)
        expect(en.perm_locations_create).toBe("Add locations")
    })
})
