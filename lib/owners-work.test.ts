import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { checkAssignees, assignableWhere } from "./services/assignee-guard"
import { withGrants } from "@/lib/permissions/test-actors"
import { shows, type SideBarViewer } from "@/lib/side-bar"
import { KNOWN_REFUSALS } from "@/lib/api-errors"
import { notOwnerNow, ownerRefusal } from "@/lib/owners"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * The work an owner isn't given (LATER_CHANGES_PLAN.md §7.3, step 3b2, PR
 * 428): the pickers that hand out tasks and obligations leave out whoever
 * is an owner now, and every path that hands out work refuses one, for the
 * Super Admin too, holding each person so no one is marked an owner
 * meanwhile. Attendance's person picker leaves them out, reminders skip
 * them, and My attendance leaves an owner's side menu. Reassign is on any
 * open obligation, so open work can be moved before someone is marked.
 */

const source = (path: string) => stripComments(readFileSync(path, "utf8"))

describe("who is an owner now", () => {
    it("is whoever has a period still open", () => {
        expect(notOwnerNow()).toEqual({ NOT: { ownerPeriods: { some: { endsAt: null } } } })
    })
})

describe("the pickers that hand out work", () => {
    it("leave out whoever is an owner now, for each of them", () => {
        const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1" }) }
        const leader = { user: withGrants({ id: "tl", role: "TEAM_LEADER", companyId: "c1" }) }
        for (const session of [admin, leader, { user: { id: "sa", role: "SUPER_ADMIN", companyId: null } }]) {
            for (const permission of ["tasks.create", "obligations.create", "obligations.edit", "tasks.transfer"] as const) {
                const where = assignableWhere(session, permission, "c1")
                expect(where.AND, `${session.user.role} ${permission}`).toContainEqual(notOwnerNow())
            }
        }
    })
})

describe("the check on saving", () => {
    const rows: Record<string, any> = {
        e1: { id: "e1", companyId: "c1", role: "EMPLOYEE", teamLeaderId: null, status: "ACTIVE", ownerPeriods: [] },
        o1: { id: "o1", companyId: "c1", role: "EMPLOYEE", teamLeaderId: null, status: "ACTIVE", ownerPeriods: [{ id: "p1" }] },
    }
    const client = { user: { findMany: async ({ where, select }: any) => {
        expect(select.ownerPeriods).toEqual({ where: { endsAt: null }, select: { id: true } })
        return [...new Set<string>(where.id.in)].map(id => rows[id]).filter(Boolean)
    } } }
    const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1" }) }
    const superAdmin = { user: { id: "sa", role: "SUPER_ADMIN", companyId: null } }

    it("refuses giving an owner work, the Super Admin too", async () => {
        expect(await checkAssignees(["e1", "o1"], admin, "tasks.create", { client })).toEqual({ ok: false, reason: "OWNER" })
        expect(await checkAssignees(["o1"], superAdmin, "obligations.create", { client })).toEqual({ ok: false, reason: "OWNER" })
        expect(await checkAssignees(["e1"], admin, "tasks.create", { client })).toEqual({ ok: true })
    })

    it("leaves an owner on work they already have", async () => {
        expect(await checkAssignees(["e1", "o1"], admin, "obligations.edit", { client, kept: ["o1"] })).toEqual({ ok: true })
    })

    it("answers in each path's words, in one code", () => {
        for (const file of ["lib/services/task.service.ts", "lib/services/obligation.service.ts"]) {
            const codes = source(file).match(/OWNER: "[A-Z_]+"/g) ?? []
            expect(codes.length, file).toBe(2)
            for (const code of codes) expect(code).toBe('OWNER: "ASSIGNEE_IS_OWNER"')
        }
        expect(KNOWN_REFUSALS.ASSIGNEE_IS_OWNER?.status).toBe(409)
    })
})

