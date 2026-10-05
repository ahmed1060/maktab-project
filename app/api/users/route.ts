import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { UserRole, UserStatus } from "@prisma/client"
import { ApiResponse } from "@/lib/api-response"
import { teamRefusalResponse } from "@/lib/team-handoff-response"
import { createUserSchema, updateUserSchema } from "@/lib/validations/user.schema"
import { UserService } from "@/lib/services/user.service"
import { parsePaging } from "@/lib/pagination"
import { buildUserWhereClause } from "@/lib/services/user-query"
import { verifyResourceAccess } from "@/lib/security"
import { can } from "@/lib/permissions/can"
import { shapeUser } from "@/lib/permissions/shape"
import { assignmentRefusal } from "@/lib/role-errors"
import { assertStepUp } from "@/lib/step-up"

// F-13: role/status are now Postgres enums, not free text — a query-param
// value that isn't a real enum member makes Postgres reject the whole
// query ("invalid input value for enum") instead of the harmless
// zero-match a plain String column used to give a garbage filter value.
// Validate before it reaches Prisma.
const VALID_ROLES: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEADER', 'EMPLOYEE']
const VALID_STATUSES: UserStatus[] = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED', 'OFFLINE', 'ARCHIVED']

export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('id')

    // 1. Authorization & Single User Fetch
    if (userId) {
        if (userId !== session.user.id && !can(session.user, "employees.view")) {
            return ApiResponse.forbidden()
        }

        // The role check above says *which kinds of people* may look somebody
        // up. It never said *which people* — so an Admin or Team Leader could
        // fetch any user in any company by id and receive their name, email,
        // username, role, status and leave balance, with salary included for
        // an Admin because canViewSalary below keys on the role alone. Every
        // other per-user route in this codebase calls verifyResourceAccess;
        // this one, the one that returns the whole row, did not.
        //
        // It also applies the team rule, so a Team Leader looking up an id
        // outside their team is refused rather than answered.
        if (userId !== session.user.id) {
            const hasAccess = await verifyResourceAccess(session, userId, 'USER')
            if (!hasAccess) return ApiResponse.forbidden()
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true, firstName: true, lastName: true, email: true, status: true,
                role: true, gender: true, salary: true, companyId: true,
                totalDifficultyPoints: true, avatar: true, dayOffCredit: true,
                baseDayOffCredit: true, username: true, teamLeaderId: true,
                // Which of the company's roles they hold, for the Role
                // dropdown (ROLES_PLAN.md §6.4) — its name too, since the
                // viewer may not be allowed to give it and so not have it
                // in their list.
                roleId: true, assignedRole: { select: { name: true, builtIn: true } },
                // A cover in progress (§6.13): until when, and back to what.
                actingUntil: true, returnRole: { select: { name: true, builtIn: true } },
                // The name, so somebody can be told who manages them. Selected
                // fields rather than the relation, for the same reason the
                // list does it: a leader is a User, and `teamLeader: true`
                // would attach their whole row, salary included.
                teamLeader: { select: { id: true, firstName: true, lastName: true } }
            }
        })

        // Salary is the viewer's own or salary.view's — shapeUser decides, as
        // it does for every response that can carry one.
        if (user) return ApiResponse.success(shapeUser(session.user, user))

        const superAdmin = await prisma.superAdmin.findUnique({
            where: { id: userId },
            select: {
                id: true, firstName: true, lastName: true, email: true,
                gender: true, avatar: true, username: true
            }
        })

        if (superAdmin) {
            return ApiResponse.success({
                ...superAdmin,
                status: 'ACTIVE',
                role: 'SUPER_ADMIN',
                salary: 0,
                totalDifficultyPoints: 0
            })
        }
        return ApiResponse.notFound("User not found")
    }

    // 2. Multi-User Fetch (Filtered)
    // Which people each caller sees — company, and for a Team Leader their
    // team — is buildUserWhereClause's. This only asks whether they may list
    // people at all.
    if (!can(session.user, "employees.view")) {
        return ApiResponse.forbidden()
    }

    const companyIdParam = searchParams.get('companyId')
    const companyNameParam = searchParams.get('company')
    let filterCompanyId: string | undefined = undefined

    if (companyIdParam) filterCompanyId = companyIdParam
    else if (companyNameParam) {
        const comp = await prisma.company.findUnique({ where: { name: companyNameParam } })
        if (comp) filterCompanyId = comp.id
    }

    const built = buildUserWhereClause(session as any, searchParams, filterCompanyId, VALID_ROLES, VALID_STATUSES)
    if (built.empty) return ApiResponse.success({ data: [], total: 0, page: 1, totalPages: 0 })
    const whereClause = built.whereClause

    // Stays here rather than moving into the builder: it is a different
    // response shape, not a different query, and it reuses the clause the
    // builder just produced.
    const countOnly = searchParams.get('countOnly')
    if (countOnly === 'deleted') {
        const deletedCount = await prisma.user.count({ where: { ...whereClause, status: 'DELETED' } })
        return ApiResponse.success({ total: deletedCount })
    }

    // Pickers ask for every Team Leader (and the usernames and audit-log
    // screens for everybody) with limit=1000.
    const { page, limit, skip } = parsePaging(searchParams, 10, 1000)

    const [users, total] = await Promise.all([
        prisma.user.findMany({
            where: whereClause,
            select: {
                id: true, firstName: true, lastName: true, email: true, status: true,
                lastActivity: true, role: true, gender: true, username: true,
                company: { select: { id: true, name: true } },
                totalDifficultyPoints: true,
                teamLeaderId: true,
                // select, not `teamLeader: true`. A leader is a User, and the
                // relation would put a colleague's whole row — salary included
                // — into every line of a list that wants to print a name.
                teamLeader: { select: { id: true, firstName: true, lastName: true } }
            },
            orderBy: [{ company: { name: 'asc' } }, { firstName: 'asc' }],
            skip,
            take: limit
        }),
        prisma.user.count({ where: whereClause })
    ])

    const usersWithStatus = users.map(user => {
        let effectiveStatus = user.status
        if (effectiveStatus === 'ACTIVE' && user.lastActivity) {
            const diffMs = new Date().getTime() - new Date(user.lastActivity).getTime()
            if (diffMs > 60000) effectiveStatus = 'OFFLINE'
        }
        return { ...user, status: effectiveStatus }
    })

    return ApiResponse.success({
        data: usersWithStatus, total, page, totalPages: Math.ceil(total / limit)
    })
})

