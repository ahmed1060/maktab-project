import { withStandardHandler } from "@/lib/api-utils"
import { getToken } from "next-auth/jwt"
import type { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { UserRole, UserStatus } from "@prisma/client"
import { ApiResponse } from "@/lib/api-response"
import { teamRefusalResponse } from "@/lib/team-handoff-response"
import { newUserSchema, updateUserSchema } from "@/lib/validations/user.schema"
import { ContractStartService } from "@/lib/services/contract-start.service"
import { OwnerService } from "@/lib/services/owner.service"
import { lockedUntil } from "@/lib/sign-in-lock"
import { ownPasswordPausedUntil } from "@/lib/own-password"
import { UserService } from "@/lib/services/user.service"
import { parsePaging } from "@/lib/pagination"
import { buildUserWhereClause, buildUserOrderBy, countedParams, namesCountedParams } from "@/lib/services/user-query"
import { missingNameIds } from "@/lib/names/missing"
import type { CountedStatus } from "@/lib/person-status"
import { onlineRunsOutIn, presenceStatus, presenceWhere } from "@/lib/presence"
import { verifyResourceAccess } from "@/lib/security"
import { can } from "@/lib/permissions/can"
import { shapeUser } from "@/lib/permissions/shape"
import { adminRefusal, assignmentRefusal } from "@/lib/role-errors"
import { assertStepUp } from "@/lib/step-up"
import { CURRENT_PASSWORD_WRONG, OWN_PASSWORD_TRIES, OWN_PASSWORD_WRONG } from "@/lib/own-password"
import { sessionHasModule } from "@/lib/features/require"
import { clientsAnsweredFor } from "@/lib/services/client-accountant.service"

// F-13: role/status are now Postgres enums, not free text — a query-param
// value that isn't a real enum member makes Postgres reject the whole
// query ("invalid input value for enum") instead of the harmless
// zero-match a plain String column used to give a garbage filter value.
// Validate before it reaches Prisma.
const VALID_ROLES: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEADER', 'EMPLOYEE']
const VALID_STATUSES: UserStatus[] = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED', 'OFFLINE', 'ARCHIVED']
// Matched by the profile form, which says it in the reader's language.
const USERNAME_RESERVED = "Username follows another company's username code"
// A WhatsApp number's refusals, said by the profile's card in the reader's
// language (CLIENT_PORTAL_PLAN.md §7, PR 340).
const WHATSAPP_NUMBER_INVALID = "Type an Egyptian mobile starting 01, or the number with its country code (+)"
const WHATSAPP_NOT_IN_PACKAGE = "The company's package doesn't have the client portal"

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
                // Their names in Arabic, for the profile's form (PR 403).
                firstNameAr: true, lastNameAr: true,
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
                // The company's calendar, which a return date is read in
                // (RoleAssignmentService.returnOn): the profile offers its
                // tomorrow as the first day a cover may end on (PR 194).
                company: { select: { timezone: true } },
                // The name, so somebody can be told who manages them. Selected
                // fields rather than the relation, for the same reason the
                // list does it: a leader is a User, and `teamLeader: true`
                // would attach their whole row, salary included.
                teamLeader: { select: { id: true, firstName: true, lastName: true } },
                // Their WhatsApp number, for their clients, which the profile's
                // Contacting clients card shows (CLIENT_PORTAL_PLAN.md §7, PR 340).
                whatsappNumber: true,
            }
        })

        // Salary is the viewer's own or salary.view's — shapeUser decides, as
        // it does for every response that can carry one.
        if (user) {
            // The clients they're the responsible accountant for, which their
            // Contacting clients card names (CLIENT_PORTAL_PLAN.md §7, PR 343):
            // for whoever sees that card, as lib/profile-access.ts has it.
            const answers = (userId === session.user.id || can(session.user, "employees.edit")) && sessionHasModule(session, "TAX_POSITION")
            // When their contract started, for whoever sees their profile,
            // and when their account was made, for the Super Admin alone
            // (LATER_CHANGES_PLAN.md §7.2, PR 425).
            const start = await ContractStartService.of(user.id)
            // And since when they're an owner (LATER_CHANGES_PLAN.md §7.3, PR 426).
            const owner = await OwnerService.of(user.id)
            return ApiResponse.success({
                ...shapeUser(session.user, user),
                ...(answers ? { accountantFor: await clientsAnsweredFor(user.id) } : {}),
                contractStart: start?.date ?? null,
                ownerSince: owner?.since ?? null,
                ...(session.user.role === 'SUPER_ADMIN' ? { accountMadeAt: start?.recordedAt.toISOString() ?? null } : {}),
            })
        }

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

    // When "lately" is, for who's online: the list's and its counts' the same.
    const now = new Date()
    // The names still missing a language, where they're listed or counted
    // (LATER_CHANGES_PLAN.md §3.1, step 5, PR 405): the company's, as far as
    // the rest of the list's question narrows them.
    const asksMissing = searchParams.get('names') === 'missing'
    const countsNames = searchParams.get('counts') === 'names'
    const missingIds = asksMissing || countsNames
        ? await missingNameIds(session.user.role === 'SUPER_ADMIN' ? filterCompanyId : session.user.companyId)
        : undefined
    const built = buildUserWhereClause(session as any, searchParams, filterCompanyId, VALID_ROLES, VALID_STATUSES, now, missingIds)
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
                // Each name in Arabic too, for the page's language (PR 405).
                firstNameAr: true, lastNameAr: true,
                lastActivity: true, role: true, gender: true, username: true,
                // Their newest tab that's here, for whether they're online (lib/presence.ts).
                openTabs: { where: { here: true }, orderBy: { seenAt: "desc" }, take: 1, select: { seenAt: true } },
                company: { select: { id: true, name: true, nameAr: true } },
                totalDifficultyPoints: true,
                teamLeaderId: true,
                // select, not `teamLeader: true`. A leader is a User, and the
                // relation would put a colleague's whole row — salary included
                // — into every line of a list that wants to print a name.
                teamLeader: { select: { id: true, firstName: true, lastName: true, firstNameAr: true, lastNameAr: true } }
            },
            orderBy: buildUserOrderBy(searchParams),
            skip,
            take: limit
        }),
        prisma.user.count({ where: whereClause })
    ])

    // Who's locked out of signing in, and until when, for whoever may unlock
    // them (app/api/users/[id]/unlock-sign-in).
    const locks = can(session.user, "employees.reset_password") ? await lockedUntil(users.map(u => u.id)) : null
    // And whose password tries are paused, which Unlock lifts too (lib/own-password.ts).
    const paused = can(session.user, "employees.reset_password") ? await ownPasswordPausedUntil(users.map(u => u.id)) : null
    // Since when each is an owner, and their company's month now, for the
    // Owners list (LATER_CHANGES_PLAN.md §7.3, step 3c, PR 429).
    const owners = searchParams.get('owners') === 'only' ? await OwnerService.sinceFor(users.map(u => u.id)) : null

    // How many at work have each status, for the Super Admin's All users when
    // it asks (LATER_CHANGES_PLAN.md §6, PR 384): over the company picked, on
    // every page, never the search or the status shown. Not on the Left tab,
    // where everyone has the same status. Online and Offline as the list's
    // own filter asks them; and those counted online, for when the first of
    // them would stop counting, as the page shown may hold none of them.
    const counted = searchParams.get('counts') === 'status' && session.user.role === 'SUPER_ADMIN' && searchParams.get('status') !== 'DELETED'
        ? buildUserWhereClause(session as any, countedParams(searchParams), filterCompanyId, VALID_ROLES, VALID_STATUSES, now)
        : null
    const counts = counted && !counted.empty ? await (async () => {
        const all = counted.whereClause
        const [online, offline, suspended, archived] = await Promise.all([
            prisma.user.findMany({
                where: { AND: [all, presenceWhere("ACTIVE", now)] },
                select: { status: true, openTabs: { where: { here: true }, orderBy: { seenAt: "desc" }, take: 1, select: { seenAt: true } } },
            }),
            prisma.user.count({ where: { AND: [all, presenceWhere("OFFLINE", now)] } }),
            prisma.user.count({ where: { AND: [all, { status: "SUSPENDED" }] } }),
            prisma.user.count({ where: { AND: [all, { status: "ARCHIVED" }] } }),
        ])
        const statusCounts: Record<CountedStatus, number> = { ACTIVE: online.length, OFFLINE: offline, SUSPENDED: suspended, ARCHIVED: archived }
        return { statusCounts, runsOut: onlineRunsOutIn(online.map(u => ({ status: u.status, lastSeen: u.openTabs[0]?.seenAt ?? null })), now) }
    })() : null

    // How many have a name missing a language, for the Employees page's note
    // (PR 405): over everyone the list is for, whatever it's searched or
    // filtered by, or on.
    const namesCounted = countsNames ? buildUserWhereClause(session as any, namesCountedParams(searchParams), filterCompanyId, VALID_ROLES, VALID_STATUSES, now) : null
    const missingNames = namesCounted
        ? namesCounted.empty ? 0 : await prisma.user.count({ where: { AND: [namesCounted.whereClause, { id: { in: missingIds ?? [] } }] } })
        : undefined

    // Each one's newest tab stays here: it says nothing the badge doesn't.
    const usersWithStatus = users.map(({ openTabs, ...user }) => {
        // Online while a tab of theirs is open (lib/presence.ts).
        const effectiveStatus = presenceStatus(user.status, openTabs[0]?.seenAt ?? null, now)
        return {
            ...user, status: effectiveStatus,
            ...(locks ? { signInLockedUntil: locks?.get(user.id)?.toISOString() ?? null } : {}),
            ...(paused ? { ownPasswordPausedUntil: paused?.get(user.id)?.toISOString() ?? null } : {}),
            ...(owners ? { ownerSince: owners.get(user.id)?.since ?? null, thisMonth: owners.get(user.id)?.month ?? null } : {}),
        }
    })

    // When the list is drawn again with nothing heard, as the first person on
    // it online would run out (part 6b): a tab whose leaving wasn't heard runs
    // out with nothing written, so no live signal says so. With counts, the
    // first of everyone counted online.
    const pageRunsOut = onlineRunsOutIn(users.map(u => ({ status: u.status, lastSeen: u.openTabs[0]?.seenAt ?? null })), now)
    const runsOut = [pageRunsOut, counts?.runsOut ?? null].filter((ms): ms is number => ms !== null)
    return ApiResponse.success({
        data: usersWithStatus, total, page, totalPages: Math.ceil(total / limit),
        ...(counts ? { statusCounts: counts.statusCounts } : {}),
        ...(missingNames !== undefined ? { missingNames } : {}),
        onlineRunsOutInMs: runsOut.length ? Math.min(...runsOut) : null,
    })
})