describe("every path that hands out work", () => {
    const tasks = source("lib/services/task.service.ts")
    const obligations = source("lib/services/obligation.service.ts")

    it("holds the people it's for and refuses an owner, in the transaction it writes in", () => {
        // Creating and editing a task, transferring one, and the bulk upload.
        expect(tasks).toContain("return await prisma.$transaction(async (tx) => {\n            if ((await holdAssignees(tx, assigneeIds)).size > 0) throw new Error(\"ASSIGNEE_IS_OWNER\")\n            if (resolvedClientId)")
        // Who it has now, read under its hold, not as it was before: someone taken off meanwhile is new again.
        expect(tasks).toContain("if (assigneeIds) {\n                await tx.$queryRaw`SELECT id FROM \"Task\" WHERE id = ${id} FOR UPDATE`\n                const has = ((await tx.task.findUnique({ where: { id }, select: { assignees: { select: { id: true } } } }))?.assignees ?? []).map(a => a.id)\n                if ((await holdAssignees(tx, assigneeIds.filter((uid: string) => !has.includes(uid)))).size > 0) throw new Error(\"ASSIGNEE_IS_OWNER\")\n            }")
        expect(tasks).toContain("await tx.$queryRaw`SELECT id FROM \"Task\" WHERE id = ${id} FOR UPDATE`\n            \n            const originalTask = await (tx.task as any).findUnique({")
        expect(tasks).toContain("if ((await holdAssignees(tx, addedIds)).size > 0) throw new Error(\"ASSIGNEE_IS_OWNER\")\n            const verdict = await checkAssignees(addedIds, session, \"tasks.transfer\", { client: tx as any })")
        expect(tasks).toContain("const owners = await holdAssignees(tx, tasks.flatMap(t => t.assigneeIds || []))")
        expect(tasks).toContain("if ((assigneeIds as string[]).some(id => owners.has(id))) throw new Error(`ASSIGNEE_IS_OWNER: ${task.title}`)")
        // Adding an obligation and reassigning one.
        expect(obligations).toContain("return await prisma.$transaction(async (tx) => {\n            if ((await holdAssignees(tx, assigneeIds)).size > 0) throw new Error(\"ASSIGNEE_IS_OWNER\")\n            return tx.obligation.create({")
        expect(obligations).toContain("if ((await holdAssignees(tx, assigneeIds.filter((uid: string) => !current.assignees.some(a => a.id === uid)))).size > 0) throw new Error(\"ASSIGNEE_IS_OWNER\")\n                const verdict = await checkAssignees(assigneeIds, session, \"obligations.edit\"")
        expect(obligations).toContain("await tx.$queryRaw`SELECT id FROM \"Obligation\" WHERE id = ${id} FOR UPDATE`\n            const current = await tx.obligation.findUnique({")
    })

    it("leaves an owner out of the bulk upload's checks too, before it writes", () => {
        const bulk = source("app/api/tasks/bulk/route.ts")
        expect(bulk).toContain("select: { id: true, companyId: true, role: true, teamLeaderId: true, ownerPeriods: { where: { endsAt: null }, select: { id: true } } }")
        expect(bulk).toContain("if (user.ownerPeriods.length > 0) { isTaskValid = false; break }")
    })

    it("is what marking an owner waits on, and the other way round", () => {
        const owners = source("lib/services/owner.service.ts")
        expect(owners).toContain("await lockPersonDates(tx, userId)\n            await lockOwner(tx, userId)")
        expect(owners).toContain("SELECT pg_advisory_xact_lock(hashtext(${ownerKey(userId)}))::text")
        expect(owners).toContain("SELECT pg_advisory_xact_lock_shared(hashtext(${ownerKey(id)}))::text")
    })
})

describe("a repeating obligation", () => {
    it("still to make its next one, refuses marking its person, named as such, in either language", () => {
        const owners = source("lib/services/owner.service.ts")
        expect(owners).toContain("const repeating = await stillToRecur(tx, { assignees: { some: { id: userId } } })")
        expect(owners).toContain('...repeating.map(({ obl }) => ({ kind: "repeating" as const, id: obl.id, title: obl.title })),')
        expect(en.owner_work_repeating).toContain("{title}")
        expect(ar.owner_work_repeating).toContain("{title}")
        const dialog = source("components/profile/OwnerDialog.tsx")
        expect(dialog).toContain("const [before, after] = t(WORK_WORDS[w.kind]).split('{title}')")
        expect(dialog).toContain("task: 'owner_work_task',\n    obligation: 'owner_work_obligation',\n    repeating: 'owner_work_repeating',")
    })

    it("is found as the overnight run finds it", () => {
        expect(source("lib/services/obligation.service.ts")).toContain("const checkPayloads = await stillToRecur(prisma, {})")
    })

    it("is made by the overnight run for no owner, held as other new work is", () => {
        const obligations = source("lib/services/obligation.service.ts")
        expect(obligations).toContain("const owners = await holdAssignees(tx, obl.assignees.map(a => a.id))\n                const people = obl.assignees.map(a => a.id).filter(id => !owners.has(id))\n                if (people.length === 0 && owners.size > 0) return null")
        expect(obligations).toContain("connect: people.map(id => ({ id }))")
    })
})

describe("Reassign on an obligation", () => {
    it("is in its menu while it's open, for whoever edits obligations", () => {
        const page = source("app/(dashboard)/dashboard/obligations/[id]/client.tsx")
        expect(page).toContain("const OPEN = ['PENDING', 'IN_PROGRESS', 'PENDING_CONFIRMATION']")
        expect(page).toContain("...(canEdit && OPEN.includes(obligation.status)\n            ? [{ key: 'reassign', icon: UserSwitchIcon, label: t('reassign_button'), onSelect: () => setReassigning(true) }]")
    })
})