export const POST = withStandardHandler(async (req, session, json) => {
    // 1. Validation
    const validation = createUserSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Service
        const result = await UserService.create(validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        // 3. Error Mapping
        if (error.message === 'ONLY_ADMIN_CAN_CREATE_USERS') return ApiResponse.forbidden("Only Admins can create accounts")
        if (error.message === 'ONLY_SUPER_ADMIN_CAN_CREATE_ADMIN') return ApiResponse.forbidden("Only Super Admin can create Admin users")
        const refusedRole = assignmentRefusal(error)
        if (refusedRole) return refusedRole
        if (error.message === 'TARGET_COMPANY_NOT_FOUND') return ApiResponse.forbidden("Target company not found or access restricted")
        if (error.message === 'USER_ALREADY_EXISTS') return ApiResponse.badRequest("User already exists")
        if (error.message === 'USERNAME_IN_USE') return ApiResponse.badRequest("Username in use")
        if (error.message === 'TEAM_LEADER_NOT_FOUND') return ApiResponse.badRequest("That team leader no longer exists")
        if (error.message === 'NOT_A_LEADER') return ApiResponse.badRequest("That person is not a team leader")
        if (error.message === 'ONLY_EMPLOYEES_HAVE_LEADERS') return ApiResponse.badRequest("Only employees are assigned to a team leader")
        if (error.message === 'DIFFERENT_COMPANY') return ApiResponse.badRequest("A team leader and their team must be in the same company")
        if (error.message === 'LEADER_UNAVAILABLE') return ApiResponse.badRequest("That team leader's account is archived or deleted")

        throw error
    }
}, {
    // Creating an account had no role gate at all. Not here — there was no
    // options object — and not in UserService.create, whose only role rule
    // blocks a non-Super-Admin from making an ADMIN. Everything below that was
    // permitted: any signed-in employee could POST here, create a TEAM_LEADER
    // in their own company, choose its password, and sign in to an account with
    // management access to the whole company. The escalation was one request.
    //
    // Admins only, matching PUT below, which has always required admin-or-self.
    // A Team Leader cannot edit an account, so being able to conjure one was
    // the odd exception rather than a capability anybody relied on.
    permission: "employees.create",
})