export const POST = withStandardHandler(async (req, session, json) => {
    // 1. Validation
    // Each name in English and in Arabic (PR 402).
    const validation = newUserSchema.safeParse(json)
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
        if (error.message === 'USERNAME_RESERVED') return ApiResponse.badRequest(USERNAME_RESERVED)
        if (error.message === 'TEAM_LEADER_NOT_FOUND') return ApiResponse.badRequest("That team leader no longer exists")
        if (error.message === 'NOT_A_LEADER') return ApiResponse.badRequest("That person is not a team leader")
        if (error.message === 'ONLY_EMPLOYEES_HAVE_LEADERS') return ApiResponse.badRequest("Only employees are assigned to a team leader")
        if (error.message === 'DIFFERENT_COMPANY') return ApiResponse.badRequest("A team leader and their team must be in the same company")
        if (error.message === 'LEADER_UNAVAILABLE') return ApiResponse.badRequest("That team leader's account is archived or deleted")
        // The contract start date, under its field (LATER_CHANGES_PLAN.md §7.2, PR 425).
        if (error.message === 'CONTRACT_START_OUT_OF_RANGE') return ApiResponse.refused(400, "The contract start date must be a date within a year of today.", "CONTRACT_START_OUT_OF_RANGE")
        if (error.message === 'PAYROLL_MONTH_LOCKED') return ApiResponse.refused(409, "That month's payroll is approved.", "PAYROLL_MONTH_LOCKED")

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
        // 3. Service. A new password of one's own keeps the session it's set
        // from, which is named in its cookie (lib/session-kept.ts), and needs
        // the current one but on the forced change, from a session signed in
        // since the temporary password was given (lib/own-password.ts).
        const from = id === session.user.id && validation.data.password
            ? await getToken({ req: req as NextRequest, secret: process.env.NEXTAUTH_SECRET })
            : null
        const result = await UserService.update(validation.data, session, from)
        return ApiResponse.success(shapeUser(session.user, result as any))
    } catch (error: any) {
        // 4. Error Mapping
        if (error.message === 'USER_NOT_FOUND') return ApiResponse.notFound("User not found")
        if (error.message === 'USERNAME_IN_USE') return ApiResponse.badRequest("Username in use")
        if (error.message === 'USERNAME_RESERVED') return ApiResponse.badRequest(USERNAME_RESERVED)
        if (error.message === 'EMAIL_IN_USE') return ApiResponse.badRequest("Email in use")
        // With their codes, as asking for a role answers them, so the profile
        // says them in the reader's language (part 4, PR 194).
        const refusedAdmin = adminRefusal(error)
        if (refusedAdmin) return refusedAdmin
        if (error.message === 'STATUS_HAS_ITS_OWN_FLOW') return ApiResponse.badRequest("Archive by ending the contract, and delete from the employee list — not through an edit")
        // Somebody in another company. Refused inside UserService, and until
        // this was mapped the refusal escaped as a 500 — logged as a system
        // error, and shown to the Admin as the app failing rather than as no.
        if (error.message === 'CROSS_COMPANY_ACCESS_FORBIDDEN') return ApiResponse.forbidden("Access denied")
        if (error.message === 'COMPANY_CHANGE_FORBIDDEN') return ApiResponse.badRequest("A person stays in the company they were added to")
        if (error.message === 'NAME_CHANGE_REQUIRES_ADMIN') return ApiResponse.forbidden("Name changes require admin approval")
        // Under the name's field, as a schema's refusal is (PR 403).
        if (error.message === 'NAME_IN_BOTH_LANGUAGES') return ApiResponse.badRequest("Validation Error", { [error.field]: { _errors: [error.why] } })
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden()
        // A new salary for this month's payroll, approved: said under its
        // choice (LATER_CHANGES_PLAN.md §7.13, PR 437).
        if (error.message === 'PAYROLL_MONTH_LOCKED') return ApiResponse.refused(409, "This month's payroll is approved, so the new salary can only be next month's.", "PAYROLL_MONTH_LOCKED")
        if (error.message === 'FORBIDDEN_PASSWORD_RESET') return ApiResponse.forbidden("Changing somebody else's password needs the reset-password permission")
        // With their codes, said in the reader's language (PR 229).
        if (error.message === 'CURRENT_PASSWORD_WRONG') return ApiResponse.refused(403, CURRENT_PASSWORD_WRONG, 'CURRENT_PASSWORD_WRONG')
        // The saver's own, for somebody else's password or email (PR 231).
        if (error.message === 'OWN_PASSWORD_WRONG') return ApiResponse.refused(403, OWN_PASSWORD_WRONG, 'OWN_PASSWORD_WRONG')
        if (error.message === 'OWN_PASSWORD_TRIES') return ApiResponse.refused(429, OWN_PASSWORD_TRIES, 'OWN_PASSWORD_TRIES')
        if (error.message === 'TARGET_EXCEEDS_YOURS') return ApiResponse.forbidden("This person's role holds access yours doesn't, so only someone who could give it may change their password or email")
        const refusedRole = assignmentRefusal(error)
        if (refusedRole) return refusedRole
        // Team refusals, including the hand-off question, in the one shape
        // every route that can take a leader away answers with.
        const teamRefusal = teamRefusalResponse(error)
        if (teamRefusal) return teamRefusal
        if (error.message === 'EMAIL_CHANGE_REQUIRES_VERIFICATION') return ApiResponse.badRequest("Email changes require verification — use Email settings")
        if (error.message === 'TARGET_PROTECTED') return ApiResponse.forbidden("This account's email is protected and cannot be changed")
        // A WhatsApp number's, with their codes (CLIENT_PORTAL_PLAN.md §7, PR 340).
        if (error.message === 'WHATSAPP_NUMBER_INVALID') return ApiResponse.refused(400, WHATSAPP_NUMBER_INVALID, 'WHATSAPP_NUMBER_INVALID')
        if (error.message === 'NOT_IN_PACKAGE') return ApiResponse.refused(403, WHATSAPP_NOT_IN_PACKAGE, 'NOT_IN_PACKAGE')

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
