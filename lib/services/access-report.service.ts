import { prisma } from "@/lib/prisma"
import { PERMISSIONS, isPermission, type Permission, type Scope } from "@/lib/permissions/catalogue"
import { holdersOf } from "@/lib/permissions/holders"
import { fromStored, storedNames } from "@/lib/permissions/stored-names"

/**
 * "Who can do this?" (ROLES_PLAN.md §6.5) — the first question after a
 * surprising approval, answered from the grants in the database, which are
 * what can() reads. Super Admin only; the route checks.
 *
 * Both directions: a permission in a company → everyone holding it, at which
 * scope, through which role; and a person → everything they hold and through
 * which role. Deleted accounts are left out: they sign in to nothing.
 */
export class AccessReportService {
    static async whoCan(companyId: string, permission: string) {
        if (!isPermission(permission)) throw new Error("UNKNOWN_PERMISSION")
        const people = await prisma.user.findMany({
            where: { companyId, status: { not: "DELETED" }, ...holdersOf(permission) },
            select: {
                id: true, firstName: true, lastName: true, status: true,
                assignedRole: { select: { id: true, name: true, builtIn: true, grants: { where: { permission: { in: storedNames(permission) } }, select: { scope: true } } } },
            },
            orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        })
        return {
            permission,
            module: PERMISSIONS[permission].module,
            holders: people.map(p => ({
                user: { id: p.id, name: `${p.firstName} ${p.lastName}`, status: p.status },
                role: { id: p.assignedRole!.id, name: p.assignedRole!.name, builtIn: p.assignedRole!.builtIn },
                scope: p.assignedRole!.grants[0]?.scope as Scope,
            })),
        }
    }

    static async whatCan(userId: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true, firstName: true, lastName: true, status: true, companyId: true,
                assignedRole: { select: { id: true, name: true, builtIn: true, baseRole: true, grants: { select: { permission: true, scope: true } } } },
            },
        })
        if (!user) throw new Error("USER_NOT_FOUND")
        const role = user.assignedRole
        const grants = fromStored(role?.grants ?? [])
            // A grant the catalogue no longer knows gates nothing, and can()
            // never sees it (RoleService.forToken skips it too).
            .filter((g): g is { permission: Permission; scope: Scope } => isPermission(g.permission))
            .sort((a, b) => PERMISSIONS[a.permission].code - PERMISSIONS[b.permission].code)
            .map(g => ({ permission: g.permission, module: PERMISSIONS[g.permission].module, scope: g.scope }))
        return {
            user: { id: user.id, name: `${user.firstName} ${user.lastName}`, status: user.status, companyId: user.companyId },
            role: role ? { id: role.id, name: role.name, builtIn: role.builtIn, baseRole: role.baseRole } : null,
            grants,
        }
    }
}
