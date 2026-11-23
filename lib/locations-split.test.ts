import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { PERMISSIONS, CATALOGUE_VERSION, splitParts, isSplit, type Permission } from "@/lib/permissions/catalogue"
import { normalizeGrants, grantsFromRows } from "@/lib/permissions/grant-rules"
import { encodeGrants, type Grants } from "@/lib/permissions/grants"
import { can } from "@/lib/permissions/can"
import { PERMISSION_GROUPS } from "@/lib/permissions/matrix"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { holdersOf } from "@/lib/permissions/holders"
import { stepUpConfirmed } from "@/lib/permissions/test-actors"
import { state, prismaMock as clientsPrisma, withBody } from "@/lib/permissions/client-access.harness"
import { locationActions } from "@/lib/locations"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

vi.setConfig({ testTimeout: 120_000 })

/**
 * locations.manage split by what it does (LATER_CHANGES_PLAN.md §2, PR 377).
 * Adding one has had its own permission since the Locations page,
 * locations.add (locations.create since PR 378), so it stays, and
 * locations.manage is two:
 * - locations.edit changes one's name, pin and radius, makes one its
 *   client's HQ, and changes a client's HQ in the client form;
 * - locations.archive archives one, and restores it.
 *
 * Each is for the company, as locations.manage was. A role still holding
 * locations.manage is read as holding both, until the grant for companies
 * already there. The real route and service run, as an Admin of the first
 * company holding one part and not the other.
 */

