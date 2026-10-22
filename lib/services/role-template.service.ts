import { prisma } from "@/lib/prisma"
import { normalizeGrants, grantRows, type GrantInput } from "@/lib/permissions/grant-rules"
import { GrantsError, RoleService, checkSeparation } from "./role.service"
import type { UserRole } from "@prisma/client"
import type { CreateTemplateInput, UpdateTemplateInput } from "@/lib/validations/role.schema"

/**
 * Role templates (ROLES_PLAN.md §6.1): the Super Admin's starting points for
 * roles companies commonly need. A company's role is a copy of one, so
 * editing or deleting a template changes no company. Every change is audited
 * with what it was and what it became (§4.2, rule 9).
 */
export class RoleTemplateService {
    static async list() {
        const templates = await prisma.roleTemplate.findMany({ orderBy: { name: "asc" } })
        return templates.map(shape)
    }

    static async getById(id: string) {
        const template = await prisma.roleTemplate.findUnique({ where: { id } })
        if (!template) throw new Error("TEMPLATE_NOT_FOUND")
        return shape(template)
    }

    static async create(input: CreateTemplateInput, session: any) {
        const verdict = normalizeGrants(input.grants)
        if (!verdict.ok) throw new GrantsError(verdict.errors)
        const grants = grantRows(verdict.grants)
        const conflicts = checkSeparation({}, verdict.grants, input.acknowledgeConflicts)
        const created = await prisma.$transaction(async (tx) => {
            const template = await tx.roleTemplate.create({
                data: { name: input.name, description: input.description ?? null, baseRole: input.baseRole, grants },
            })
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("CREATE_ROLE_TEMPLATE", "ROLE_TEMPLATE", template.id, {
                tx, superAdminId: session.user.id,
                details: { after: { name: input.name, baseRole: input.baseRole, grants }, ...(conflicts.length ? { separationOfDuties: { pairs: conflicts, acknowledged: true } } : {}) },
            })
            return template
        })
        return shape(created)
    }

    static async update(input: UpdateTemplateInput, session: any) {
        const before = await RoleTemplateService.getById(input.id)
        let grants = before.grants
        let conflicts: string[] = []
        if (input.grants !== undefined) {
            const verdict = normalizeGrants(input.grants)
            if (!verdict.ok) throw new GrantsError(verdict.errors)
            grants = grantRows(verdict.grants)
            const had = normalizeGrants(before.grants)
            conflicts = checkSeparation(had.ok ? had.grants : {}, verdict.grants, input.acknowledgeConflicts)
        }
        const after = {
            name: input.name ?? before.name,
            description: input.description !== undefined ? input.description : before.description,
            baseRole: (input.baseRole ?? before.baseRole) as UserRole,
            grants,
        }
        await prisma.$transaction(async (tx) => {
            await tx.roleTemplate.update({ where: { id: input.id }, data: after })
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("UPDATE_ROLE_TEMPLATE", "ROLE_TEMPLATE", input.id, {
                tx, superAdminId: session.user.id,
                details: {
                    before: { name: before.name, description: before.description, baseRole: before.baseRole, grants: before.grants }, after,
                    ...(conflicts.length ? { separationOfDuties: { pairs: conflicts, acknowledged: true } } : {}),
                },
            })
        })
        return RoleTemplateService.getById(input.id)
    }

    /**
     * The company roles copied from this template, and how each now differs
     * from it (ROLES_PLAN.md §6.8) — for offering a change to them. Only
     * grants are compared; a role's name and base are the company's.
     */
    static async offers(templateId: string) {
        const template = await RoleTemplateService.getById(templateId)
        const roles = await prisma.role.findMany({
            where: { copiedFromTemplateId: templateId },
            select: {
                id: true, name: true, companyId: true, company: { select: { name: true } },
                grants: { select: { permission: true, scope: true } }, _count: { select: { users: true } },
            },
            orderBy: [{ company: { name: "asc" } }, { name: "asc" }],
        })
        return {
            template,
            roles: roles.map(role => ({
                id: role.id, name: role.name, companyId: role.companyId, companyName: role.company.name,
                holders: role._count.users,
                difference: differenceOf(role.grants, template.grants),
            })),
        }
    }

    /**
     * Apply the template's grants to the roles chosen (§6.8). Nothing changes
     * unless picked; each is an ordinary role edit — checked, versioned so
     * holders reload, and audited — and the push is audited on the template.
     */
    static async applyTo(templateId: string, roleIds: string[], options: { applyNow?: boolean }, session: any) {
        const template = await RoleTemplateService.getById(templateId)
        const roles = await prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, copiedFromTemplateId: true } })
        if (roles.length !== roleIds.length || roles.some(r => r.copiedFromTemplateId !== templateId)) throw new Error("NOT_FROM_TEMPLATE")
        for (const role of roles) {
            // Decided when the template was saved.
            await RoleService.update({ id: role.id, grants: template.grants, acknowledgeConflicts: true, ...(options.applyNow ? { applyNow: true } : {}) }, session)
        }
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log("PUSH_ROLE_TEMPLATE", "ROLE_TEMPLATE", templateId, {
            superAdminId: session.user.id,
            details: { roleIds, grants: template.grants, applyNow: !!options.applyNow },
        })
        return RoleTemplateService.offers(templateId)
    }

    static async delete(id: string, session: any) {
        const before = await RoleTemplateService.getById(id)
        await prisma.$transaction(async (tx) => {
            await tx.roleTemplate.delete({ where: { id } })
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("DELETE_ROLE_TEMPLATE", "ROLE_TEMPLATE", id, {
                tx, superAdminId: session.user.id,
                details: { before: { name: before.name, baseRole: before.baseRole, grants: before.grants } },
            })
        })
        return { id }
    }
}

function shape(t: { id: string; name: string; description: string | null; baseRole: UserRole; grants: unknown; updatedAt: Date }) {
    return {
        id: t.id, name: t.name, description: t.description, baseRole: t.baseRole, updatedAt: t.updatedAt,
        grants: Array.isArray(t.grants) ? (t.grants as GrantInput[]) : [],
    }
}

/** What applying the template would change in a role: added, removed and rescoped grants. */
function differenceOf(role: { permission: string; scope: string }[], template: { permission: string; scope: string }[]) {
    const has = new Map(role.map(g => [g.permission, g.scope]))
    const wants = new Map(template.map(g => [g.permission, g.scope]))
    return {
        added: template.filter(g => !has.has(g.permission)).map(g => g.permission),
        removed: role.filter(g => !wants.has(g.permission)).map(g => g.permission),
        rescoped: template.filter(g => has.has(g.permission) && has.get(g.permission) !== g.scope)
            .map(g => ({ permission: g.permission, from: has.get(g.permission)!, to: g.scope })),
    }
}
