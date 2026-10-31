import { NextResponse } from "next/server"
import { ApiResponse } from "@/lib/api-response"
import { GrantsError, SeparationError } from "@/lib/services/role.service"

/**
 * What the role and template services refuse, as answers. Shared by the routes
 * that manage roles, so the same refusal reads the same wherever it comes from.
 */
export function roleErrorResponse(error: any) {
    if (error instanceof GrantsError) return ApiResponse.badRequest("Some permissions cannot be granted that way", { errors: error.errors })
    // The editor warns before saving; this is for a caller that did not look.
    if (error instanceof SeparationError) return ApiResponse.badRequest("This role would hold both sides of a separation-of-duties pair. Confirm to keep both.", { separationOfDuties: error.pairs })
    switch (error?.message) {
        case "ROLE_NOT_FOUND": return ApiResponse.notFound("Role not found")
        case "TEMPLATE_NOT_FOUND": return ApiResponse.notFound("Template not found")
        case "COMPANY_NOT_FOUND": return ApiResponse.notFound("Company not found")
        case "BASE_ROLE_REQUIRED": return ApiResponse.badRequest("Choose a base role, or start from a template")
        case "ROLE_LOCKED": return ApiResponse.badRequest("The built-in Admin role is locked. For a narrower admin, create a separate Admin-based role.")
        case "ROLE_BUILT_IN_FIXED": return ApiResponse.badRequest("A built-in role keeps its name and base role, and cannot be deleted")
        case "ROLE_HELD": return ApiResponse.badRequest("People hold this role. Move them to another role first.")
        case "ROLE_IS_DEFAULT": return ApiResponse.badRequest("This is the company's default role for new accounts. Choose another default first.")
        case "ROLE_REQUESTED": return ApiResponse.badRequest("Somebody has asked for this role. Decide or cancel their request first.")
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
 * A refusal with its code beside its words, as the attendance APIs answer
 * (lib/api-utils.ts), so a screen can say it in the person's language: the
 * Requests page does, for a role request (UI_PLAN.md §2.3, part 5b).
 */
function refused(status: 400 | 403 | 404, message: string, code: string) {
    return NextResponse.json({ success: false, error: message, code }, { status })
}

/**
 * Refusals of handing a role out (ROLES_PLAN.md §4.2), wherever it happens —
 * creating an account or editing one. Null for anything else.
 */
export function assignmentRefusal(error: any) {
    switch (error?.message) {
        case "OWN_ROLE": return refused(403, "Nobody changes their own role", "OWN_ROLE")
        case "FORBIDDEN_ROLE_ASSIGNMENT": return refused(403, "You cannot give that role", "FORBIDDEN_ROLE_ASSIGNMENT")
        case "ROLE_NOT_IN_COMPANY": return refused(400, "That role is not one of this company's", "ROLE_NOT_IN_COMPANY")
        case "ROLE_EXCEEDS_YOURS": return refused(403, "That role holds access you do not have, so you cannot give it", "ROLE_EXCEEDS_YOURS")
        case "ACTING_END_IN_PAST": return refused(400, "An acting role must end in the future", "ACTING_END_IN_PAST")
        case "ACTING_NEEDS_ROLE": return refused(400, "Choose the acting role as well as when it ends", "ACTING_NEEDS_ROLE")
    }
    return null
}

/** Refusals of asking for, or deciding, a role request (ROLES_PLAN.md §6.12). */
export function roleRequestRefusal(error: any) {
    switch (error?.message) {
        case "USER_NOT_FOUND": return refused(404, "User not found", "USER_NOT_FOUND")
        case "REQUEST_NOT_FOUND": return refused(404, "Request not found", "REQUEST_NOT_FOUND")
        case "FORBIDDEN": return refused(403, "You cannot do that", "FORBIDDEN")
        case "SAME_ROLE": return refused(400, "They already have that role", "SAME_ROLE")
        case "ALREADY_PENDING": return refused(400, "A request for this person is already waiting", "ALREADY_PENDING")
        case "ALREADY_DECIDED": return refused(400, "This request has already been decided", "ALREADY_DECIDED")
        case "OWN_REQUEST": return refused(403, "Somebody else must decide a request you made", "OWN_REQUEST")
        case "REASON_REQUIRED": return refused(400, "Say why it is declined", "REASON_REQUIRED")
        case "ADMIN_IS_SUPER_ADMINS": return refused(403, "Only the Super Admin acts on an Admin", "ADMIN_IS_SUPER_ADMINS")
        case "LAST_ADMIN": return refused(400, "A company must keep at least one Admin at work. Give its Admin role to someone else first.", "LAST_ADMIN")
    }
    return assignmentRefusal(error)
}
