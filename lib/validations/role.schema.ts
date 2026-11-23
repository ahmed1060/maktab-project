import { z } from "zod"

/**
 * The shape of a role or template write. Only the shape: which permissions and
 * scopes are allowed is lib/permissions/grant-rules.ts's, against the catalogue.
 */
const grant = z.object({ permission: z.string().min(1).max(100), scope: z.string().min(1).max(20) })
const name = z.string().trim().min(2, "Name must be at least 2 characters").max(60)
const description = z.string().trim().max(500).optional().nullable()
/** Never SUPER_ADMIN: the Super Admin is outside the role system. */
const baseRole = z.enum(["ADMIN", "TEAM_LEADER", "EMPLOYEE"])
/**
 * The Super Admin's "keep both" for a separation-of-duties pair the grants
 * newly hold (ROLES_PLAN.md §6.11). Without it such a save is refused, so the
 * decision is always made on purpose and recorded.
 */
const acknowledgeConflicts = z.boolean().optional()
/**
 * The Super Admin's "keep it this way" for a permission the grants newly
 * hold that works with less without another (LATER_CHANGES_PLAN.md §5.1 rule
 * 3, PR 373). Without it such a save is refused, as for a pair.
 */
const acknowledgeLess = z.boolean().optional()

export const createRoleSchema = z.object({
    companyId: z.string().min(1),
    name,
    description,
    // From a template, or from scratch. A template supplies both of these
    // unless they are given.
    fromTemplateId: z.string().min(1).optional(),
    baseRole: baseRole.optional(),
    grants: z.array(grant).max(200).optional(),
    acknowledgeConflicts,
    acknowledgeLess,
})

export const updateRoleSchema = z.object({
    id: z.string().min(1),
    name: name.optional(),
    description,
    baseRole: baseRole.optional(),
    grants: z.array(grant).max(200).optional(),
    // Sign everyone holding it out now, rather than letting the change reach
    // them within a minute (§4.4). For a removal that must be instant.
    applyNow: z.boolean().optional(),
    acknowledgeConflicts,
    acknowledgeLess,
})

export const createTemplateSchema = z.object({
    name,
    description,
    baseRole,
    grants: z.array(grant).max(200),
    acknowledgeConflicts,
    acknowledgeLess,
})

export const updateTemplateSchema = z.object({
    id: z.string().min(1),
    name: name.optional(),
    description,
    baseRole: baseRole.optional(),
    grants: z.array(grant).max(200).optional(),
    acknowledgeConflicts,
    acknowledgeLess,
})

export type CreateRoleInput = z.infer<typeof createRoleSchema>
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>
