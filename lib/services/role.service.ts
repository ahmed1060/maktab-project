import { prisma } from "@/lib/prisma"
import { BUILT_IN_GRANTS, type BuiltInRole } from "@/lib/permissions/built-in"
import { encodeGrants, type Grants } from "@/lib/permissions/grants"
import { isPermission, type Scope } from "@/lib/permissions/catalogue"
import { normalizeGrants, grantRows, type GrantInput } from "@/lib/permissions/grant-rules"
import type { CreateRoleInput, UpdateRoleInput } from "@/lib/validations/role.schema"
import type { UserRole } from "@prisma/client"
import { resolveBundles, serializeAccess, type SerializedAccess } from "@/lib/features/bundles"
import { newConflicts } from "@/lib/permissions/separation"

type Client = Pick<typeof prisma, "role" | "user">

/** The built-in roles every company has, and what they are called. */
export const BUILT_IN_ROLES: readonly { builtIn: BuiltInRole; name: string }[] = [
    { builtIn: "ADMIN", name: "Admin" },
    { builtIn: "TEAM_LEADER", name: "Team Leader" },
    { builtIn: "EMPLOYEE", name: "Employee" },
]

/** What a session token carries about the person's role (ROLES_PLAN.md §4.4). */
export type RoleForToken = { roleId: string | null; roleVersion: number; grants: string }

/**
 * A role previewed by the Super Admin (ROLES_PLAN.md §6.6): what the session
 * presents while it lasts — that role's grants, in that company, under its
 * package. It previews a role, not a person.
 */
export type RolePreview = {
    roleId: string
    roleName: string
    /** Which built-in role, if one, so the banner can name it in the viewer's language. */
    roleBuiltIn?: UserRole | null
    baseRole: UserRole
    companyId: string
    companyName: string
    grants: string
    featureAccess: SerializedAccess
    startedAt: number
}

