import { prisma } from "@/lib/prisma"
import { roleParam } from "@/lib/notice"
import { isBuiltInRole } from "@/lib/permissions/built-in"
import { isPermission } from "@/lib/permissions/catalogue"
import { decodeGrants, type Grants } from "@/lib/permissions/grants"
import { covers } from "@/lib/permissions/grant-rules"
import { startOfDayIn } from "@/lib/time"
import { RoleService } from "./role.service"
import type { UserRole } from "@prisma/client"

type Client = Pick<typeof prisma, "role">
type CompanyClient = Pick<typeof prisma, "role" | "company">

/** Whoever is handing a role out: the signed-in user, grants included. */
export type Assigner = { id?: string | null; role?: string | null; grants?: string | null }

type RoleRow = { id: string; companyId: string; baseRole: UserRole; grants: { permission: string; scope: string }[] }

/** A role's grants as the catalogue knows them. */
function grantsOf(role: RoleRow): Grants {
    const grants: Grants = {}
    for (const g of role.grants) if (isPermission(g.permission)) grants[g.permission] = g.scope as any
    return grants
}

/**
 * Whether `actor` may hand `role` out (ROLES_PLAN.md §4.2, rules 2 and 4): an
 * ADMIN-based role only the Super Admin, and any other only if every grant it
 * carries is one the actor holds, at an equal or wider scope. The reason, or
 * null when they may.
 */
function refusal(actor: Assigner, role: RoleRow): "FORBIDDEN_ROLE_ASSIGNMENT" | "ROLE_EXCEEDS_YOURS" | null {
    if (actor.role === "SUPER_ADMIN") return null
    if (role.baseRole === "ADMIN" || role.baseRole === "SUPER_ADMIN") return "FORBIDDEN_ROLE_ASSIGNMENT"
    return covers(decodeGrants(actor.grants), grantsOf(role)) ? null : "ROLE_EXCEEDS_YOURS"
}

const ROLE_ROW = { id: true, companyId: true, baseRole: true, grants: { select: { permission: true, scope: true } } } as const
type UserClient = Pick<typeof prisma, "user">

/** Statuses in which somebody is at work. The rest take them out of it. */
const AT_WORK = ["ACTIVE", "OFFLINE"] as const

/**
 * The only writer of a person's role (ROLES_PLAN.md §3.1).
 *
 * A person holds one role; `User.role` is that role's base role, copied from
 * it. Two copies of one fact drift unless one place writes both, so every
 * change of role — and every change of company, which changes which roles
 * exist for them — takes its `role` and `roleId` from here, in the same write.
 * The database refuses a pair that disagree (the roles migration), and
 * lib/role-writes.test.ts fails if any other code writes either.
 *
 * Until a company has roles of its own (the Super Admin screens, ROLES_PLAN.md
 * §6), everyone is on a built-in one, chosen by the base role asked for.
 */
export class RoleAssignmentService {
    /**
     * The fields to write for somebody who is to be `role` in `companyId`:
     * that company's built-in role of that kind. A Super Admin row, or an
     * account with no company, holds no role.
     */
    static async builtIn(
        client: Client,
        role: UserRole,
        companyId: string | null | undefined,
    ): Promise<{ role: UserRole; roleId: string | null }> {
        if (!companyId || !isBuiltInRole(role)) return { role, roleId: null }
        const find = () => client.role.findUnique({
            where: { companyId_builtIn: { companyId, builtIn: role } },
            select: { id: true },
        })
        let found = await find()
        // Every company is created with its built-in roles, and the migration
        // gave them to every company before that — except one created by the
        // previous release while this one's migration ran. A company with no
        // roles at all is that case, and gets them now. One missing only some
        // is broken in a way nobody should paper over.
        if (!found && (await client.role.count({ where: { companyId } })) === 0) {
            await RoleService.seedBuiltInRoles(client as any, companyId)
            found = await find()
        }
        if (!found) throw new Error("BUILT_IN_ROLE_MISSING")
        return { role, roleId: found.id }
    }