/** The first company's locations: a client's branch, its HQ, and an archived one. */
const LOCATIONS: Record<string, any> = {
    branch: { id: "branch", companyId: "c1", clientId: "v-1", name: "Maadi branch", isHq: false, latitude: 30, longitude: 31, radiusMeters: null, archivedAt: null },
    hq: { id: "hq", companyId: "c1", clientId: "v-1", name: "Head office", isHq: true, latitude: 30.1, longitude: 31.1, radiusMeters: null, archivedAt: null },
    old: { id: "old", companyId: "c1", clientId: "v-1", name: "Old site", isHq: false, latitude: 30.2, longitude: 31.2, radiusMeters: null, archivedAt: new Date(0) },
}
const row = (id: string) => LOCATIONS[id] && { ...LOCATIONS[id], createdAt: new Date(0), client: { id: "v-1", name: "Client one" }, company: { name: "c1" } }
/** What was written to a location: nothing, when refused. */
let written: Record<string, unknown>[] = []
const locationModel = {
    findUnique: async ({ where }: any) => row(where.id) ?? null,
    findFirst: async ({ where }: any) => (where.isHq ? row("hq") : null),
    update: async ({ where, data }: any) => { written.push({ id: where.id, ...data }); return row(where.id) },
    updateMany: async () => ({ count: 0 }),
    create: async ({ data }: any) => { written.push({ created: true, ...data }); return { id: "new" } },
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

const PARTS = ["locations.edit", "locations.archive"] as const
type Part = typeof PARTS[number]

const actor = (grants: Grants) => ({ id: "admin", role: "ADMIN", companyId: "c1", grants: encodeGrants(grants) })
const signIn = (grants: Grants) => { state.session = { user: stepUpConfirmed(actor(grants)) } }
const holding = (...parts: Part[]): Grants => Object.fromEntries([["locations.view", "COMPANY"], ["locations.create", "COMPANY"], ...parts.map(p => [p, "COMPANY"])])
const OLD_ROLE = grantsFromRows([{ permission: "locations.view", scope: "COMPANY" }, { permission: "locations.manage", scope: "COMPANY" }])

const put = async (body: Record<string, unknown>) => (await import("@/app/api/locations/route")).PUT(withBody("PUT", "/api/locations", body), { params: {} })
const edit = () => put({ id: "branch", name: "Maadi", latitude: 30.05, longitude: 31.25, radiusMeters: 150 })
const makeHq = () => put({ id: "branch", hq: true })
const archive = () => put({ id: "branch", archived: true })
const restore = () => put({ id: "old", archived: false })
/** Restoring one and making it the HQ, at once: both parts. */
const restoreAsHq = () => put({ id: "old", archived: false, hq: true })

beforeEach(() => { written = [] })

describe("the catalogue", () => {
    it("has locations.edit and locations.archive, each with a code of its own, for the company, and neither high-risk", () => {
        expect(PARTS.map(p => PERMISSIONS[p].code)).toEqual([79, 80])
        for (const p of PARTS) {
            expect(PERMISSIONS[p]).toMatchObject({ module: "CLIENTS", scopes: ["COMPANY"], implies: ["locations.view"] })
            expect((PERMISSIONS[p] as { highRisk?: string }).highRisk, p).toBeUndefined()
        }
    })

    it("marks locations.manage as split into the two, and keeps adding apart", () => {
        expect(splitParts("locations.manage")).toEqual(PARTS)
        expect((Object.keys(PERMISSIONS) as Permission[]).filter(isSplit)).toContain("locations.manage")
        // locations.add, named locations.create since PR 378 (lib/locations-create.test.ts).
        expect(splitParts("locations.add")).not.toContain("locations.edit")
        expect(PERMISSIONS["locations.add"].code).toBe(56)
    })

    it("offers the two in the role editor beside See and Add locations, and locations.manage no more", () => {
        const group = PERMISSION_GROUPS.find(g => g.key === "clients")!.permissions
        for (const p of ["locations.view", "locations.create", ...PARTS] as Permission[]) expect(group).toContain(p)
        expect(PERMISSION_GROUPS.flatMap(g => g.permissions)).not.toContain("locations.manage")
    })

    it("goes up a version, so every session reloads its grants once", () => {
        // 7 for this split; 8 since locations.create (PR 378).
        expect(CATALOGUE_VERSION).toBeGreaterThanOrEqual(7)
    })

    it("seeds the built-in Admin with both, and nobody with locations.manage; the Team Leader adds, as before", () => {
        for (const p of PARTS) {
            expect(BUILT_IN_GRANTS.ADMIN[p], p).toBe("COMPANY")
            expect(BUILT_IN_GRANTS.TEAM_LEADER[p], p).toBeUndefined()
            expect(BUILT_IN_GRANTS.EMPLOYEE[p], p).toBeUndefined()
        }
        expect(BUILT_IN_GRANTS.TEAM_LEADER["locations.create"]).toBe("COMPANY")
        for (const role of Object.values(BUILT_IN_GRANTS)) expect(role["locations.manage"]).toBeUndefined()
    })
})

describe("a role still holding locations.manage", () => {
    it("is read as holding both, and not the old one", () => {
        for (const p of PARTS) expect(OLD_ROLE[p], p).toBe("COMPANY")
        expect(OLD_ROLE["locations.manage"]).toBeUndefined()
    })

    it("is saved as the two, for a role or a template that still names it", () => {
        const verdict = normalizeGrants([{ permission: "locations.manage", scope: "COMPANY" }])
        expect(verdict.ok).toBe(true)
        if (verdict.ok) {
            for (const p of PARTS) expect(verdict.grants[p], p).toBe("COMPANY")
            expect(verdict.grants["locations.manage"]).toBeUndefined()
        }
    })

    it("is found when asking who holds a part", () => {
        expect(holdersOf("locations.archive", "COMPANY")).toEqual({ assignedRole: { grants: { some: { permission: { in: ["locations.archive", "locations.manage"] }, scope: "COMPANY" } } } })
    })

    it("gives a session made from it both parts", () => {
        const user = actor(OLD_ROLE)
        for (const p of PARTS) expect(can(user, p, { companyId: "c1" }), p).toBe(true)
    })
})

describe("changing a location, each part alone", () => {
    it("edits its name, pin and radius with locations.edit, and not with locations.archive", async () => {
        signIn(holding("locations.archive"))
        expect((await edit()).status).toBe(403)
        expect(written).toEqual([])
        signIn(holding("locations.edit"))
        expect((await edit()).status).toBe(200)
        expect(written[0]).toMatchObject({ id: "branch", name: "Maadi", radiusMeters: 150 })
    })

    it("asks locations.edit for each detail alone: its name, its pin, or its radius", async () => {
        for (const detail of [{ name: "Maadi" }, { latitude: 30.05, longitude: 31.25 }, { radiusMeters: 150 }, { radiusMeters: null }]) {
            signIn(holding("locations.archive"))
            expect((await put({ id: "branch", ...detail })).status, JSON.stringify(detail)).toBe(403)
            signIn(holding("locations.edit"))
            expect((await put({ id: "branch", ...detail })).status, JSON.stringify(detail)).toBe(200)
        }
        expect(written).toHaveLength(4)
    })

    it("asks locations.edit too for a detail changed while archiving, so archiving moves nothing", async () => {
        signIn(holding("locations.archive"))
        for (const detail of [{ name: "Maadi" }, { latitude: 30.05, longitude: 31.25 }, { radiusMeters: 150 }, { hq: true }]) {
            expect((await put({ id: "old", archived: false, ...detail })).status, JSON.stringify(detail)).toBe(403)
        }
        expect(written).toEqual([])
    })

    it("makes one its client's HQ with locations.edit, and not with locations.archive", async () => {
        signIn(holding("locations.archive"))
        expect((await makeHq()).status).toBe(403)
        expect(written).toEqual([])
        signIn(holding("locations.edit"))
        expect((await makeHq()).status).toBe(200)
        expect(written.at(-1)).toMatchObject({ id: "branch", isHq: true })
    })

    it("archives one with locations.archive, and not with locations.edit", async () => {
        signIn(holding("locations.edit"))
        expect((await archive()).status).toBe(403)
        expect(written).toEqual([])
        signIn(holding("locations.archive"))
        expect((await archive()).status).toBe(200)
        expect(written[0]).toMatchObject({ id: "branch" })
        expect(written[0].archivedAt).toBeInstanceOf(Date)
    })

    it("restores one with locations.archive, and not with locations.edit", async () => {
        signIn(holding("locations.edit"))
        expect((await restore()).status).toBe(403)
        signIn(holding("locations.archive"))
        expect((await restore()).status).toBe(200)
        expect(written[0]).toMatchObject({ id: "old", archivedAt: null })
    })

    it("asks for both when a change is both", async () => {
        for (const part of PARTS) {
            signIn(holding(part))
            expect((await restoreAsHq()).status, part).toBe(403)
        }
        expect(written).toEqual([])
        signIn(holding(...PARTS))
        expect((await restoreAsHq()).status).toBe(200)
    })

    it("refuses whoever holds neither before reading the change", async () => {
        signIn(holding())
        expect((await put({ id: "branch" })).status).toBe(403)
        expect((await put({ nonsense: true })).status).toBe(403)
    })

    it("lets a role still holding locations.manage do all of it", async () => {
        signIn(OLD_ROLE)
        for (const change of [edit, makeHq, archive, restore, restoreAsHq]) expect((await change()).status).toBe(200)
    })

    it("still adds one with its own permission alone, locations.create since PR 378", () => {
        const route = stripComments(readFileSync("app/api/locations/route.ts", "utf8"))
        expect(route).toMatch(/LocationService\.create\(session, validation\.data\), 201\)\n\}, \{ permission: "locations\.create" \}\)/)
    })
})

