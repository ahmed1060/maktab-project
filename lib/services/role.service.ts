import { prisma } from "@/lib/prisma"
import { BUILT_IN_GRANTS, type BuiltInRole } from "@/lib/permissions/built-in"
import { encodeGrants, type Grants } from "@/lib/permissions/grants"
import { isPermission, type Scope } from "@/lib/permissions/catalogue"

type Client = Pick<typeof prisma, "role" | "user">

/** The built-in roles every company has, and what they are called. */
export const BUILT_IN_ROLES: readonly { builtIn: BuiltInRole; name: string }[] = [
    { builtIn: "ADMIN", name: "Admin" },
    { builtIn: "TEAM_LEADER", name: "Team Leader" },
    { builtIn: "EMPLOYEE", name: "Employee" },
]

/** What a session token carries about the person's role (ROLES_PLAN.md §4.4). */
export type RoleForToken = { roleId: string | null; roleVersion: number; grants: string }

export class RoleService {
    /**
     * A new company's Admin, Team Leader and Employee roles, with the grants in
     * lib/permissions/built-in.ts — the same the migration gave every company
     * that existed before roles were data. Called inside the transaction that
     * creates the company, so none is ever without them.
     */
    static async seedBuiltInRoles(client: Client, companyId: string) {
        for (const { builtIn, name } of BUILT_IN_ROLES) {
            await client.role.create({
                data: {
                    companyId, name, baseRole: builtIn, builtIn,
                    grants: {
                        create: (Object.entries(BUILT_IN_GRANTS[builtIn]) as [string, Scope][])
                            .map(([permission, scope]) => ({ permission, scope })),
                    },
                },
            })
        }
    }

    /**
     * The person's role as their session token should carry it. Someone with no
     * role — a Super Admin, or an account with no company — holds nothing
     * through one; can() answers the Super Admin before it reads grants.
     */
    static async forToken(userId: string, client: Pick<typeof prisma, "user"> = prisma): Promise<RoleForToken> {
        const user = await client.user.findUnique({
            where: { id: userId },
            select: {
                roleId: true,
                assignedRole: { select: { version: true, grants: { select: { permission: true, scope: true } } } },
            },
        })
        const role = user?.assignedRole
        if (!user?.roleId || !role) return { roleId: null, roleVersion: 0, grants: "" }
        const grants: Grants = {}
        // A grant for a permission no longer in the catalogue is skipped rather
        // than trusted: it cannot be encoded, and it gates nothing.
        for (const g of role.grants) if (isPermission(g.permission)) grants[g.permission] = g.scope
        return { roleId: user.roleId, roleVersion: role.version, grants: encodeGrants(grants) }
    }

    /** The version of a role, for the session's minute-by-minute check. */
    static async currentVersion(userId: string): Promise<{ roleId: string | null; roleVersion: number }> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { roleId: true, assignedRole: { select: { version: true } } },
        })
        return { roleId: user?.roleId ?? null, roleVersion: user?.assignedRole?.version ?? 0 }
    }
}