    /**
     * The fields to write for somebody `actor` is putting on the role
     * `roleId`, in `to.companyId` — after the rules for handing a role out
     * (ROLES_PLAN.md §4.2):
     *
     * 1. Nobody changes their own role (OWN_ROLE).
     * 2. Only the Super Admin hands out an ADMIN-based role
     *    (FORBIDDEN_ROLE_ASSIGNMENT).
     * 3. Only that company's roles (ROLE_NOT_IN_COMPANY) — an unknown id reads
     *    the same, so nobody learns another company's roles by guessing.
     * 4. Only access the actor holds (ROLE_EXCEEDS_YOURS).
     *
     * Who may assign at all, the last Admin and the team rules are the
     * caller's, as they are for every other change to a person.
     */
    static async chosen(
        client: Client,
        actor: Assigner,
        roleId: string,
        to: { companyId: string | null | undefined; userId?: string | null },
    ): Promise<{ role: UserRole; roleId: string }> {
        if (to.userId && actor.id && to.userId === actor.id) throw new Error("OWN_ROLE")
        const role = await client.role.findUnique({ where: { id: roleId }, select: ROLE_ROW })
        if (!role || !to.companyId || role.companyId !== to.companyId) throw new Error("ROLE_NOT_IN_COMPANY")
        const refused = refusal(actor, role)
        if (refused) throw new Error(refused)
        return { role: role.baseRole, roleId: role.id }
    }

    /**
     * What a new account in `companyId` starts on (ROLES_PLAN.md §6.4): the
     * company's default role, which the Super Admin sets, or the built-in
     * Employee while none is set. Nobody ever exists without a role.
     */
    static async defaultFor(client: CompanyClient, companyId: string): Promise<{ role: UserRole; roleId: string | null }> {
        const company = await client.company.findUnique({
            where: { id: companyId },
            select: { defaultRole: { select: { id: true, baseRole: true } } },
        })
        if (company?.defaultRole) return { role: company.defaultRole.baseRole, roleId: company.defaultRole.id }
        return this.builtIn(client, "EMPLOYEE", companyId)
    }

    /**
     * The roles `actor` may hand out in `companyId` — what a Role dropdown
     * offers. The same rules as chosen(), so the list and the server agree.
     */
    static async assignable(client: CompanyClient, actor: Assigner, companyId: string) {
        const [roles, company] = await Promise.all([
            client.role.findMany({ where: { companyId }, select: { ...ROLE_ROW, name: true, builtIn: true }, orderBy: { name: "asc" } }),
            client.company.findUnique({ where: { id: companyId }, select: { defaultRoleId: true } }),
        ])
        const defaultId = company?.defaultRoleId ?? roles.find(r => r.builtIn === "EMPLOYEE")?.id ?? null
        return roles
            .filter(role => !refusal(actor, role))
            .map(role => ({ id: role.id, name: role.name, baseRole: role.baseRole, builtIn: role.builtIn, isDefault: role.id === defaultId }))
    }

    /**
     * What to write for an acting role (ROLES_PLAN.md §6.13) given along with
     * `next`, the role being given: held until `until`, then back to what
     * they hold now — or, if they are already acting, to what they held
     * before that, so covering twice never strands anyone on a cover role.
     * Without `until`, the change is permanent and any acting ends with it.
     */
    /**
     * The instant somebody is back on their own role. A screen sends a return
     * date, "YYYY-MM-DD", and "back on the 5th" means from the first moment of
     * the 5th in the company's calendar, not in UTC's. An instant — one
     * already worked out, as a request stores it — is used as it is: reading
     * it again as a date would move it by the zone's offset.
     */
    static returnOn(value: string | Date, timeZone: string): Date {
        if (value instanceof Date) return value
        const [y, m, d] = value.split("-").map(Number)
        return startOfDayIn(new Date(Date.UTC(y, m - 1, d, 12)), timeZone)
    }

    static acting(
        current: { roleId: string | null; actingUntil: Date | null; returnRoleId: string | null },
        until: Date | null | undefined,
        now: Date = new Date(),
    ): { actingUntil?: Date | null; returnRoleId?: string | null } {
        // Permanent: ends a cover if there is one, and writes nothing if not.
        if (!until) return current.actingUntil ? { actingUntil: null, returnRoleId: null } : {}
        if (until <= now) throw new Error("ACTING_END_IN_PAST")
        return { actingUntil: until, returnRoleId: current.actingUntil ? current.returnRoleId : current.roleId }
    }

