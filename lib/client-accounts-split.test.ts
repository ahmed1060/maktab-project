import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { PERMISSIONS, CATALOGUE_VERSION, splitParts, isSplit } from "@/lib/permissions/catalogue"
import { normalizeGrants, grantsFromRows } from "@/lib/permissions/grant-rules"
import { encodeGrants, type Grants } from "@/lib/permissions/grants"
import { can } from "@/lib/permissions/can"
import { PERMISSION_GROUPS } from "@/lib/permissions/matrix"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { holdersOf } from "@/lib/permissions/holders"
import { stepUpConfirmed } from "@/lib/permissions/test-actors"
import { isHighRisk } from "@/lib/step-up"
import { serializeAccess } from "@/lib/features/bundles"
import { personActions } from "@/lib/client-people"
import { state, prismaMock as clientsPrisma, url, withBody } from "@/lib/permissions/client-access.harness"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

vi.setConfig({ testTimeout: 120_000 })

/**
 * client_accounts.manage split by what it does (LATER_CHANGES_PLAN.md §2,
 * PR 381):
 * - client_accounts.view sees a client's people who sign in to the client
 *   portal, and how many go with it where Delete permanently names them;
 * - client_accounts.invite adds one, as invited, and sends their invitation
 *   again: it lets someone from outside the company in, so it stays
 *   high-risk and asks for the step-up code;
 * - client_accounts.remove removes one, taking their sign-in away: not
 *   high-risk, as the table keeps only inviting so.
 *
 * A role still holding client_accounts.manage is read as holding all three,
 * until the grant for companies already there. The real routes run, in a
 * company whose package has the client portal.
 */

const prismaMock: any = new Proxy({}, {
    get(_t, prop: string) {
        // Nobody's client account is there: a route that lets the request through answers "not found".
        if (prop === "clientAccount") return { findUnique: async () => null, findMany: async () => [], count: async () => 0 }
        return clientsPrisma[prop]
    },
})

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

const PARTS = ["client_accounts.view", "client_accounts.invite", "client_accounts.remove"] as const
type Part = typeof PARTS[number]

const PORTAL = serializeAccess({ unrestricted: false, bundles: new Set(["COMPANY_MANAGEMENT", "CLIENT_PORTAL"] as never[]) })
const actor = (grants: Grants) => ({ id: "admin", role: "ADMIN", companyId: "c1", grants: encodeGrants(grants), featureAccess: PORTAL })
/** Signed in holding these, the step-up code entered unless said otherwise. */
const signIn = (grants: Grants, confirmed = true) => {
    const user = stepUpConfirmed(actor(grants))
    state.session = { user: confirmed ? user : { ...user, stepUpAt: null } }
}
const holding = (...parts: Part[]): Grants => Object.fromEntries([["clients.view", "COMPANY"], ...parts.map(p => [p, "COMPANY"])])
const OLD_ROLE = grantsFromRows([{ permission: "clients.view", scope: "COMPANY" }, { permission: "client_accounts.manage", scope: "COMPANY" }])

const list = async () => (await import("@/app/api/client-accounts/route")).GET(new Request(url("/api/client-accounts?clientId=nobody")), { params: {} })
const add = async () => (await import("@/app/api/client-accounts/route")).POST(withBody("POST", "/api/client-accounts", { clientId: "nobody", name: "Mona Fouad", email: "mona@example.com" }), { params: {} })
const remove = async () => (await import("@/app/api/client-accounts/[id]/route")).DELETE(new Request(url("/api/client-accounts/someone"), { method: "DELETE" }), { params: { id: "someone" } })
const resend = async () => (await import("@/app/api/client-accounts/[id]/invitation/route")).POST(new Request(url("/api/client-accounts/someone/invitation"), { method: "POST" }), { params: { id: "someone" } })