describe("a client's HQ, changed in the client form", () => {
    const client = { id: "v-1", companyId: "c1" }
    const moved = { name: "Head office", latitude: 30.3, longitude: 31.3 }
    const asItIs = { name: "Head office", latitude: 30.1, longitude: 31.1 }
    const save = async (grants: Grants, place: typeof moved) => {
        const { LocationService } = await import("@/lib/services/location.service")
        return LocationService.saveHq(prismaMock, client, place, { user: actor(grants) })
    }

    it("is changed with locations.edit, and not with locations.archive", async () => {
        await expect(save(holding("locations.archive"), moved)).rejects.toMatchObject({ message: "TASK_LOCATION_FORBIDDEN" })
        expect(written).toEqual([])
        await save(holding("locations.edit"), moved)
        expect(written[0]).toMatchObject({ id: "hq", latitude: 30.3 })
    })

    it("is kept as it is by whoever may only edit the client", async () => {
        await save(holding(), asItIs)
        expect(written[0]).toMatchObject({ id: "hq", ...asItIs })
    })

    it("is locked in the form for whoever may not edit locations", () => {
        const page = stripComments(readFileSync("app/(dashboard)/dashboard/clients/page.tsx", "utf8"))
        expect(page).toContain("const hqLocked = !!client?.locations?.[0] && !can('locations.edit')")
    })
})

describe("the Locations list's row menu", () => {
    const branch = { archivedAt: null, isHq: false, client: { id: "v-1" } }
    const hq = { ...branch, isHq: true }
    const shared = { ...branch, client: null }
    const archived = { ...branch, archivedAt: "2026-11-01" }
    const both = { edit: true, archive: true }

    it("offers editing and making it the HQ with locations.edit", () => {
        expect(locationActions(branch, { edit: true, archive: false })).toEqual(["edit", "hq"])
    })

    it("offers archiving with locations.archive, and restoring an archived one", () => {
        expect(locationActions(branch, { edit: false, archive: true })).toEqual(["archive"])
        expect(locationActions(archived, { edit: false, archive: true })).toEqual(["restore"])
        expect(locationActions(archived, { edit: true, archive: false })).toEqual([])
    })

    it("offers all three to whoever holds both, as before", () => {
        expect(locationActions(branch, both)).toEqual(["edit", "hq", "archive"])
    })

    it("never archives a client's HQ, nor makes a shared one an HQ", () => {
        expect(locationActions(hq, both)).toEqual(["edit"])
        expect(locationActions(hq, { edit: false, archive: true })).toEqual([])
        expect(locationActions(shared, both)).toEqual(["edit", "archive"])
    })

    it("is offered only where there's something in it", () => {
        const list = stripComments(readFileSync("components/locations/LocationsList.tsx", "utf8"))
        expect(list).toContain("const canEdit = can('locations.edit')")
        expect(list).toContain("const canArchive = can('locations.archive')")
        expect(list).toContain("locationActions(l, { edit: canEdit, archive: canArchive })")
        expect(list).toContain("const changes = canEdit || canArchive")
        expect(list).toMatch(/const actions = \(l: LocationItem\) => menu\(l\)\.length > 0 && \(/)
        expect(list).toContain("...(changes ? [{ key: 'actions'")
        expect(list).toContain("foot={changes ? <>{actions(l)}</> : undefined}")
        expect(list).not.toContain("locations.manage")
    })
})

describe("the words", () => {
    it("name each part in both languages", () => {
        expect(en.perm_locations_edit).toBe("Edit locations and pick a client's HQ")
        expect(en.perm_locations_archive).toBe("Archive and restore locations")
        expect(ar.perm_locations_edit).toBe("تعديل المواقع واختيار المقر الرئيسي للعميل")
        expect(ar.perm_locations_archive).toBe("أرشفة المواقع واستعادتها")
    })
})
