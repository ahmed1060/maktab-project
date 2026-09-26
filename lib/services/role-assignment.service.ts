import { prisma } from "@/lib/prisma"
import { isBuiltInRole } from "@/lib/permissions/built-in"
import { RoleService } from "./role.service"
import type { UserRole } from "@prisma/client"

type Client = Pick<typeof prisma, "role">
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