export const PUT = withStandardHandler(async (req, session, json) => {
    // 1. Validation
    const validation = updateUserSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    const { id } = validation.data

    // 2. Authorization check
    if (id !== session.user.id && !can(session.user, "employees.edit")) {
        return ApiResponse.forbidden()
    }

    try {
        // 3. Service
        const result = await UserService.update(validation.data, session)
        return ApiResponse.success(shapeUser(session.user, result as any))
    } catch (error: any) {
        // 4. Error Mapping
        if (error.message === 'USER_NOT_FOUND') return ApiResponse.notFound("User not found")
        if (error.message === 'ADMIN_IS_SUPER_ADMINS') return ApiResponse.forbidden("Only the Super Admin acts on an Admin")
        if (error.message === 'LAST_ADMIN') return ApiResponse.badRequest("A company must keep at least one Admin at work. Give its Admin role to someone else first.")
        if (error.message === 'STATUS_HAS_ITS_OWN_FLOW') return ApiResponse.badRequest("Archive by ending the contract, and delete from the employee list — not through an edit")
        // Somebody in another company. Refused inside UserService, and until
        // this was mapped the refusal escaped as a 500 — logged as a system
        // error, and shown to the Admin as the app failing rather than as no.
        if (error.message === 'CROSS_COMPANY_ACCESS_FORBIDDEN') return ApiResponse.forbidden("Access denied")
        if (error.message === 'NAME_CHANGE_REQUIRES_ADMIN') return ApiResponse.forbidden("Name changes require admin approval")
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden()
        if (error.message === 'FORBIDDEN_PASSWORD_RESET') return ApiResponse.forbidden("Changing somebody else's password needs the reset-password permission")
        if (error.message === 'TARGET_EXCEEDS_YOURS') return ApiResponse.forbidden("This person's role holds access yours doesn't, so only someone who could give it may change their password or email")
        const refusedRole = assignmentRefusal(error)
        if (refusedRole) return refusedRole
        // Team refusals, including the hand-off question, in the one shape
        // every route that can take a leader away answers with.
        const teamRefusal = teamRefusalResponse(error)
        if (teamRefusal) return teamRefusal
        if (error.message === 'EMAIL_CHANGE_REQUIRES_VERIFICATION') return ApiResponse.badRequest("Email changes require verification — use Email settings")
        if (error.message === 'TARGET_PROTECTED') return ApiResponse.forbidden("This account's email is protected and cannot be changed")

        throw error
    }
})

export const DELETE = withStandardHandler(async (req, session) => {
    if (!can(session.user, "employees.delete")) return ApiResponse.forbidden()
    // A high-risk action: confirmed with a code within the hour (ROLES_PLAN.md §6.15).
    await assertStepUp(session, "employees.delete")

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    const isPermanent = searchParams.get('permanent') === 'true'

    if (!id) return ApiResponse.badRequest("User ID required")

    try {
        await UserService.delete(id, session, isPermanent)
        return ApiResponse.success({ id: id, permanent: isPermanent })
    } catch (error: any) {
        if (error.message === 'INVALID_ID') return ApiResponse.badRequest("Invalid ID or cannot delete self")
        if (error.message === 'USER_NOT_FOUND') return ApiResponse.notFound("User not found")
        if (error.message === 'ADMIN_IS_SUPER_ADMINS') return ApiResponse.forbidden("Only the Super Admin acts on an Admin")
        if (error.message === 'LAST_ADMIN') return ApiResponse.badRequest("A company must keep at least one Admin at work. Give its Admin role to someone else first.")
        if (error.message === 'CROSS_COMPANY_ACCESS_FORBIDDEN') return ApiResponse.forbidden("Access denied")
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden("Insufficient permissions to delete this user")
        if (error.message === 'MUST_SOFT_DELETE_FIRST') return ApiResponse.badRequest("Must soft-delete the user first")

        throw error
    }
})
