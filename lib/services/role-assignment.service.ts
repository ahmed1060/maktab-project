import { prisma } from "@/lib/prisma"
import { isBuiltInRole } from "@/lib/permissions/built-in"
import { RoleService } from "./role.service"
import type { UserRole } from "@prisma/client"

type Client = Pick<typeof prisma, "role">

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
}