    /**
     * Returns everybody whose acting role has run out to the role they had
     * (§6.13) — the nightly job. A return the rules would refuse is held, and
     * the company's deciders told, as the employment job holds an event: a
     * Team Leader returning to a role that leads nobody while people still
     * report to them, or the company's last Admin at work. A return role that
     * no longer exists sends them to the company's default instead.
     */
    static async endActing(now: Date = new Date()) {
        const due = await prisma.user.findMany({
            where: { actingUntil: { lte: now }, companyId: { not: null } },
            select: {
                id: true, role: true, roleId: true, companyId: true, status: true, teamLeaderId: true,
                firstName: true, lastName: true, returnRoleId: true,
                assignedRole: { select: { name: true, builtIn: true } },
                returnRole: { select: { id: true, baseRole: true, name: true } },
            },
        })
        const { stripsLeadership } = await import("@/lib/team-assignment")
        const { TeamHandOff } = await import("./team-handoff.service")
        const { NotificationService } = await import("./notification.service")
        const { AuditLogService } = await import("./audit-log.service")
        const { holdersOf } = await import("@/lib/permissions/holders")
        let returned = 0
        const held: string[] = []

        for (const person of due) {
            const companyId = person.companyId!
            const next = person.returnRole
                ? { role: person.returnRole.baseRole, roleId: person.returnRole.id }
                : await RoleAssignmentService.defaultFor(prisma, companyId)
            try {
                if (stripsLeadership(person, { role: next.role })) {
                    await TeamHandOff.plan({ id: person.id, companyId }, undefined)
                }
                await RoleAssignmentService.keepsAnAdmin(prisma, person.id, { roleId: next.roleId })
            } catch (error: any) {
                if (error?.message !== "LEADER_HAS_REPORTS" && error?.message !== "LAST_ADMIN") throw error
                held.push(person.id)
                const deciders = await prisma.user.findMany({
                    where: { companyId, status: { in: [...AT_WORK] }, id: { not: person.id }, ...holdersOf("employees.assign_role") },
                    select: { id: true },
                })
                await NotificationService.notifyMany(
                    deciders.map(d => d.id),
                    "ROLE_ACTING_HELD",
                    { key: "notice_acting_held", params: { name: `${person.firstName} ${person.lastName}`, reason: { key: error.message === "LAST_ADMIN" ? "notice_acting_held_last_admin" : "notice_acting_held_reports" } } },
                    `/dashboard/employees/${person.id}`,
                )
                continue
            }

            await prisma.$transaction(async tx => {
                await tx.user.update({
                    where: { id: person.id },
                    data: {
                        ...next, actingUntil: null, returnRoleId: null,
                        // Only an employee has a leader.
                        ...(next.role !== "EMPLOYEE" ? { teamLeaderId: null } : {}),
                        // Their permissions change: the session reloads them.
                    },
                })
                await AuditLogService.log("END_ACTING_ROLE", "USER", person.id, {
                    tx, userId: null, superAdminId: null,
                    details: { from: person.roleId, to: next.roleId, returnedToDefault: !person.returnRole },
                })
            })
            await NotificationService.notify(
                person.id,
                "ROLE_ACTING_ENDED",
                { key: "notice_acting_ended", params: { role: roleParam(person.assignedRole) } },
                `/dashboard/employees/${person.id}`,
            )
            returned++
        }
        return { due: due.length, returned, held: held.length }
    }

    /**
     * Only the Super Admin acts on an Admin: changes their role or account
     * status, ends their contract or deletes them. A company's Admins are
     * peers, and the built-in Admin role is locked (ROLES_PLAN.md §4.2, rule
     * 7) — one of them cannot take another out of it or out of work. Throws
     * ADMIN_IS_SUPER_ADMINS for anybody else acting on somebody whose base
     * role is ADMIN.
     */
    static onlySuperAdminActsOnAdmins(actor: { role?: string | null }, target: { role?: string | null }): void {
        if (target.role === "ADMIN" && actor.role !== "SUPER_ADMIN") throw new Error("ADMIN_IS_SUPER_ADMINS")
    }

    /**
     * Refuses a change that would leave a company with nobody at work on its
     * built-in Admin role (ROLES_PLAN.md §4.2, rule 8) — the one role
     * guaranteed to be able to fix every other, so a company without one
     * could lock itself out of its own roles.
     *
     * `next` is what the change does to the person: a new role, a new status,
     * a new company. Anything left undefined stays as it is. Throws LAST_ADMIN.
     */
    static async keepsAnAdmin(
        client: UserClient,
        userId: string,
        next: { roleId?: string | null; status?: string; companyId?: string | null },
    ): Promise<void> {
        const user = await client.user.findUnique({
            where: { id: userId },
            select: { roleId: true, status: true, companyId: true, assignedRole: { select: { builtIn: true } } },
        })
        if (!user?.roleId || user.assignedRole?.builtIn !== "ADMIN") return
        if (!(AT_WORK as readonly string[]).includes(user.status)) return

        const staysAdmin =
            (next.roleId === undefined || next.roleId === user.roleId) &&
            (next.status === undefined || (AT_WORK as readonly string[]).includes(next.status)) &&
            (next.companyId === undefined || next.companyId === user.companyId)
        if (staysAdmin) return

        const others = await client.user.count({
            where: { roleId: user.roleId, status: { in: [...AT_WORK] }, id: { not: userId } },
        })
        if (others === 0) throw new Error("LAST_ADMIN")
    }
}
