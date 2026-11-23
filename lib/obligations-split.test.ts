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
import { state, prismaMock, obligationState, OBLIGATIONS, url, withBody } from "@/lib/permissions/obligation-access.harness"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

vi.setConfig({ testTimeout: 120_000 })

/**
 * obligations.manage split by what can be done to an obligation
 * (LATER_CHANGES_PLAN.md §2, PR 367). An obligation's details don't change
 * once it's made, so:
 * - obligations.create adds one, with its people;
 * - obligations.edit hands it to other people, moves it along as a manager,
 *   and removes other people's attachments;
 * - obligations.approve approves or rejects one handed in, and changes one
 *   already approved;
 * - obligations.delete deletes one.
 *
 * Each is for the company or a team, as obligations.manage was. A role still
 * holding obligations.manage is read as holding each part at its scope, until
 * the grant for companies already there. The real routes run, as a person of
 * the first company on no obligation, holding one part and not the others.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

const PARTS = ["obligations.create", "obligations.edit", "obligations.approve", "obligations.delete"] as const
type Part = typeof PARTS[number]

/** Someone of the first company, on none of the obligations, holding exactly these. */
const signIn = (grants: Grants, id = "admin1b") => {
    state.session = { user: stepUpConfirmed({ id, role: "ADMIN", companyId: "c1", grants: encodeGrants(grants) }) }
}
const holding = (...parts: Part[]): Grants => Object.fromEntries([["obligations.view", "COMPANY"], ["employees.view", "COMPANY"], ...parts.map(p => [p, "COMPANY"])])
const allBut = (part: Part) => holding(...PARTS.filter(p => p !== part))
const OLD_ROLE = (scope: "TEAM" | "COMPANY") => grantsFromRows([{ permission: "obligations.view", scope: "COMPANY" }, { permission: "obligations.manage", scope }])

const P = (id: string) => ({ params: { id } })
const later = () => new Date(Date.now() + 7 * 86_400_000).toISOString()
const one = () => import("@/app/api/obligations/[id]/route")
const create = async () => (await import("@/app/api/obligations/route")).POST(withBody("POST", "/api/obligations", { title: "Obligation", description: "Something to do", assigneeIds: ["emp"], deadline: later() }))
const put = async (o: string, body: unknown, status: string) => { obligationState.status = status; return (await one()).PUT(withBody("PUT", `/api/obligations/${o}`, body), P(o)) }
const decide = (o = "o-emp") => put(o, { status: "APPROVED" }, "PENDING_CONFIRMATION")
const archive = (o = "o-emp") => put(o, { status: "ARCHIVED" }, "IN_PROGRESS")
const reopen = (o = "o-emp") => put(o, { status: "IN_PROGRESS" }, "APPROVED")
const reassign = (o = "o-emp") => put(o, { assigneeIds: ["loner"] }, "IN_PROGRESS")
const remove = async (o = "o-emp") => { obligationState.status = "IN_PROGRESS"; return (await one()).DELETE(new Request(url(`/api/obligations/${o}`), { method: "DELETE" }), P(o)) }

/** What the last update wrote, to see whether a reassignment was made. */
let written: any[] = []
beforeEach(() => {
    written = []
    const update = prismaMock.obligation.update
    if (!update.wrapped) {
        const wrapped = async (args: any) => { written.push(args.data); return update(args) }
        wrapped.wrapped = true
        prismaMock.obligation.update = wrapped
    }
})

describe("the catalogue", () => {
    it("has the four, each with a code of its own, for the company or a team, and none high-risk", () => {
        expect(PARTS.map(p => PERMISSIONS[p].code)).toEqual([75, 76, 77, 78])
        for (const p of PARTS) {
            expect(PERMISSIONS[p]).toMatchObject({ module: "OBLIGATIONS", scopes: ["TEAM", "COMPANY"], implies: ["obligations.view"] })
            expect((PERMISSIONS[p] as { highRisk?: string }).highRisk, p).toBeUndefined()
        }
    })

    it("marks obligations.manage as split into the four", () => {
        expect(splitParts("obligations.manage")).toEqual(PARTS)
        expect((Object.keys(PERMISSIONS) as Permission[]).filter(isSplit)).toContain("obligations.manage")
    })

    it("offers the four in the role editor, and obligations.manage no more", () => {
        const group = PERMISSION_GROUPS.find(g => g.key === "obligations")!.permissions
        for (const p of PARTS) expect(group).toContain(p)
        expect(PERMISSION_GROUPS.flatMap(g => g.permissions)).not.toContain("obligations.manage")
    })

    it("goes up a version, so every session reloads its grants once", () => {
        // 6 for this split; 7 since the locations one (PR 377).
        expect(CATALOGUE_VERSION).toBeGreaterThanOrEqual(6)
    })

    it("seeds the built-in Admin with the four for the company, and the Team Leader for their team", () => {
        for (const p of PARTS) {
            expect(BUILT_IN_GRANTS.ADMIN[p], p).toBe("COMPANY")
            expect(BUILT_IN_GRANTS.TEAM_LEADER[p], p).toBe("TEAM")
            expect(BUILT_IN_GRANTS.EMPLOYEE[p], p).toBeUndefined()
        }
        for (const role of Object.values(BUILT_IN_GRANTS)) expect(role["obligations.manage"]).toBeUndefined()
    })
})