describe("attendance", () => {
    it("leaves an owner now out of its person picker", () => {
        expect(source("lib/services/attendance-punch.service.ts")).toContain("companyId, status: { not: \"DELETED\" }, ...notOwnerNow(),")
    })

    it("sends no check-in reminder for a day in a month they're an owner", () => {
        const reminders = source("lib/services/check-in-reminder.service.ts")
        expect(reminders).toContain("const owners = await prisma.ownerPeriod.findMany({ where: { userId: { in: userIds } }, select: { id: true, userId: true, startsAt: true, endsAt: true } })")
        expect(reminders).toContain("if (expected?.kind !== \"WORK\" || !after || ownerIn(owners.filter(p => p.userId === userId), date.slice(0, 7))) continue")
    })
})

describe("My attendance", () => {
    const viewer = (owner: boolean): SideBarViewer => ({ superAdmin: false, can: () => false, has: () => true, checkIn: false, companySettings: false, cashAdvances: false, owner })

    it("leaves an owner's side menu, and is there otherwise", () => {
        expect(shows("myAttendance", viewer(false))).toBe(true)
        expect(shows("myAttendance", viewer(true))).toBe(false)
    })

    it("knows they're an owner on the first paint, and as they move around", () => {
        const layout = source("app/(dashboard)/layout.tsx")
        expect(layout).toContain("const owner = user.role !== 'SUPER_ADMIN' && !!user.companyId && !!(await OwnerService.of(user.id))")
        expect(layout).toContain("cashAdvances={cashAdvances} owner={owner}>")
        expect(source("app/api/company-settings/visible/route.ts")).toContain("owner: !!companyId && !!(await OwnerService.of(session.user.id)),")
        const shell = source("components/DashboardShell.tsx")
        expect(shell).toContain("{ fallbackData: { data: { visible: settingsOnFirstPaint, cashAdvances: advancesOnFirstPaint, owner: ownerOnFirstPaint } },")
        expect(shell).toContain("owner: !!settingsEntry?.data?.owner,")
    })
})

describe("only an Admin is an owner", () => {
    it("is marked by an Admin or the Super Admin, never on one's own, as the route asks", () => {
        const route = source("app/api/users/[id]/owner/route.ts")
        expect(route).not.toContain("onlySuperAdminActsOnAdmins")
        expect(route).toContain(`if (session.user.role !== "SUPER_ADMIN" && session.user.role !== "ADMIN") return ApiResponse.forbidden("Only an Admin or the Super Admin sets owners")`)
        expect(route).toContain(`OWNER_NOT_ADMIN: [409, "Only an Admin can be among the owners, not someone acting as one for a while."],`)
        expect(ownerRefusal("OWNER_NOT_ADMIN")).toBe("owner_not_admin")
        const profile = source("lib/profile-access.ts")
        expect(profile).toContain("setOwner: can('employees.set_owner') && !own && (superAdmin || viewer?.role === 'ADMIN') && person.role !== 'SUPER_ADMIN' && person.role !== '',")
        expect(profile).toContain("addOwner: can('employees.set_owner') && !own && (superAdmin || viewer?.role === 'ADMIN') && person.role === 'ADMIN',")
        const view = source("components/profile/ProfileView.tsx")
        expect(view).toContain("...(access.owner && (facts.ownerSince || access.addOwner) ? [{")
        expect(view).toContain("{(facts.ownerSince ? access.setOwner : access.addOwner) && (")
    })

    it("is refused for anyone else, under the lock marking takes", () => {
        const owners = source("lib/services/owner.service.ts")
        const read = `const them = await tx.user.findUnique({ where: { id: userId }, select: { role: true, actingUntil: true } })\n            if (owner && (them?.role !== "ADMIN" || them.actingUntil !== null)) throw new OwnerRefused("OWNER_NOT_ADMIN")`
        expect(owners).toContain(read)
        expect(owners.indexOf("            await lockOwner(tx, userId)\n")).toBeLessThan(owners.indexOf(read))
    })

    it("keeps their role Admin, under the same lock, said in either language wherever a role is changed", () => {
        const users = source("lib/services/user.service.ts")
        expect(users).toContain("const leavesAdmin = regularUser.role === 'ADMIN' && updateData.role !== undefined && updateData.role !== 'ADMIN'")
        expect(users).toContain("if (leavesAdmin) await keepsOwnerAnAdmin(tx, id)")
        const owners = source("lib/services/owner.service.ts")
        expect(owners).toContain("export async function keepsOwnerAnAdmin(tx: Prisma.TransactionClient, userId: string) {\n    await lockOwner(tx, userId)")
        expect(source("lib/role-errors.ts")).toContain(`case "OWNER_STAYS_ADMIN": return refused(400, "They're among the owners, so their role stays Admin. Remove them from owners first.", "OWNER_STAYS_ADMIN")`)
        expect(source("lib/profile-form.ts")).toContain("OWNER_STAYS_ADMIN: { field: 'roleId', key: 'profile_role_owner' },")
        expect(source("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx")).toContain("OWNER_STAYS_ADMIN: 'requests_role_owner',")
        for (const words of [en, ar]) for (const key of ["owner_not_admin", "profile_role_owner", "requests_role_owner"] as const) expect(words[key], key).toBeTruthy()
    })
})