describe("the catalogue", () => {
    it("has the three, each with a code of its own, for the company, in the client portal's module", () => {
        expect(PARTS.map(p => PERMISSIONS[p].code)).toEqual([86, 87, 88])
        for (const p of PARTS) expect(PERMISSIONS[p], p).toMatchObject({ module: "TAX_POSITION", scopes: ["COMPANY"] })
    })

    it("keeps inviting high-risk, as it lets outsiders in, and only inviting", () => {
        expect(PERMISSIONS["client_accounts.invite"]).toMatchObject({ highRisk: "Lets outsiders in" })
        expect(isHighRisk("client_accounts.invite")).toBe(true)
        expect(isHighRisk("client_accounts.view")).toBe(false)
        expect(isHighRisk("client_accounts.remove")).toBe(false)
    })

    it("has seeing include seeing clients, and inviting and removing include seeing the people", () => {
        expect(PERMISSIONS["client_accounts.view"].implies).toEqual(["clients.view"])
        expect(PERMISSIONS["client_accounts.invite"].implies).toEqual(["client_accounts.view"])
        expect(PERMISSIONS["client_accounts.remove"].implies).toEqual(["client_accounts.view"])
        const verdict = normalizeGrants([{ permission: "client_accounts.remove", scope: "COMPANY" }])
        expect(verdict.ok && verdict.grants).toEqual({ "client_accounts.remove": "COMPANY", "client_accounts.view": "COMPANY", "clients.view": "COMPANY" })
    })

    it("marks client_accounts.manage as split into the three", () => {
        expect(splitParts("client_accounts.manage")).toEqual(PARTS)
        expect(isSplit("client_accounts.manage")).toBe(true)
    })

    it("offers the three under Client portal in the role editor, and client_accounts.manage no more", () => {
        expect(PERMISSION_GROUPS.find(g => g.key === "client_portal")?.permissions).toEqual(["tax.view", "tax.manage", ...PARTS, "client_messages.manage"])
        expect(PERMISSION_GROUPS.flatMap(g => g.permissions)).not.toContain("client_accounts.manage")
    })

    it("goes up a version, so every session reloads its grants once", () => {
        expect(CATALOGUE_VERSION).toBe(11)
    })

    it("seeds the built-in Admin with the three, and nobody with client_accounts.manage", () => {
        for (const p of PARTS) {
            expect(BUILT_IN_GRANTS.ADMIN[p], p).toBe("COMPANY")
            expect(BUILT_IN_GRANTS.TEAM_LEADER[p], p).toBeUndefined()
            expect(BUILT_IN_GRANTS.EMPLOYEE[p], p).toBeUndefined()
        }
        for (const role of Object.values(BUILT_IN_GRANTS)) expect(role["client_accounts.manage"]).toBeUndefined()
    })
})

describe("a role still holding client_accounts.manage", () => {
    it("is read as holding the three", () => {
        for (const p of PARTS) expect(OLD_ROLE[p], p).toBe("COMPANY")
        expect(OLD_ROLE["client_accounts.manage"]).toBeUndefined()
    })

    it("is saved as the three, with seeing clients", () => {
        const verdict = normalizeGrants([{ permission: "client_accounts.manage", scope: "COMPANY" }])
        expect(verdict.ok).toBe(true)
        if (verdict.ok) {
            for (const p of PARTS) expect(verdict.grants[p], p).toBe("COMPANY")
            expect(verdict.grants["clients.view"]).toBe("COMPANY")
            expect(verdict.grants["client_accounts.manage"]).toBeUndefined()
        }
    })

    it("is found when asking who may invite", () => {
        expect(holdersOf("client_accounts.invite", "COMPANY")).toEqual({ assignedRole: { grants: { some: { permission: { in: ["client_accounts.invite", "client_accounts.manage"] }, scope: "COMPANY" } } } })
    })

    it("gives a session made from it each part", () => {
        for (const p of PARTS) expect(can(actor(OLD_ROLE), p, { companyId: "c1" }), p).toBe(true)
    })
})

