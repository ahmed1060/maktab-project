import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { PERMISSIONS, CATALOGUE_VERSION } from "@/lib/permissions/catalogue"
import { encodeGrants, type Grants } from "@/lib/permissions/grants"
import { PERMISSION_GROUPS } from "@/lib/permissions/matrix"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { stepUpConfirmed } from "@/lib/permissions/test-actors"
import { state, prismaMock as clientsPrisma, withBody } from "@/lib/permissions/client-access.harness"
import { listActions } from "@/lib/saved-lists"
import { shows } from "@/lib/side-bar"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

vi.setConfig({ testTimeout: 120_000 })

/**
 * lists.manage split by what it does (LATER_CHANGES_PLAN.md §2, PR 379):
 * - lists.rename renames a name;
 * - lists.merge merges a name into another of its list;
 * - lists.archive archives a name, and restores it.
 * Adding one stays lists.add, and none of the three includes it, as none
 * needs it. The Saved lists page opens for whoever holds any of the three.
 *
 * A role still holding lists.manage is read as holding all three, until the
 * grant for companies already there. The real route and service run, as an
 * Admin of the first company holding one part and not the others.
 */

/** The first company's cost names: two to merge, and one archived. */
const ENTRIES: Record<string, any> = {
    transport: { id: "transport", companyId: "c1", kind: "COST_NAME", name: "Transport", archivedAt: null },
    lower: { id: "lower", companyId: "c1", kind: "COST_NAME", name: "transport ", archivedAt: null },
    fuel: { id: "fuel", companyId: "c1", kind: "COST_NAME", name: "Fuel", archivedAt: new Date(0) },
}
/** What was changed: nothing, when refused. */
let written: Record<string, unknown>[] = []
const listEntry = {
    findUnique: async ({ where }: any) => (ENTRIES[where.id] ? { ...ENTRIES[where.id] } : null),
    findUniqueOrThrow: async ({ where }: any) => ({ ...ENTRIES[where.id] }),
    findMany: async () => Object.values(ENTRIES).map(e => ({ id: e.id, name: e.name, archivedAt: e.archivedAt, _count: { tasks: 0, costs: 0 } })),
    update: async ({ where, data }: any) => { written.push({ id: where.id, ...data }); return { id: where.id, name: data.name ?? ENTRIES[where.id].name } },
    delete: async ({ where }: any) => { written.push({ deleted: where.id }); return ENTRIES[where.id] },
    create: async ({ data }: any) => { written.push({ added: data.name }); return { id: "new", name: data.name } },
}
const prismaMock: any = new Proxy({}, {
    get(_t, prop: string) {
        if (prop === "listEntry") return listEntry
        if (prop === "task" || prop === "taskCost") return { updateMany: async () => ({ count: 0 }) }
        if (prop === "auditLog") return { create: async () => ({}) }
        if (prop === "$transaction") return async (fn: any) => (typeof fn === "function" ? fn(prismaMock) : Promise.all(fn))
        if (prop === "$queryRaw") return async (sql: TemplateStringsArray, ...values: any[]) => {
            const text = sql.join("?")
            if (text.includes("pg_advisory")) return [{}]
            if (text.includes('FROM "ListEntry" WHERE id = ')) return ENTRIES[values[0]] ? [{ id: values[0] }] : []
            return []
        }
        return clientsPrisma[prop]
    },
})

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

const PARTS = ["lists.rename", "lists.merge", "lists.archive"] as const
type Part = typeof PARTS[number]

const actor = (grants: Grants) => ({ id: "admin", role: "ADMIN", companyId: "c1", grants: encodeGrants(grants) })
const signIn = (grants: Grants) => { state.session = { user: stepUpConfirmed(actor(grants)) } }
const holding = (...parts: Part[]): Grants => Object.fromEntries(parts.map(p => [p, "COMPANY"]))
const allBut = (part: Part) => holding(...PARTS.filter(p => p !== part))