/** How long a preview lasts before it ends by itself, if nobody ends it. */
export const PREVIEW_LASTS_MS = 60 * 60 * 1000

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
    /** The preview of a role, for the Super Admin's session (§6.6). */
    static async previewOf(roleId: string): Promise<RolePreview> {
        const role = await prisma.role.findUnique({
            where: { id: roleId },
            select: {
                id: true, name: true, builtIn: true, baseRole: true, companyId: true,
                company: { select: { name: true, package: { select: { hasCompanyManagement: true, hasHR: true } } } },
                grants: { select: { permission: true, scope: true } },
            },
        })
        if (!role) throw new Error("ROLE_NOT_FOUND")
        const grants: Grants = {}
        for (const g of role.grants) if (isPermission(g.permission)) grants[g.permission] = g.scope
        return {
            roleId: role.id, roleName: role.name, roleBuiltIn: role.builtIn, baseRole: role.baseRole,
            companyId: role.companyId, companyName: role.company.name,
            grants: encodeGrants(grants),
            featureAccess: serializeAccess(resolveBundles(role.company.package)),
            startedAt: Date.now(),
        }
    }

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

    // --- Managing a company's roles (ROLES_PLAN.md §4.1, §4.3, §6.2) --------
    //
    // The Super Admin's alone; the routes check that. Every change is audited
    // with what it was and what it became (§4.2, rule 9).

    /** A company's roles, each with its grants and how many people hold it. */
    static async listForCompany(companyId: string) {
        const [roles, company] = await Promise.all([
            prisma.role.findMany({
                where: { companyId },
                include: { grants: { select: { permission: true, scope: true } }, _count: { select: { users: true } } },
                orderBy: [{ builtIn: { sort: "asc", nulls: "last" } }, { name: "asc" }],
            }),
            prisma.company.findUnique({ where: { id: companyId }, select: { defaultRoleId: true } }),
        ])
        return roles.map(role => shapeRole(role, company?.defaultRoleId ?? null))
    }

    static async getById(id: string) {
        const role = await prisma.role.findUnique({
            where: { id },
            include: {
                grants: { select: { permission: true, scope: true } },
                _count: { select: { users: true } },
                company: { select: { defaultRoleId: true } },
            },
        })
        if (!role) throw new Error("ROLE_NOT_FOUND")
        return shapeRole(role, role.company.defaultRoleId)
    }

    static async create(input: CreateRoleInput, session: any) {
        const company = await prisma.company.findUnique({ where: { id: input.companyId }, select: { id: true } })
        if (!company) throw new Error("COMPANY_NOT_FOUND")

        // A copy of the template, never a link to it: changing the template
        // later changes nobody (§0).
        const template = input.fromTemplateId
            ? await prisma.roleTemplate.findUnique({ where: { id: input.fromTemplateId } })
            : null
        if (input.fromTemplateId && !template) throw new Error("TEMPLATE_NOT_FOUND")

        const baseRole = (input.baseRole ?? template?.baseRole) as UserRole | undefined
        if (!baseRole) throw new Error("BASE_ROLE_REQUIRED")
        const verdict = normalizeGrants(input.grants ?? (template?.grants as GrantInput[] | undefined) ?? [])
        if (!verdict.ok) throw new GrantsError(verdict.errors)
        const conflicts = checkSeparation({}, verdict.grants, input.acknowledgeConflicts)

        const role = await prisma.$transaction(async (tx) => {
            const created = await tx.role.create({
                data: {
                    companyId: input.companyId, name: input.name, description: input.description ?? null,
                    baseRole, copiedFromTemplateId: template?.id ?? null,
                    grants: { create: grantRows(verdict.grants) },
                },
            })
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("CREATE_ROLE", "ROLE", created.id, {
                tx, superAdminId: session.user.id,
                details: {
                    companyId: input.companyId, after: { name: input.name, baseRole, grants: grantRows(verdict.grants) }, fromTemplateId: template?.id ?? null,
                    ...(conflicts.length ? { separationOfDuties: { pairs: conflicts, acknowledged: true } } : {}),
                },
            })
            return created
        })
        return RoleService.getById(role.id)
    }

    static async update(input: UpdateRoleInput, session: any) {
        const before = await RoleService.getById(input.id)

        const renames = input.name !== undefined && input.name !== before.name
        const rebases = input.baseRole !== undefined && input.baseRole !== before.baseRole
        const regrants = input.grants !== undefined

        // The one role guaranteed to be able to fix all the others is not
        // itself editable, for any company (§4.2, rule 7). A narrower admin is
        // a separate ADMIN-based role.
        if (before.builtIn === "ADMIN" && (renames || rebases || regrants)) throw new Error("ROLE_LOCKED")
        // The other built-ins may hold different grants per company, but stay
        // what they are called and what kind of person they are.
        if (before.builtIn && (renames || rebases)) throw new Error("ROLE_BUILT_IN_FIXED")
        // A held role's base cannot move under its holders (§4.3); the database
        // refuses it too, this says why.
        if (rebases && before.holders > 0) throw new Error("ROLE_HELD")
        if (rebases && input.baseRole === "ADMIN" && before.isDefault) throw new Error("DEFAULT_ROLE_ADMIN")

        let grants = null as ReturnType<typeof grantRows> | null
        let conflicts: string[] = []
        if (regrants) {
            const verdict = normalizeGrants(input.grants!)
            if (!verdict.ok) throw new GrantsError(verdict.errors)
            grants = grantRows(verdict.grants)
            conflicts = checkSeparation(grantsOfRows(before.grants), verdict.grants, input.acknowledgeConflicts)
        }
        // What a session carries changed: bump the version so holders reload
        // within a minute (§4.4).
        const accessChanged = rebases || (grants !== null && !sameGrants(grants, before.grants))

        await prisma.$transaction(async (tx) => {
            await tx.role.update({
                where: { id: input.id },
                data: {
                    ...(renames ? { name: input.name } : {}),
                    ...(input.description !== undefined ? { description: input.description } : {}),
                    ...(rebases ? { baseRole: input.baseRole } : {}),
                    ...(accessChanged ? { version: { increment: 1 } } : {}),
                },
            })
            if (grants) {
                await tx.roleGrant.deleteMany({ where: { roleId: input.id } })
                await tx.roleGrant.createMany({ data: grants.map(g => ({ roleId: input.id, ...g })) })
            }
            // For a removal that must be instant: sign every holder out now.
            if (input.applyNow && accessChanged) {
                await tx.user.updateMany({ where: { roleId: input.id }, data: { sessionVersion: { increment: 1 } } })
            }
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("UPDATE_ROLE", "ROLE", input.id, {
                tx, superAdminId: session.user.id,
                details: {
                    companyId: before.companyId,
                    before: { name: before.name, description: before.description, baseRole: before.baseRole, grants: before.grants },
                    after: {
                        name: renames ? input.name : before.name,
                        description: input.description !== undefined ? input.description : before.description,
                        baseRole: rebases ? input.baseRole : before.baseRole,
                        grants: grants ?? before.grants,
                    },
                    holders: before.holders,
                    appliedNow: !!(input.applyNow && accessChanged),
                    ...(conflicts.length ? { separationOfDuties: { pairs: conflicts, acknowledged: true } } : {}),
                },
            })
        })
        return RoleService.getById(input.id)
    }

    static async delete(id: string, session: any) {
        const role = await RoleService.getById(id)
        if (role.builtIn) throw new Error("ROLE_BUILT_IN_FIXED")
        // Nobody is ever left without a role (§4.3): reassign them first —
        // including anybody acting elsewhere who is due back to it (§6.13).
        if (role.holders > 0) throw new Error("ROLE_HELD")
        if (await prisma.user.count({ where: { returnRoleId: id } }) > 0) throw new Error("ROLE_HELD")
        if (role.isDefault) throw new Error("ROLE_IS_DEFAULT")
        // Somebody has asked for it: deleting the role would delete their
        // request with it, unseen. Decide or cancel the requests first.
        if (await prisma.roleRequest.count({ where: { roleId: id, status: "PENDING" } }) > 0) throw new Error("ROLE_REQUESTED")
        await prisma.$transaction(async (tx) => {
            await tx.role.delete({ where: { id } })
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("DELETE_ROLE", "ROLE", id, {
                tx, superAdminId: session.user.id,
                details: { companyId: role.companyId, before: { name: role.name, baseRole: role.baseRole, grants: role.grants } },
            })
        })
        return { id }
    }

    /**
     * Copy another company's roles into this one (ROLES_PLAN.md §6.7), as
     * independent copies: nothing links them afterwards. Each copy is an
     * ordinary creation, checked and audited as one.
     *
     * - A role whose name the company already uses is skipped, never
     *   overwritten, and reported.
     * - With `includeBuiltIn`, the source's Team Leader and Employee grants
     *   replace this company's (the built-in Admin is locked everywhere).
     * - If the source's default for new accounts is one of the roles copied,
     *   the copy becomes this company's default.
     */
    static async copyFrom(targetCompanyId: string, sourceCompanyId: string, options: { includeBuiltIn?: boolean }, session: any) {
        if (targetCompanyId === sourceCompanyId) throw new Error("SAME_COMPANY")
        const [source, target, sourceCompany] = await Promise.all([
            RoleService.listForCompany(sourceCompanyId),
            RoleService.listForCompany(targetCompanyId),
            prisma.company.findUnique({ where: { id: sourceCompanyId }, select: { defaultRoleId: true } }),
        ])
        if (!sourceCompany) throw new Error("COMPANY_NOT_FOUND")
        if (!(await prisma.company.findUnique({ where: { id: targetCompanyId }, select: { id: true } }))) throw new Error("COMPANY_NOT_FOUND")

        const taken = new Set(target.map(r => r.name.toLowerCase()))
        const copied: { from: string; to: string; name: string }[] = []
        const skipped: string[] = []
        for (const role of source.filter(r => !r.builtIn)) {
            if (taken.has(role.name.toLowerCase())) { skipped.push(role.name); continue }
            const templateExists = role.copiedFromTemplateId
                && await prisma.roleTemplate.findUnique({ where: { id: role.copiedFromTemplateId }, select: { id: true } })
            const created = await RoleService.create({
                companyId: targetCompanyId, name: role.name, description: role.description,
                baseRole: role.baseRole as any, grants: role.grants,
                ...(templateExists ? { fromTemplateId: role.copiedFromTemplateId! } : {}),
                // Decided when the source role was saved.
                acknowledgeConflicts: true,
            }, session)
            copied.push({ from: role.id, to: created.id, name: role.name })
        }

        const builtInsUpdated: string[] = []
        if (options.includeBuiltIn) {
            for (const kind of ["TEAM_LEADER", "EMPLOYEE"] as const) {
                const from = source.find(r => r.builtIn === kind)
                const to = target.find(r => r.builtIn === kind)
                if (from && to && !sameGrants(from.grants, to.grants)) {
                    await RoleService.update({ id: to.id, grants: from.grants, acknowledgeConflicts: true }, session)
                    builtInsUpdated.push(to.name)
                }
            }
        }

        const defaultCopy = copied.find(c => c.from === sourceCompany.defaultRoleId)
        if (defaultCopy) await RoleService.setDefault(targetCompanyId, defaultCopy.to, session)

        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log("COPY_ROLES", "COMPANY", targetCompanyId, {
            superAdminId: session.user.id,
            details: { sourceCompanyId, copied: copied.map(c => c.name), skipped, builtInsUpdated, defaultRole: defaultCopy?.name ?? null },
        })
        return { copied: copied.map(c => c.name), skipped, builtInsUpdated, defaultRole: defaultCopy?.name ?? null }
    }

    /**
     * Which modules the company's package holds, for the permission matrix to
     * grey out the rest (ROLES_PLAN.md §6.3). A grant in a module the company
     * has not bought is allowed — the package may change — but does nothing
     * until it does, and the screen should say so.
     */
    static async accessOf(companyId: string): Promise<SerializedAccess> {
        const company = await prisma.company.findUnique({
            where: { id: companyId },
            select: { package: { select: { hasCompanyManagement: true, hasHR: true } } },
        })
        if (!company) throw new Error("COMPANY_NOT_FOUND")
        return serializeAccess(resolveBundles(company.package))
    }

    /**
     * The role a company's new accounts start on (ROLES_PLAN.md §6.4) — one
     * of its own, never Admin-based. Null goes back to the built-in Employee.
     * The database holds the same line (the role templates migration).
     */
    static async setDefault(companyId: string, roleId: string | null, session: any) {
        const company = await prisma.company.findUnique({ where: { id: companyId }, select: { defaultRoleId: true } })
        if (!company) throw new Error("COMPANY_NOT_FOUND")
        if (roleId) {
            const role = await prisma.role.findUnique({ where: { id: roleId }, select: { companyId: true, baseRole: true } })
            if (!role || role.companyId !== companyId) throw new Error("ROLE_NOT_FOUND")
            if (role.baseRole === "ADMIN") throw new Error("DEFAULT_ROLE_ADMIN")
        }
        await prisma.$transaction(async (tx) => {
            await tx.company.update({ where: { id: companyId }, data: { defaultRoleId: roleId } })
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("SET_DEFAULT_ROLE", "COMPANY", companyId, {
                tx, superAdminId: session.user.id,
                details: { before: company.defaultRoleId, after: roleId },
            })
        })
        return RoleService.listForCompany(companyId)
    }
}

