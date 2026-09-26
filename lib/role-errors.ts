import { ApiResponse } from "@/lib/api-response"
import { GrantsError } from "@/lib/services/role.service"

/**
 * What the role and template services refuse, as answers. Shared by the routes
 * that manage roles, so the same refusal reads the same wherever it comes from.
 */
export function roleErrorResponse(error: any) {
    if (error instanceof GrantsError) return ApiResponse.badRequest("Some permissions cannot be granted that way", { errors: error.errors })
    switch (error?.message) {
        case "ROLE_NOT_FOUND": return ApiResponse.notFound("Role not found")
        case "TEMPLATE_NOT_FOUND": return ApiResponse.notFound("Template not found")
        case "COMPANY_NOT_FOUND": return ApiResponse.notFound("Company not found")
        case "BASE_ROLE_REQUIRED": return ApiResponse.badRequest("Choose a base role, or start from a template")
        case "ROLE_LOCKED": return ApiResponse.badRequest("The built-in Admin role is locked. For a narrower admin, create a separate Admin-based role.")
        case "ROLE_BUILT_IN_FIXED": return ApiResponse.badRequest("A built-in role keeps its name and base role, and cannot be deleted")
        case "ROLE_HELD": return ApiResponse.badRequest("People hold this role. Move them to another role first.")
        case "ROLE_IS_DEFAULT": return ApiResponse.badRequest("This is the company's default role for new accounts. Choose another default first.")
        case "DEFAULT_ROLE_ADMIN": return ApiResponse.badRequest("The company's default role cannot be Admin-based")
    }
    // A duplicate name: roles are unique per company, templates overall.
    if (error?.code === "P2002") return ApiResponse.badRequest("That name is already taken")
    return null
}

/** Managing roles and templates is the Super Admin's alone (ROLES_PLAN.md §4.1). */
export function denyUnlessSuperAdmin(session: any) {
    return session?.user?.role !== "SUPER_ADMIN" ? ApiResponse.forbidden("Only the Super Admin manages roles") : null
}