const route = () => import("@/app/api/lists/route")
const put = async (body: Record<string, unknown>) => (await route()).PUT(withBody("PUT", "/api/lists", body), { params: {} })
const rename = () => put({ id: "transport", name: "Transport costs" })
const merge = () => put({ id: "lower", into: "transport" })
const archive = () => put({ id: "transport", archived: true })
const restore = () => put({ id: "fuel", archived: false })
const page = async () => (await route()).GET(new Request("http://localhost/api/lists?kind=COST_NAME&manage=1"), { params: {} })
const add = async () => (await route()).POST(withBody("POST", "/api/lists", { kind: "COST_NAME", name: "Parking" }), { params: {} })

beforeEach(() => { written = [] })

describe("the catalogue", () => {
    it("has the three, each with a code of its own, for the company, and none high-risk", () => {
        expect(PARTS.map(p => PERMISSIONS[p].code)).toEqual([82, 83, 84])
        for (const p of PARTS) {
            expect(PERMISSIONS[p]).toMatchObject({ module: "TASKS", scopes: ["COMPANY"] })
            expect((PERMISSIONS[p] as { highRisk?: string }).highRisk, p).toBeUndefined()
        }
    })

    it("includes adding in none of them, as none needs it", () => {
        for (const p of PARTS) expect((PERMISSIONS[p] as { implies?: readonly string[] }).implies, p).toBeUndefined()
    })

    it("offers the three in the role editor beside Add list names, and lists.manage no more", () => {
        const group = PERMISSION_GROUPS.find(g => g.permissions.includes("lists.add"))!.permissions
        expect(group.filter(p => p.startsWith("lists."))).toEqual(["lists.add", ...PARTS])
        expect(PERMISSION_GROUPS.flatMap(g => g.permissions)).not.toContain("lists.manage")
    })

    it("goes up a version, so every session reloads its grants once", () => {
        // 9 for this split; 10 since charges.set (PR 380).
        expect(CATALOGUE_VERSION).toBeGreaterThanOrEqual(9)
    })

    it("seeds the built-in Admin with the three, and nobody with lists.manage; everyone adds, as before", () => {
        for (const p of PARTS) {
            expect(BUILT_IN_GRANTS.ADMIN[p], p).toBe("COMPANY")
            expect(BUILT_IN_GRANTS.TEAM_LEADER[p], p).toBeUndefined()
            expect(BUILT_IN_GRANTS.EMPLOYEE[p], p).toBeUndefined()
        }
        for (const role of Object.values(BUILT_IN_GRANTS)) {
            expect((role as Record<string, unknown>)["lists.manage"]).toBeUndefined()
            expect(role["lists.add"]).toBe("COMPANY")
        }
    })
})

describe("changing a name, each part alone", () => {
    it("renames one with lists.rename, and not with the others", async () => {
        signIn(allBut("lists.rename"))
        expect((await rename()).status).toBe(403)
        expect(written).toEqual([])
        signIn(holding("lists.rename"))
        expect((await rename()).status).toBe(200)
        expect(written).toEqual([{ id: "transport", name: "Transport costs" }])
    })

    it("merges one into another with lists.merge, and not with the others", async () => {
        signIn(allBut("lists.merge"))
        expect((await merge()).status).toBe(403)
        expect(written).toEqual([])
        signIn(holding("lists.merge"))
        expect((await merge()).status).toBe(200)
        expect(written).toEqual([{ deleted: "lower" }])
    })

    it("archives one with lists.archive, and not with the others", async () => {
        signIn(allBut("lists.archive"))
        expect((await archive()).status).toBe(403)
        expect(written).toEqual([])
        signIn(holding("lists.archive"))
        expect((await archive()).status).toBe(200)
        expect(written[0]).toMatchObject({ id: "transport" })
        expect(written[0].archivedAt).toBeInstanceOf(Date)
    })

    it("restores one with lists.archive, and not with the others", async () => {
        signIn(allBut("lists.archive"))
        expect((await restore()).status).toBe(403)
        signIn(holding("lists.archive"))
        expect((await restore()).status).toBe(200)
        expect(written).toEqual([{ id: "fuel", archivedAt: null }])
    })

    it("refuses whoever holds none of them before reading the change", async () => {
        signIn({ "lists.add": "COMPANY" })
        for (const change of [rename, merge, archive, restore]) expect((await change()).status).toBe(403)
        expect((await put({ nonsense: true })).status).toBe(403)
        expect(written).toEqual([])
    })

})