/** Grants that failed the catalogue's rules, with every reason. */
export class GrantsError extends Error {
    constructor(public readonly errors: string[]) {
        super("INVALID_GRANTS")
    }
}

function shapeRole(
    role: {
        id: string; companyId: string; name: string; description: string | null; baseRole: UserRole
        builtIn: UserRole | null; version: number; copiedFromTemplateId: string | null
        grants: { permission: string; scope: string }[]; _count: { users: number }
    },
    defaultRoleId: string | null,
) {
    const grants: Grants = {}
    for (const g of role.grants) if (isPermission(g.permission)) grants[g.permission] = g.scope as Scope
    return {
        id: role.id, companyId: role.companyId, name: role.name, description: role.description,
        baseRole: role.baseRole, builtIn: role.builtIn, version: role.version,
        copiedFromTemplateId: role.copiedFromTemplateId,
        holders: role._count.users,
        // The default is the chosen role, or the built-in Employee when none is.
        isDefault: defaultRoleId ? role.id === defaultRoleId : role.builtIn === "EMPLOYEE",
        locked: role.builtIn === "ADMIN",
        grants: grantRows(grants),
    }
}

function sameGrants(a: { permission: string; scope: string }[], b: { permission: string; scope: string }[]) {
    const key = (g: { permission: string; scope: string }[]) => g.map(x => `${x.permission}:${x.scope}`).sort().join(",")
    return key(a) === key(b)
}


/** Grants as the catalogue knows them, from rows. */
function grantsOfRows(rows: { permission: string; scope: string }[]): Grants {
    const grants: Grants = {}
    for (const g of rows) if (isPermission(g.permission)) grants[g.permission] = g.scope as Scope
    return grants
}

/**
 * Separation of duties (§6.11): the pairs a save newly brings into a role or
 * template. Allowed, but only on purpose — refused until acknowledged, and
 * the caller records the pairs with the decision. Returns them.
 */
export function checkSeparation(before: Grants, after: Grants, acknowledged: boolean | undefined): string[] {
    const added = newConflicts(before, after)
    if (added.length && !acknowledged) throw new SeparationError(added)
    return added
}

/** A save that newly holds both sides of a pair, not yet acknowledged. */
export class SeparationError extends Error {
    constructor(public readonly pairs: string[]) {
        super("SEPARATION_UNACKNOWLEDGED")
    }
}