describe("a role still holding obligations.manage", () => {
    it("is read as holding each part, at its scope", () => {
        for (const scope of ["TEAM", "COMPANY"] as const) {
            const grants = OLD_ROLE(scope)
            for (const p of PARTS) expect(grants[p], `${p} ${scope}`).toBe(scope)
            expect(grants["obligations.manage"]).toBeUndefined()
        }
    })

    it("is saved as the four, at its scope", () => {
        const verdict = normalizeGrants([{ permission: "obligations.manage", scope: "TEAM" }])
        expect(verdict.ok).toBe(true)
        if (verdict.ok) {
            for (const p of PARTS) expect(verdict.grants[p], p).toBe("TEAM")
            expect(verdict.grants["obligations.manage"]).toBeUndefined()
        }
    })

    it("is found when asking who holds a part, at a scope", () => {
        expect(holdersOf("obligations.approve", "TEAM")).toEqual({ assignedRole: { grants: { some: { permission: { in: ["obligations.approve", "obligations.manage"] }, scope: "TEAM" } } } })
    })

    it("gives a session made from it each part", () => {
        const actor = { id: "admin1b", role: "ADMIN", companyId: "c1", grants: encodeGrants(OLD_ROLE("COMPANY")) }
        for (const p of PARTS) expect(can(actor, p, { companyId: "c1" }), p).toBe(true)
    })
})

describe("the routes, each part alone", () => {
    it("adds one with obligations.create, and not without it", async () => {
        signIn(allBut("obligations.create"))
        expect((await create()).status).toBe(403)
        signIn(holding("obligations.create"))
        expect((await create()).status).toBe(201)
    })

    it("approves one handed in with obligations.approve, and not without it", async () => {
        signIn(allBut("obligations.approve"))
        expect((await decide()).status).toBe(403)
        signIn(holding("obligations.approve"))
        expect((await decide()).status).toBe(200)
    })

    it("changes one already approved with obligations.approve, since it takes back its points, and not with editing", async () => {
        signIn(allBut("obligations.approve"))
        expect((await reopen()).status).toBe(403)
        signIn(holding("obligations.approve"))
        expect((await reopen()).status).toBe(200)
    })

    it("moves one along as a manager with obligations.edit, and not with approving", async () => {
        signIn(allBut("obligations.edit"))
        expect((await archive()).status).toBe(403)
        signIn(holding("obligations.edit"))
        expect((await archive()).status).toBe(200)
    })

    it("hands one to other people with obligations.edit; without it, the people stay as they are", async () => {
        signIn(allBut("obligations.edit"))
        expect((await reassign()).status).toBe(200)
        expect(written.at(-1).assignees).toBeUndefined()
        signIn(holding("obligations.edit"))
        expect((await reassign()).status).toBe(200)
        expect(written.at(-1).assignees).toEqual({ set: [{ id: "loner" }] })
    })

    it("removes other people's attachments with obligations.edit for the company, and not with approving", async () => {
        const before = OBLIGATIONS["o-emp"].attachments
        OBLIGATIONS["o-emp"].attachments = JSON.stringify([{ url: "https://x/app-assets/a.pdf", uploadedById: "emp" }])
        try {
            signIn(allBut("obligations.edit"))
            expect((await put("o-emp", { attachments: [] }, "IN_PROGRESS")).status).toBe(403)
            signIn(holding("obligations.edit"))
            expect((await put("o-emp", { attachments: [] }, "IN_PROGRESS")).status).toBe(200)
        } finally {
            OBLIGATIONS["o-emp"].attachments = before
        }
    })

    it("deletes one with obligations.delete, and not without it", async () => {
        signIn(allBut("obligations.delete"))
        expect((await remove()).status).toBe(403)
        signIn(holding("obligations.delete"))
        expect((await remove()).status).toBe(200)
    })

    it("lets a role still holding obligations.manage do all of it", async () => {
        state.session = { user: stepUpConfirmed({ id: "admin1b", role: "ADMIN", companyId: "c1", grants: encodeGrants({ ...OLD_ROLE("COMPANY"), "employees.view": "COMPANY" }) }) }
        expect((await create()).status).toBe(201)
        expect((await decide()).status).toBe(200)
        expect((await archive()).status).toBe(200)
        expect((await remove()).status).toBe(200)
    })
})

