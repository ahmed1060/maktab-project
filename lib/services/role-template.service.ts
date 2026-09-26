import { prisma } from "@/lib/prisma"
import { normalizeGrants, grantRows, type GrantInput } from "@/lib/permissions/grant-rules"
import { GrantsError } from "./role.service"
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
        const created = await prisma.$transaction(async (tx) => {
            const template = await tx.roleTemplate.create({
                data: { name: input.name, description: input.description ?? null, baseRole: input.baseRole, grants },
            })
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("CREATE_ROLE_TEMPLATE", "ROLE_TEMPLATE", template.id, {
                tx, superAdminId: session.user.id,
                details: { after: { name: input.name, baseRole: input.baseRole, grants } },
            })
            return template
        })
        return shape(created)
    }

    static async update(input: UpdateTemplateInput, session: any) {
        const before = await RoleTemplateService.getById(input.id)
        let grants = before.grants
        if (input.grants !== undefined) {
            const verdict = normalizeGrants(input.grants)
            if (!verdict.ok) throw new GrantsError(verdict.errors)
            grants = grantRows(verdict.grants)
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
                details: { before: { name: before.name, description: before.description, baseRole: before.baseRole, grants: before.grants }, after },
            })
        })
        return RoleTemplateService.getById(input.id)
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