// Let through, a request finds no such client or person: 404. Refused: 403.
describe("the routes, each part alone", () => {
    it("lists a client's people with client_accounts.view, and not without it", async () => {
        signIn(holding())
        expect((await list()).status).toBe(403)
        signIn(holding("client_accounts.view"))
        expect((await list()).status).toBe(404)
    })

    it("adds one with client_accounts.invite, and not with the others", async () => {
        signIn(holding("client_accounts.view", "client_accounts.remove"))
        expect((await add()).status).toBe(403)
        signIn(holding("client_accounts.view", "client_accounts.invite"))
        expect((await add()).status).toBe(404)
    })

    it("sends an invitation again with client_accounts.invite, and not with the others", async () => {
        signIn(holding("client_accounts.view", "client_accounts.remove"))
        expect((await resend()).status).toBe(403)
        signIn(holding("client_accounts.view", "client_accounts.invite"))
        expect((await resend()).status).toBe(404)
    })

    it("removes one with client_accounts.remove, and not with the others", async () => {
        signIn(holding("client_accounts.view", "client_accounts.invite"))
        expect((await remove()).status).toBe(403)
        signIn(holding("client_accounts.view", "client_accounts.remove"))
        expect((await remove()).status).toBe(404)
    })

    it("asks for the step-up code to add or invite again, and not to remove or list", async () => {
        signIn(holding(...PARTS), false)
        for (const ask of [add, resend]) {
            const res = await ask()
            expect(res.status).toBe(403)
            expect(await res.json()).toMatchObject({ code: "STEP_UP_REQUIRED" })
        }
        expect((await remove()).status).toBe(404)
        expect((await list()).status).toBe(404)
    })

    it("asks each part in the service too, behind the route", async () => {
        const service = await import("@/lib/services/client-account.service")
        const user = (...parts: Part[]) => actor(holding(...parts)) as never
        const person = { clientId: "nobody", name: "Mona Fouad", email: "mona@example.com" }
        const refused = { message: "CLIENT_ACCOUNTS_MANAGE_REQUIRED" }
        await expect(service.clientPeople(user(), "nobody")).rejects.toMatchObject(refused)
        await expect(service.clientPeople(user("client_accounts.view"), "nobody")).rejects.toMatchObject({ message: "CLIENT_NOT_FOUND" })
        await expect(service.addClientPerson(user("client_accounts.view", "client_accounts.remove"), person)).rejects.toMatchObject(refused)
        // Refused before what was sent is read: told it's not theirs, not what's wrong with it.
        await expect(service.addClientPerson(user("client_accounts.view", "client_accounts.remove"), {})).rejects.toMatchObject(refused)
        await expect(service.addClientPerson(user("client_accounts.view", "client_accounts.invite"), person)).rejects.toMatchObject({ message: "CLIENT_NOT_FOUND" })
        await expect(service.resendClientInvitation(user("client_accounts.view", "client_accounts.remove"), "someone")).rejects.toMatchObject(refused)
        await expect(service.resendClientInvitation(user("client_accounts.view", "client_accounts.invite"), "someone")).rejects.toMatchObject({ message: "CLIENT_PERSON_NOT_FOUND" })
        await expect(service.removeClientPerson(user("client_accounts.view", "client_accounts.invite"), "someone")).rejects.toMatchObject(refused)
        await expect(service.removeClientPerson(user("client_accounts.view", "client_accounts.remove"), "someone")).rejects.toMatchObject({ message: "CLIENT_PERSON_NOT_FOUND" })
    })

    it("lets a role still holding client_accounts.manage do all of it", async () => {
        signIn(OLD_ROLE)
        for (const ask of [list, add, resend, remove]) expect((await ask()).status).toBe(404)
    })
})

describe("the client's page", () => {
    const person = (state: "invited" | "active") => ({ state })
    const all = { invite: true, remove: true }

    it("shows its people to whoever may see them", () => {
        const page = stripComments(readFileSync("app/(dashboard)/dashboard/clients/[id]/page.tsx", "utf8"))
        expect(page).toContain("const seesPeople = features.has('TAX_POSITION') && can('client_accounts.view')")
        const clients = stripComments(readFileSync("app/api/clients/route.ts", "utf8"))
        expect(clients).toContain('const seesPeople = deletes && can(session.user, "client_accounts.view") && sessionHasModule(session, "TAX_POSITION")')
    })

    it("offers Add person to whoever may invite", () => {
        const section = stripComments(readFileSync("components/client-accounts/ClientPeople.tsx", "utf8"))
        expect(section).toContain("const may = { invite: can('client_accounts.invite'), remove: can('client_accounts.remove') }")
        expect(section).toContain("action={!archived && people && may.invite && <Button")
        expect(section).toContain("personActions(person, may)")
        expect(section).toContain("{menu(person).length > 0 && <RowMenu")
        expect(section).not.toContain("client_accounts.manage")
    })

    it("offers Resend invitation with inviting, to someone still invited, and Remove with removing", () => {
        expect(personActions(person("invited"), all)).toEqual(["resend", "remove"])
        expect(personActions(person("active"), all)).toEqual(["remove"])
        expect(personActions(person("invited"), { invite: true, remove: false })).toEqual(["resend"])
        expect(personActions(person("invited"), { invite: false, remove: true })).toEqual(["remove"])
        expect(personActions(person("active"), { invite: true, remove: false })).toEqual([])
    })
})

describe("the words", () => {
    it("name each part in both languages", () => {
        expect(en.perm_client_accounts_view).toBe("See who signs in for a client")
        expect(en.perm_client_accounts_invite).toBe("Invite people to sign in for a client")
        expect(en.perm_client_accounts_remove).toBe("Remove who signs in for a client")
        expect(ar.perm_client_accounts_view).toBe("عرض من يسجّلون الدخول عن العميل")
        expect(ar.perm_client_accounts_invite).toBe("دعوة أشخاص لتسجيل الدخول عن العميل")
        expect(ar.perm_client_accounts_remove).toBe("إزالة من يسجّلون الدخول عن العميل")
    })
})