describe("each part keeps the rules obligations.manage had", () => {
    it("held for a team, it reaches only the team's obligations", async () => {
        for (const part of ["obligations.approve", "obligations.edit", "obligations.delete"] as const) {
            signIn({ "obligations.view": "COMPANY", "employees.view": "COMPANY", [part]: "TEAM" }, "tl")
            const act = part === "obligations.approve" ? decide : part === "obligations.edit" ? archive : remove
            expect((await act("o-emp")).status, `${part} on the team's`).toBe(200)
            expect((await act("o-loner")).status, `${part} outside the team`).toBe(403)
        }
    })

    it("held for a team, adding or reassigning one reaches only the team's people", async () => {
        const create = async (assignee: string) => (await import("@/app/api/obligations/route")).POST(withBody("POST", "/api/obligations", { title: "Obligation", description: "Something to do", assigneeIds: [assignee], deadline: later() }))
        signIn({ "obligations.view": "COMPANY", "employees.view": "COMPANY", "obligations.create": "TEAM" }, "tl")
        expect((await create("emp")).status).toBe(201)
        expect((await create("loner")).status).toBe(403)
        signIn({ "obligations.view": "COMPANY", "employees.view": "COMPANY", "obligations.edit": "TEAM" }, "tl")
        expect((await reassign("o-emp")).status).toBe(403)
    })

    it("held for the company, never one's own to approve, nor to delete", async () => {
        signIn(holding("obligations.approve"), "admin")
        expect((await decide("o-admin")).status).toBe(403)
        signIn(holding("obligations.delete"), "admin")
        expect((await remove("o-admin")).status).toBe(403)
    })
})

describe("the screens", () => {
    const read = (path: string) => readFileSync(path, "utf8")
    const PAGE = "app/(dashboard)/dashboard/obligations/[id]/client.tsx"

    it("offer adding one, and the team-only picker, by obligations.create", () => {
        expect(read("app/(dashboard)/dashboard/obligations/new/page.tsx")).toContain("const mayCreate = useCan().can('obligations.create')")
        // The team-only picker is the names-only list for adding obligations, by the server (PR 371).
        expect(read("app/(dashboard)/dashboard/obligations/new/page.tsx")).toContain("fetchRetrying(assigneesUrl('obligations.create', selectedCompanyId))")
        expect(read("app/(dashboard)/dashboard/obligations/ObligationsClient.tsx")).toContain("permissions.can('obligations.create') && (")
    })

    it("on an obligation, offer each action by its own part", () => {
        const page = read(PAGE)
        expect(page).toContain("const mayApproveThis = ownRule('obligations.approve')")
        expect(page).toContain("const mayDeleteThis = ownRule('obligations.delete')")
        expect(page).toContain("const canEdit = can('obligations.edit')")
        expect(page).toContain("action={mayApproveThis && obligation.status === 'PENDING_CONFIRMATION' && (")
        expect(page).toContain("const mayRemove = (att: Attachment) => !locked && canEdit && (att.uploadedById === userId || companyWide('obligations.edit'))")
        expect(page).not.toMatch(/(can|scope|companyWide)\('obligations\.manage'\)/)
    })

    it("name each part in both languages, and keep the old one's name for the audit log", () => {
        expect([en.perm_obligations_create, en.perm_obligations_edit, en.perm_obligations_approve, en.perm_obligations_delete])
            .toEqual(["Add obligations", "Reassign obligations and move them along", "Approve or reject obligations", "Delete obligations"])
        expect([ar.perm_obligations_create, ar.perm_obligations_edit, ar.perm_obligations_approve, ar.perm_obligations_delete])
            .toEqual(["إضافة الالتزامات", "إعادة تعيين الالتزامات وتغيير حالتها", "الموافقة على الالتزامات أو رفضها", "حذف الالتزامات"])
        expect(en.perm_obligations_manage).toBe("Manage obligations")
    })

    it("list each part, with its routes, in the roles plan", () => {
        const plan = read("ROLES_PLAN.md")
        const row = (p: string) => plan.split("\n").find(l => l.startsWith("|") && l.includes(`\`${p}\` |`))
        expect(row("obligations.create")).toContain("`POST /obligations`")
        expect(row("obligations.edit")).toContain("`PUT /obligations/[id]`")
        expect(row("obligations.approve")).toContain("`PUT /obligations/[id]`")
        expect(row("obligations.delete")).toContain("`DELETE /obligations/[id]`")
        expect(row("obligations.manage")).toContain("Split into the four above")
    })
})
