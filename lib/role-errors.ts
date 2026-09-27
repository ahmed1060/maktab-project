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
        case "SAME_COMPANY": return ApiResponse.badRequest("Choose a different company to copy from")
        case "NOT_FROM_TEMPLATE": return ApiResponse.badRequest("Only roles copied from this template can be updated from it")
    }
    // A duplicate name: roles are unique per company, templates overall.
    if (error?.code === "P2002") return ApiResponse.badRequest("That name is already taken")
    return null
}

/** Managing roles and templates is the Super Admin's alone (ROLES_PLAN.md §4.1). */
export function denyUnlessSuperAdmin(session: any) {
    return session?.user?.role !== "SUPER_ADMIN" ? ApiResponse.forbidden("Only the Super Admin manages roles") : null
}

/**
 * Refusals of handing a role out (ROLES_PLAN.md §4.2), wherever it happens —
 * creating an account or editing one. Null for anything else.
 */
export function assignmentRefusal(error: any) {
    switch (error?.message) {
        case "OWN_ROLE": return ApiResponse.forbidden("Nobody changes their own role")
        case "FORBIDDEN_ROLE_ASSIGNMENT": return ApiResponse.forbidden("You cannot give that role")
        case "ROLE_NOT_IN_COMPANY": return ApiResponse.badRequest("That role is not one of this company's")
        case "ROLE_EXCEEDS_YOURS": return ApiResponse.forbidden("That role holds access you do not have, so you cannot give it")
        case "ACTING_END_IN_PAST": return ApiResponse.badRequest("An acting role must end in the future")
        case "ACTING_NEEDS_ROLE": return ApiResponse.badRequest("Choose the acting role as well as when it ends")
        case "ACTING_ACROSS_COMPANIES": return ApiResponse.badRequest("An acting role cannot be given while moving somebody to another company")
    }
    return null
}

/** Refusals of asking for, or deciding, a role request (ROLES_PLAN.md §6.12). */
export function roleRequestRefusal(error: any) {
    switch (error?.message) {
        case "USER_NOT_FOUND": return ApiResponse.notFound("User not found")
        case "REQUEST_NOT_FOUND": return ApiResponse.notFound("Request not found")
        case "FORBIDDEN": return ApiResponse.forbidden("You cannot do that")
        case "SAME_ROLE": return ApiResponse.badRequest("They already have that role")
        case "ALREADY_PENDING": return ApiResponse.badRequest("A request for this person is already waiting")
        case "ALREADY_DECIDED": return ApiResponse.badRequest("This request has already been decided")
        case "OWN_REQUEST": return ApiResponse.forbidden("Somebody else must decide a request you made")
        case "REASON_REQUIRED": return ApiResponse.badRequest("Say why it is declined")
        case "ADMIN_IS_SUPER_ADMINS": return ApiResponse.forbidden("Only the Super Admin acts on an Admin")
        case "LAST_ADMIN": return ApiResponse.badRequest("A company must keep at least one Admin at work. Give its Admin role to someone else first.")
    }
    return assignmentRefusal(error)
}