describe("the Saved lists page", () => {
    it("lists the names for whoever holds any part, and nobody else", async () => {
        for (const part of PARTS) {
            signIn(holding(part))
            expect((await page()).status, part).toBe(200)
        }
        signIn({ "lists.add": "COMPANY" })
        expect((await page()).status).toBe(403)
    })

    it("opens for whoever holds any part, in the side bar and on the page", () => {
        const viewer = (held: string) => ({ superAdmin: false, can: (p: string) => p === held, has: () => true, checkIn: false, companySettings: false, cashAdvances: false })
        for (const part of PARTS) expect(shows("savedLists", viewer(part)), part).toBe(true)
        expect(shows("savedLists", viewer("lists.add"))).toBe(false)
        const source = stripComments(readFileSync("app/(dashboard)/dashboard/lists/page.tsx", "utf8"))
        expect(source).toContain("if (session?.user && !(can('lists.rename') || can('lists.merge') || can('lists.archive'))) return <AccessDenied />")
    })

    it("offers adding only to whoever adds, as no part includes it", async () => {
        const source = stripComments(readFileSync("app/(dashboard)/dashboard/lists/page.tsx", "utf8"))
        expect(source).toContain("action={can('lists.add') && <Button variant=\"primary\" icon={PlusIcon} onClick={() => setAdding(true)}>{t('lists_add_name')}</Button>}")
        expect(source).toContain("<SavedLists adding={adding && can('lists.add')} onAddingChange={setAdding} />")
        signIn(holding(...PARTS))
        expect((await add()).status).toBe(403)
        signIn({ "lists.add": "COMPANY" })
        expect((await add()).status).toBe(201)
    })
})

describe("the row menu", () => {
    const inUse = { archived: false }
    const archived = { archived: true }
    const all = { rename: true, merge: true, archive: true }
    const only = (part: "rename" | "merge" | "archive") => ({ rename: false, merge: false, archive: false, [part]: true })

    it("offers each part's own, and all three to whoever holds them, as before", () => {
        expect(listActions(inUse, only("rename"))).toEqual(["rename"])
        expect(listActions(inUse, only("merge"))).toEqual(["merge"])
        expect(listActions(inUse, only("archive"))).toEqual(["archive"])
        expect(listActions(inUse, all)).toEqual(["rename", "merge", "archive"])
    })

    it("offers an archived one Restore, with lists.archive alone", () => {
        expect(listActions(archived, only("archive"))).toEqual(["restore"])
        expect(listActions(archived, { ...all, archive: false })).toEqual([])
    })

    it("is offered only where there's something in it", () => {
        const list = stripComments(readFileSync("components/lists/SavedLists.tsx", "utf8"))
        expect(list).toContain("const may = { rename: can('lists.rename'), merge: can('lists.merge'), archive: can('lists.archive') }")
        expect(list).toContain("listActions(n, may).map(action => item(n, action))")
        expect(list).toMatch(/const actions = \(n: Name\) => menu\(n\)\.length > 0 && \(/)
        expect(list).not.toContain("lists.manage")
    })
})

describe("the words", () => {
    it("name each part in both languages", () => {
        expect(en.perm_lists_rename).toBe("Rename list names")
        expect(en.perm_lists_merge).toBe("Merge list names")
        expect(en.perm_lists_archive).toBe("Archive and restore list names")
        expect(ar.perm_lists_rename).toBe("إعادة تسمية الأسماء في القوائم")
        expect(ar.perm_lists_merge).toBe("دمج الأسماء في القوائم")
        expect(ar.perm_lists_archive).toBe("أرشفة الأسماء في القوائم واستعادتها")
    })
})
