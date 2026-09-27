import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions/can"
import { UserStatus } from "@prisma/client"
import { VerificationService } from "./verification.service"
import { supabase } from "@/lib/storage"
import { RoleAssignmentService } from "./role-assignment.service"
import bcrypt from "bcryptjs"
import { generateUsername } from "@/lib/username"
import { generateTempPassword } from "@/lib/generate-password"

import { CreateUserInput, UpdateUserInput } from "../validations/user.schema"
import { calendarMonth, calendarYear, DEFAULT_TIME_ZONE } from "@/lib/time"
import { effectiveFromChoice } from "@/lib/salary-history"
import { checkTeamAssignment, clearsOwnLeader, stripsLeadership } from "@/lib/team-assignment"
import { notifyTeamMoves } from "./team-notify.service"
import { TeamHandOff, type Rehome } from "./team-handoff.service"

/**
 * The account statuses a status write may set. ARCHIVED and DELETED come only
 * from ending a contract and deleting, which carry their own permissions.
 */
const SETTABLE_STATUSES = ["ACTIVE", "OFFLINE", "SUSPENDED"] as const

export class UserService {
    static async create(input: CreateUserInput, session: any) {
        const userRole = session.user.role
        const { firstName, lastName, email, password, role, roleId, gender, companyId, salary, dayOffCredit, baseDayOffCredit, username, teamLeaderId } = input

        // 1. Role Restrictions
        //
        // Who may create at all, before which role they may create. This half
        // was missing: the rule below governs making an ADMIN, and everything
        // beneath it was open, so an employee could create a TEAM_LEADER and
        // sign into it. The route now carries allowedRoles too, and this is
        // deliberately not just a duplicate of it — the route's gate protects
        // the HTTP entry point, this one protects the operation, so a second
        // caller (a script, a future endpoint, an import) cannot reopen it by
        // forgetting an options object.
        if (!can(session.user, "employees.create")) {
            throw new Error("ONLY_ADMIN_CAN_CREATE_USERS")
        }

        const newUserRole = role || 'EMPLOYEE'
        if ((newUserRole === 'ADMIN' || newUserRole === 'SUPER_ADMIN') && userRole !== 'SUPER_ADMIN') {
            throw new Error("ONLY_SUPER_ADMIN_CAN_CREATE_ADMIN")
        }

        // 2. Company Context
        let targetCompanyId = (session.user as any).companyId
        if (userRole === 'SUPER_ADMIN' && companyId) targetCompanyId = companyId

        if (!targetCompanyId && userRole !== 'SUPER_ADMIN') throw new Error("TARGET_COMPANY_NOT_FOUND")

        // Which role they start on (ROLES_PLAN.md §6.4). An ordinary new
        // account starts on the company's default role. Anything else — a
        // role picked by id, or a Team Leader or Admin by kind — is handing a
        // role out, and goes through the same rules as changing one later: it
        // takes employees.assign_role, and only a role the creator could hand
        // out anyway. Without that, creating an account would be a way round
        // assigning one.
        //
        // Somebody who may only ask for a role — HR — gets the account on the
        // default and a request for the role they picked (§6.12). The request's
        // rules are checked first, so a refusal leaves no account behind.
        let requestRoleId: string | null = null
        const assignment = await (async () => {
            if (!targetCompanyId || newUserRole === 'SUPER_ADMIN') return RoleAssignmentService.builtIn(prisma, newUserRole, targetCompanyId)
            if (!roleId && newUserRole === 'EMPLOYEE') return RoleAssignmentService.defaultFor(prisma, targetCompanyId)
            if (!can(session.user, "employees.assign_role")) {
                if (!roleId || !can(session.user, "employees.request_role")) throw new Error("FORBIDDEN_ROLE_ASSIGNMENT")
                await RoleAssignmentService.chosen(prisma, session.user, roleId, { companyId: targetCompanyId })
                requestRoleId = roleId
                return RoleAssignmentService.defaultFor(prisma, targetCompanyId)
            }
            const id = roleId ?? (await RoleAssignmentService.builtIn(prisma, newUserRole, targetCompanyId)).roleId!
            return RoleAssignmentService.chosen(prisma, session.user, id, { companyId: targetCompanyId })
        })()

        // Who manages the new hire. Checked against the leader's real row, not
        // the id the form sent — the id is the only thing a caller controls,
        // and every rule worth having is about the row behind it.
        if (teamLeaderId) {
            const leader = await prisma.user.findUnique({
                where: { id: teamLeaderId },
                select: { id: true, role: true, companyId: true, status: true },
            })
            if (!leader) throw new Error("TEAM_LEADER_NOT_FOUND")
            const verdict = checkTeamAssignment(
                { id: "", role: assignment.role, companyId: targetCompanyId },
                leader,
            )
            if (!verdict.ok) throw new Error(verdict.refusal.code)
        }

        // 3. Security
        const existingUser = await prisma.user.findUnique({ where: { email } })
        if (existingUser) throw new Error("USER_ALREADY_EXISTS")

        const hashedPassword = await bcrypt.hash(password, 10)

        // 4. Username Logic
        let finalUsername = username
        if (finalUsername) {
            const conflict = await prisma.user.findFirst({ where: { username: { equals: finalUsername as string, mode: 'insensitive' } } })
            if (conflict) throw new Error("USERNAME_IN_USE")
        } else if (targetCompanyId) {
            finalUsername = await generateUsername(targetCompanyId)
        }

        // 5. Database Transaction
        //
        // The user row, the hiring event and the opening salary go in together,
        // because payroll reads the last two and not the first.
        //
        // Writing only the row is what shipped, and it made the intended
        // onboarding flow — Employees, Add Employee, set a salary — produce
        // somebody the register could never pay. A person's employed span only
        // opens on a HIRED or REINSTATED event (lib/employment.ts), and
        // eventForStatusChange has no transition that yields HIRED: it maps
        // status changes, and being created is not one. So compute() skipped
        // them on `timeline.employed.length === 0` forever. The only way
        // through was to archive the person and reinstate them, which is to say
        // fire and rehire somebody to hire them.
        //
        // User.salary is the same story one level down. It is the current rate,
        // a cache of the history; SalaryChange is what splitMonth actually
        // reads. A user row carrying 3000 with no SalaryChange resolves to "No
        // salary in effect" for every month there is.
        //
        // Dated at the moment of creation rather than the start of the month:
        // the employed span and the rate then begin at the same instant, and
        // nobody is paid for days before they existed. An employee who really
        // started earlier needs a back-dated salary change, which the history
        // screen already does.
        const hiredAt = new Date()

        // A Super Admin has no company and draws no salary — the payroll
        // module is about a company's own people.
        const isCompanyEmployee = Boolean(targetCompanyId) && assignment.role !== 'SUPER_ADMIN'

        const user = await prisma.$transaction(async (tx) => {
            // role and roleId together, from the one place that writes them.
            const created = await tx.user.create({
                data: {
                    firstName, lastName, email, username: finalUsername!, password: hashedPassword,
                    ...assignment, status: 'OFFLINE', gender: gender || 'MALE', companyId: targetCompanyId,
                    teamLeaderId: teamLeaderId || null,
                    salary: salary || 0,
                    dayOffCredit: baseDayOffCredit !== undefined ? baseDayOffCredit : (dayOffCredit !== undefined ? dayOffCredit : 0),
                    baseDayOffCredit: baseDayOffCredit !== undefined ? baseDayOffCredit : (dayOffCredit !== undefined ? dayOffCredit : 0),
                    // F-14: the year this credit balance was actually granted,
                    // not a hardcoded year that goes stale for accounts created later.
                    lastDayOffResetYear: calendarYear(new Date())
                },
                select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true, gender: true, username: true }
            })

            if (isCompanyEmployee) {
                const { EmploymentService } = await import("./employment.service")
                await EmploymentService.record({
                    userId: created.id,
                    type: 'HIRED',
                    effectiveFrom: hiredAt,
                    reason: 'Account created',
                    createdById: session?.user?.id ?? null,
                }, tx)

                const { SalaryHistoryService } = await import("./salary-history.service")
                await SalaryHistoryService.record({
                    userId: created.id,
                    monthlyAmount: Number(salary || 0),
                    effectiveFrom: hiredAt,
                    reason: 'Starting salary',
                    createdById: session?.user?.id ?? null,
                }, tx)
            }

            return created
        })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('CREATE_USER', 'USER', user.id, {
            userId: userRole !== 'SUPER_ADMIN' ? session.user.id : null,
            superAdminId: userRole === 'SUPER_ADMIN' ? session.user.id : null,
            details: { email: email, role: assignment.role, roleId: assignment.roleId, companyId: targetCompanyId }
        })

        if (requestRoleId && requestRoleId !== assignment.roleId) {
            const { RoleRequestService } = await import("./role-request.service")
            const request = await RoleRequestService.create({ userId: user.id, roleId: requestRoleId }, session)
            return { ...user, roleRequestId: request.id }
        }
        return user
    }

    static async update(input: UpdateUserInput, session: any) {
        const userRole = session.user.role
        const { id, firstName, lastName, email, password, role, roleId, actingUntil, gender, salary, companyId, avatar, dayOffCredit, baseDayOffCredit, username, status, teamLeaderId, reassignReportsTo } = input

        const regularUser = await prisma.user.findUnique({ where: { id } })
        const superAdminUser = !regularUser ? await prisma.superAdmin.findUnique({ where: { id } }) : null

        if (!regularUser && !superAdminUser) throw new Error("USER_NOT_FOUND")

        // Security: Company Isolation
        if (userRole !== 'SUPER_ADMIN' && regularUser) {
            const requesterCompanyId = (session.user as any).companyId
            if (regularUser.companyId !== requesterCompanyId) {
                throw new Error("CROSS_COMPANY_ACCESS_FORBIDDEN")
            }
        }

        const updateData: any = {}
        const isSelf = id === session.user.id

        // 1. Name Change Restrictions
        if (isSelf && regularUser && ['EMPLOYEE', 'TEAM_LEADER'].includes(regularUser.role)) {
            if ((firstName && firstName !== regularUser.firstName) || (lastName && lastName !== regularUser.lastName)) {
                throw new Error("NAME_CHANGE_REQUIRES_ADMIN")
            }
        }

        // 2. Basic Data
        if (firstName) updateData.firstName = firstName
        if (lastName) updateData.lastName = lastName
        if (email) {
            const currentEmail = regularUser?.email ?? superAdminUser?.email
            if (email !== currentEmail) {
                // F-27: email changes go through the verified flow
                // (VerificationCodeService + /api/account/email) instead —
                // applying one here would mean nothing ever confirmed the
                // new address is actually reachable. Only blocks *self*;
                // an admin correcting a different user's email is
                // unaffected. A protected SuperAdmin's email can't change
                // at all, self-edit or not — the frontend already disables
                // this field for self-edit (EmployeeProfileForm), this is
                // the backend half of that, since a disabled input is not
                // an authorization check.
                if (isSelf) throw new Error("EMAIL_CHANGE_REQUIRES_VERIFICATION")
                if (superAdminUser?.isProtected) throw new Error("TARGET_PROTECTED")
                updateData.email = email
            }
        }
        if (password) {
            // WAVE 10: Security Gate for Admin Password Resets
            const targetRole = regularUser?.role || 'SUPER_ADMIN'
            if (['ADMIN', 'SUPER_ADMIN'].includes(targetRole) && !isSelf && userRole === 'SUPER_ADMIN') {
                const { passcode } = input
                if (!VerificationService.isValid(passcode || "")) {
                    throw new Error("INVALID_PASSCODE")
                }
            }

            updateData.password = await bcrypt.hash(password, 10)
            // Any password change — self-service or admin-forced — satisfies
            // a pending forced reset.
            updateData.mustChangePassword = false
        }
        if (gender) updateData.gender = gender

        // 3. Avatar Management
        if (avatar !== undefined) {
            updateData.avatar = avatar
            const oldAvatar = regularUser?.avatar || superAdminUser?.avatar
            if (oldAvatar && oldAvatar !== avatar) {
                try {
                    const parts = oldAvatar.split('/app-assets/')
                    if (parts.length > 1) await supabase.storage.from('app-assets').remove([parts[1]])
                } catch (e) { console.error('[USER_AVATAR_DELETE_FAIL]', e) }
            }
        }

        // 4. Role & Privileged Fields
        if (regularUser) {
            // The person being edited: a grant's scope, and the rule that
            // nobody decides their own role, pay or allowance (ROLES_PLAN.md
            // §4.2, rules 1 and 5), are checked against them.
            const person = { companyId: regularUser.companyId, userId: regularUser.id, teamLeaderId: regularUser.teamLeaderId }
            if (roleId !== undefined && roleId !== regularUser.roleId) {
                // A role of the company's, by id (ROLES_PLAN.md §6.4), through
                // the rules for handing one out. The company is the one they
                // will be in, if the Super Admin is moving them too.
                if (isSelf) throw new Error("OWN_ROLE")
                if (!can(session.user, "employees.assign_role", person)) throw new Error("FORBIDDEN_ROLE_ASSIGNMENT")
                RoleAssignmentService.onlySuperAdminActsOnAdmins(session.user, regularUser)
                const toCompany = companyId !== undefined && userRole === 'SUPER_ADMIN' ? (companyId || null) : regularUser.companyId
                Object.assign(updateData, await RoleAssignmentService.chosen(prisma, session.user, roleId, { companyId: toCompany, userId: id }))
            } else if (role && can(session.user, "employees.assign_role", person)) {
                // By kind, as the form sent it before roles had ids. It sends
                // the current kind with every save, so only a different one is
                // a change: taking an unchanged one as a change would move
                // somebody on a company's own role — an HR Officer, say — back
                // to the built-in role of that kind whenever their profile was
                // saved.
                if ((role === 'ADMIN' || role === 'SUPER_ADMIN') && userRole !== 'SUPER_ADMIN') {
                    throw new Error("FORBIDDEN_ROLE_ASSIGNMENT")
                }
                if (role !== regularUser.role) {
                    RoleAssignmentService.onlySuperAdminActsOnAdmins(session.user, regularUser)
                    updateData.role = role
                }
            }

            if (username !== undefined && userRole === 'SUPER_ADMIN') updateData.username = username || null

            // Each field is its own permission: changing a salary and changing a
            // leave balance are different acts, and in Part B a company can give
            // them to different people.
            if (salary !== undefined && can(session.user, "salary.edit", person)) {
                // Deliberately not written here. A salary change is an
                // effective-dated fact, not a field edit: it has to land in
                // SalaryChange as well, and the two have to move together or a
                // payslip computed from history will disagree with the number
                // an admin is looking at. SalaryHistoryService.record does both
                // in one transaction, and is called below once the rest of the
                // update has succeeded.
                updateData.salary = salary
            }
            if (can(session.user, "dayoff.adjust_credit", person)) {
                if (dayOffCredit !== undefined) updateData.dayOffCredit = dayOffCredit
                if (baseDayOffCredit !== undefined) {
                    updateData.baseDayOffCredit = baseDayOffCredit
                    const currentYear = calendarYear(new Date())
                    const deductions = await prisma.dayOffRequest.aggregate({
                        where: { userId: id, status: 'APPROVED', deductionType: 'CREDIT', date: { gte: new Date(currentYear, 0, 1), lt: new Date(currentYear + 1, 0, 1) } },
                        _sum: { daysDeducted: true }
                    })
                    updateData.dayOffCredit = baseDayOffCredit - (deductions._sum.daysDeducted || 0)
                }
            }

            if (companyId !== undefined && userRole === 'SUPER_ADMIN') updateData.companyId = companyId || null
            // One rule for account status, here and on the status route: who
            // holds employees.change_status over the person may set them
            // ACTIVE, OFFLINE or SUSPENDED. Ending a contract and deleting are
            // their own flows, with their own permissions, hand-off and
            // settlement; a status write must not be a way round them. The
            // form sends the current status with every save, so an unchanged
            // one is not a change.
            if (status !== undefined && status !== regularUser.status && can(session.user, "employees.change_status", person)) {
                if (!(SETTABLE_STATUSES as readonly string[]).includes(status)) throw new Error("STATUS_HAS_ITS_OWN_FLOW")
                RoleAssignmentService.onlySuperAdminActsOnAdmins(session.user, regularUser)
                updateData.status = status
            }

            // 5. Team membership.
            //
            // Everything below reads the *resulting* person, not the current
            // one. A single request can change a role and an assignment
            // together, and validating against the row as it stands would
            // approve a combination that is invalid the moment it is written —
            // promoting somebody to TEAM_LEADER while handing them a leader,
            // for instance, which the flat structure forbids.
            // Set when a leader is being stripped and an Admin has said
            // where their team goes; applied in the same transaction as the
            // change itself.
            let rehome: Rehome | null = null

            const nextRole = updateData.role ?? regularUser.role
            const nextCompanyId = updateData.companyId !== undefined ? updateData.companyId : regularUser.companyId

            // A leader cannot be stripped out from under their team. Four
            // edits do it and three do not look like demotion — see
            // stripsLeadership. The refusal names the people it is about,
            // because "reassign them first" without saying who sends an Admin
            // hunting through a list.
            if (stripsLeadership(regularUser, { role: updateData.role, companyId: updateData.companyId, status: updateData.status })) {
                rehome = await TeamHandOff.plan({ id, companyId: regularUser.companyId }, reassignReportsTo)
            }

            if (teamLeaderId !== undefined && can(session.user, "employees.assign_team")) {
                if (teamLeaderId === null) {
                    updateData.teamLeaderId = null
                } else {
                    const leader = await prisma.user.findUnique({
                        where: { id: teamLeaderId },
                        select: { id: true, role: true, companyId: true, status: true },
                    })
                    if (!leader) throw new Error("TEAM_LEADER_NOT_FOUND")
                    const verdict = checkTeamAssignment(
                        { id, role: nextRole, companyId: nextCompanyId },
                        leader,
                    )
                    if (!verdict.ok) throw new Error(verdict.refusal.code)
                    updateData.teamLeaderId = teamLeaderId
                }
            }

            // The two below follow from a change already allowed above — a new
            // role, a new company — rather than being changes of their own, so
            // they run for whoever made that change. Tying them to the team
            // permission would let someone who may change a role but not assign
            // teams leave a Team Leader who is led.

            // Gaining a role clears the leader you had. Applied silently,
            // unlike losing one, because it costs nobody their visibility
            // — but it has to happen, or a TEAM_LEADER row keeps a
            // teamLeaderId and becomes a leader who is led.
            if (updateData.teamLeaderId === undefined && clearsOwnLeader(regularUser, updateData.role)) {
                updateData.teamLeaderId = null
            }

            // Moving somebody to another company strands them under a
            // leader who can no longer see them.
            if (updateData.companyId !== undefined && updateData.companyId !== regularUser.companyId) {
                updateData.teamLeaderId = null
            }

            // A new role, or a new company — whose roles are different ones —
            // takes its role and roleId from RoleAssignmentService, together.
            // A role chosen by id has both already. One chosen by kind is that
            // company's built-in role of the kind, handed out under the same
            // rules; a move alone keeps the kind, in the new company.
            if (updateData.roleId === undefined && (updateData.role !== undefined || (updateData.companyId !== undefined && updateData.companyId !== regularUser.companyId))) {
                const next = await RoleAssignmentService.builtIn(prisma, updateData.role ?? regularUser.role, nextCompanyId)
                Object.assign(updateData, updateData.role !== undefined && next.roleId
                    ? await RoleAssignmentService.chosen(prisma, session.user, next.roleId, { companyId: nextCompanyId, userId: id })
                    : next)
            }

            // An acting role (ROLES_PLAN.md §6.13): a role given until a date,
            // then back to the one they had. Given with a role change; alone,
            // it moves the end of a cover already running (null keeps the
            // cover role for good). A move to another company ends it — the role they
            // would return to is not one of that company's.
            const roleChanging = updateData.roleId !== undefined && updateData.roleId !== regularUser.roleId
            const companyChanging = updateData.companyId !== undefined && updateData.companyId !== regularUser.companyId
            if (actingUntil !== undefined && !can(session.user, "employees.assign_role", person)) throw new Error("FORBIDDEN_ROLE_ASSIGNMENT")
            // A date from the form, or an instant a request already worked out.
            const until = actingUntil as string | Date | null | undefined
            const returnOn: Date | null | undefined = until
                ? RoleAssignmentService.returnOn(until, (await prisma.company.findUnique({ where: { id: regularUser.companyId! }, select: { timezone: true } }))?.timezone ?? DEFAULT_TIME_ZONE)
                : until === null ? null : undefined
            if (roleChanging || companyChanging) {
                if (actingUntil && companyChanging) throw new Error("ACTING_ACROSS_COMPANIES")
                Object.assign(updateData, RoleAssignmentService.acting(regularUser, returnOn))
            } else if (actingUntil !== undefined) {
                if (!regularUser.actingUntil) throw new Error("ACTING_NEEDS_ROLE")
                Object.assign(updateData, returnOn
                    ? { actingUntil: RoleAssignmentService.acting(regularUser, returnOn).actingUntil }
                    : { actingUntil: null, returnRoleId: null })
            }

            // Never the company's last Admin at work (ROLES_PLAN.md §4.2, rule 8).
            await RoleAssignmentService.keepsAnAdmin(prisma, id, {
                roleId: updateData.roleId, status: updateData.status, companyId: updateData.companyId,
            })

            const writeSelect = { id: true, firstName: true, lastName: true, email: true, role: true, gender: true, salary: true, companyId: true, avatar: true, dayOffCredit: true, baseDayOffCredit: true, username: true }
            const updated = rehome
                ? await prisma.$transaction(async (tx) => {
                    await TeamHandOff.apply(tx, id, rehome!, { id: session.user.id, role: userRole })
                    return tx.user.update({ where: { id }, data: updateData, select: writeSelect })
                })
                : await prisma.user.update({ where: { id }, data: updateData, select: writeSelect })
            // A role given directly settles any request still waiting for this
            // person (ROLES_PLAN.md §6.12): approving it later would undo the
            // newer decision. Approving a request claims it first, so this
            // never touches the one being approved.
            if (updateData.roleId !== undefined && updateData.roleId !== regularUser.roleId) {
                await prisma.roleRequest.updateMany({
                    where: { userId: id, status: 'PENDING' },
                    data: { status: 'CANCELLED', decidedAt: new Date(), decisionNote: 'Superseded by a direct role change' },
                })
            }
            // salary is a Prisma.Decimal (F-07); Decimal.toJSON() returns a
            // string, which would silently change this response field's type.
            const serializedUpdated = { ...updated, salary: Number(updated.salary) }

            // News of any team change, after it has committed. This person's
            // own move if their leader changed, plus everybody a hand-off
            // moved — in one call, so a leader who receives both hears once.
            const teamMoves = [
                ...(updateData.teamLeaderId !== undefined && updateData.teamLeaderId !== regularUser.teamLeaderId
                    ? [{ userId: id, from: regularUser.teamLeaderId, to: updateData.teamLeaderId }]
                    : []),
                ...TeamHandOff.moves(id, rehome),
            ]
            if (teamMoves.length > 0) await notifyTeamMoves(teamMoves)

            // Salary history and record sync.
            //
            // Only when the value actually moved. The old code ran on every
            // update that mentioned salary, so saving a user's name with the
            // salary field untouched still wrote a change — which would now
            // mean a SalaryChange row saying the salary changed to what it
            // already was, in a history whose whole purpose is to be read back.
            const previousSalary = regularUser ? Number(regularUser.salary) : null
            const salaryMoved = updateData.salary !== undefined
                && previousSalary !== null
                && Number(updateData.salary) !== previousSalary

            // The employment timeline, on the same reasoning as the salary
            // history above: a suspension entered through this screen has to
            // leave a trace, or a payslip pays the suspended month in full
            // because nothing said otherwise. Only real employment transitions
            // produce an event — ACTIVE to OFFLINE is presence, not a contract.
            if (updateData.status !== undefined && updateData.status !== regularUser.status) {
                const { EmploymentService } = await import("./employment.service")
                await EmploymentService.recordStatusChange({
                    userId: id,
                    previousStatus: regularUser.status,
                    newStatus: updateData.status,
                    createdById: session?.user?.id ?? null,
                })
            }

            if (salaryMoved) {
                const now = new Date()
                const { SalaryHistoryService } = await import("./salary-history.service")
                await SalaryHistoryService.record({
                    userId: id,
                    monthlyAmount: Number(updateData.salary),
                    // Effective from the start of the current month unless the
                    // caller says otherwise. P7's screen will offer the
                    // this-month-or-next choice; until it does, the safe default
                    // is the behaviour that already existed — the new salary
                    // applies to the month being worked.
                    effectiveFrom: effectiveFromChoice(now, input.salaryEffective ?? 'THIS_MONTH'),
                    reason: input.salaryReason,
                    createdById: session?.user?.id ?? null,
                })

                const { month: m, year: y } = calendarMonth(now)
                const { SalaryService } = await import("./salary.service")
                await SalaryService.ensureRecordExists(id, m, y, updateData.salary)
            }


            // Audit Log (Enhanced Diffs)
            // normalize() handles `salary`: it's a Prisma.Decimal on the fetched
            // regularUser but a plain number on updateData, so comparing them
            // with !== directly always differs even when the value is unchanged
            // (different types), which would log a spurious "salary changed" on
            // every edit that merely touches an unrelated field.
            const normalize = (v: any) => (v && typeof v === 'object' && typeof v.toNumber === 'function') ? v.toNumber() : v
            const diffs: any = {}
            for (const key in updateData) {
                if (key === 'password' || key === 'mustChangePassword') continue
                const oldVal = normalize(regularUser[key as keyof typeof regularUser])
                const newVal = normalize(updateData[key])
                if (newVal !== oldVal) {
                    diffs[key] = { old: oldVal, new: newVal }
                }
            }

            if (Object.keys(diffs).length > 0) {
                const { AuditLogService } = await import("./audit-log.service")
                await AuditLogService.log('UPDATE_USER', 'USER', id, {
                    userId: userRole !== 'SUPER_ADMIN' ? session.user.id : null,
                    superAdminId: userRole === 'SUPER_ADMIN' ? session.user.id : null,
                    details: diffs
                })
            }

            return serializedUpdated
        }

        if (superAdminUser) {
            const updated = await prisma.superAdmin.update({
                where: { id },
                data: updateData,
                select: { id: true, firstName: true, lastName: true, email: true, gender: true, avatar: true, username: true }
            })
            return { ...updated, role: 'SUPER_ADMIN', status: 'ACTIVE', salary: 0 }
        }
    }

    static async updateLanguage(userId: string, language: string) {
        return await prisma.user.update({
            where: { id: userId },
            data: { language },
            select: { id: true, language: true }
        })
    }

    static async updateActivity(userId: string, role: string) {
        if (role === 'SUPER_ADMIN') {
            return { success: true, status: 'ACTIVE' }
        }

        const [user, settings] = await Promise.all([
            prisma.user.update({
                where: { id: userId },
                data: { lastActivity: new Date() },
                select: {
                    status: true,
                    company: { select: { isBanned: true } }
                }
            }),
            // Live read, not the throttled session copy — this is the
            // heartbeat's whole job: catching a state change within its own
            // 2-minute poll interval rather than waiting on the JWT's 60s
            // staleness window on top of that.
            prisma.systemSettings.findUnique({ where: { id: 'default' }, select: { maintenanceMode: true, maintenanceMessage: true } })
        ])

        if (user.status === 'SUSPENDED') return { success: true, status: 'SUSPENDED' }
        // Reported under its own name, not folded into SUSPENDED. The browser
        // is signed out either way, but the screen it shows on the way out
        // names the reason, and this is not a suspension.
        if (user.status === 'ARCHIVED') return { success: true, status: 'ARCHIVED' }
        if (user.company?.isBanned) return { success: true, status: 'COMPANY_BANNED' }
        if (settings?.maintenanceMode) return { success: true, status: 'MAINTENANCE', maintenanceMessage: settings.maintenanceMessage }

        return { success: true, status: 'ACTIVE' }
    }

    static async updateStatus(userId: string, status: string, session: any) {
        // The same rule as the status field of an edit (see update()).
        const { personTarget } = await import("@/lib/security")
        const person = await personTarget(userId)
        if (!person) throw new Error("USER_NOT_FOUND")
        if (!can(session.user, "employees.change_status", person)) throw new Error("FORBIDDEN")

        if (!(SETTABLE_STATUSES as readonly string[]).includes(status)) {
            throw new Error("INVALID_STATUS")
        }

        const existingUser = await prisma.user.findUnique({ where: { id: userId }, select: { status: true, role: true } })
        if (!existingUser) throw new Error("USER_NOT_FOUND")
        RoleAssignmentService.onlySuperAdminActsOnAdmins(session.user, existingUser)
        await RoleAssignmentService.keepsAnAdmin(prisma, userId, { status })

        const updated = await prisma.user.update({
            where: { id: userId },
            data: { status: status as UserStatus },
            select: { id: true, status: true }
        })

        // Same bridge as UserService.update's. This is the Super Admin path to
        // the same field, and a timeline that records one route but not the
        // other is worse than one that records neither: the gap is invisible,
        // and which route an admin happened to use is not written down anywhere.
        const { EmploymentService } = await import("./employment.service")
        await EmploymentService.recordStatusChange({
            userId,
            previousStatus: existingUser.status,
            newStatus: status,
            createdById: session?.user?.id ?? null,
        })

        // Audit Log (Centralized)
        if (existingUser.status !== status) {
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('UPDATE_USER_STATUS', 'USER', userId, {
                superAdminId: session.user.id,
                details: { status: { old: existingUser.status, new: status } }
            })
        }

        return updated
    }

    static async resetPoints(userId: string, session: any) {
        const requesterRole = session.user.role
        if (!can(session.user, "requests.reset_points")) {
            throw new Error("FORBIDDEN")
        }

        const existingUser = await prisma.user.findUnique({ where: { id: userId }, select: { totalDifficultyPoints: true } })
        if (!existingUser) throw new Error("USER_NOT_FOUND")

        const updated = await prisma.user.update({
            where: { id: userId },
            data: { totalDifficultyPoints: 0 },
            select: { id: true, totalDifficultyPoints: true }
        })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('RESET_USER_POINTS', 'USER', userId, {
            userId: requesterRole !== 'SUPER_ADMIN' ? session.user.id : null,
            superAdminId: requesterRole === 'SUPER_ADMIN' ? session.user.id : null,
            details: { points: { old: existingUser.totalDifficultyPoints, new: 0 } }
        })

        return updated
    }

    static async resetAllPoints(companyId: string, passcode: string, session: any) {
        if (!VerificationService.isValid(passcode)) throw new Error("INVALID_PASSCODE")
        if (session.user.role !== 'SUPER_ADMIN') throw new Error("FORBIDDEN")

        const result = await prisma.user.updateMany({
            where: { companyId, status: { not: 'DELETED' } },
            data: { totalDifficultyPoints: 0 }
        })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('RESET_ALL_POINTS', 'COMPANY', companyId, {
            superAdminId: session.user.id,
            details: { count: result.count, action: 'Bulk Reset Points' }
        })

        return result
    }

    static async getDayOffHistory(userId: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { dayOffCredit: true, baseDayOffCredit: true }
        })

        if (!user) throw new Error("USER_NOT_FOUND")

        const [requests, snapshots] = await Promise.all([
            prisma.dayOffRequest.findMany({
                where: { userId, status: 'APPROVED' },
                orderBy: { date: 'desc' }
            }),
            prisma.dayOffCreditSnapshot.findMany({
                where: { userId },
                orderBy: { year: 'desc' }
            })
        ])

        // Grouped on the same clock the snapshots were keyed on.
        // DayOffCreditSnapshot.year comes from lastDayOffResetYear, which is a
        // calendar year; reading the request's year off the server's clock
        // instead would put a request made late on 31 December under the wrong
        // snapshot — a leave day appearing in a year whose balance never
        // counted it.
        const yearOf = (r: { date: Date }) => calendarYear(new Date(r.date))

        const years = Array.from(new Set([
            ...requests.map(yearOf),
            ...snapshots.map(s => s.year)
        ])).sort((a, b) => b - a)

        const historyByYear = years.map(year => ({
            year,
            snapshot: snapshots.find(s => s.year === year) || null,
            requests: requests.filter(r => yearOf(r) === year)
        }))

        return {
            baseCredit: user.baseDayOffCredit,
            remainingCredit: user.dayOffCredit,
            history: historyByYear
        }
    }

    static async getCostsHistory(userId: string) {
        // Fetch all tasks where this user is an assignee and has a paid cost
        const tasks = await prisma.task.findMany({
            where: {
                assignees: { some: { id: userId } },
                paymentStatus: { in: ['PAID', 'PENDING_PAYMENT'] }
            },
            orderBy: { updatedAt: 'desc' },
            select: {
                id: true,
                title: true,
                updatedAt: true,
                memberCosts: true,
                memberPaymentStatus: true
            }
        })

        return tasks
            .map(task => {
                const memberCosts = (task.memberCosts as any) || {}
                const memberPaymentStatus = (task.memberPaymentStatus as any) || {}
                const cost = memberCosts[userId]
                const status = memberPaymentStatus[userId]

                if (cost !== undefined && cost !== null) {
                    return {
                        id: task.id,
                        title: task.title,
                        amount: cost,
                        status: status || 'PENDING_PAYMENT',
                        date: task.updatedAt
                    }
                }
                return null
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)
    }

    static async verifyPassword(userId: string, password: string) {
        // 1. Try finding in regular User table
        const user = await prisma.user.findUnique({ where: { id: userId } })
        if (user) {
            const isValid = await bcrypt.compare(password, user.password)
            return { valid: isValid }
        }

        // 2. Try SuperAdmin table
        const superAdmin = await prisma.superAdmin.findUnique({ where: { id: userId } })
        if (superAdmin) {
            const isValid = await bcrypt.compare(password, superAdmin.password)
            return { valid: isValid }
        }

        throw new Error("USER_NOT_FOUND")
    }

    /**
     * Replaces the old "reveal password" feature (F-02): rather than
     * decrypting a user's actual password, an admin generates a fresh
     * one-time temporary password. The target must change it at next login
     * (see `mustChangePassword`). Scoped to regular User accounts only —
     * resetting a SuperAdmin's own credentials is out of scope here; see
     * the MFA/reset-flow enhancement (F-27) for that.
     */
    static async resetPassword(targetUserId: string, actingUser: { id: string; role: string }, confirmPassword: string) {
        // 1. Verify the acting admin's own password before letting them
        // reset someone else's — the acting user may be a SuperAdmin or a
        // company ADMIN, so check whichever table they actually live in.
        const actingAccount = actingUser.role === 'SUPER_ADMIN'
            ? await prisma.superAdmin.findUnique({ where: { id: actingUser.id } })
            : await prisma.user.findUnique({ where: { id: actingUser.id } })

        if (!actingAccount) throw new Error("ADMIN_NOT_FOUND")

        const isPasswordValid = await bcrypt.compare(confirmPassword, actingAccount.password)
        if (!isPasswordValid) throw new Error("INVALID_ADMIN_PASSWORD")

        // 2. Locate the target
        const target = await prisma.user.findUnique({ where: { id: targetUserId } })
        if (!target) throw new Error("TARGET_USER_NOT_FOUND")

        // 3. Generate, hash, and store — the plaintext is returned once and never persisted.
        const tempPassword = generateTempPassword()
        const hashedPassword = await bcrypt.hash(tempPassword, 10)

        await prisma.user.update({
            where: { id: targetUserId },
            data: { password: hashedPassword, mustChangePassword: true }
        })

        return { targetUserId, password: tempPassword }
    }

    static async delete(id: string, session: any, isPermanent = false, passcode?: string) {
        if (isPermanent && !VerificationService.isValid(passcode || "")) {
            throw new Error("INVALID_PASSCODE")
        }
        const requesterRole = session.user.role
        const currentUserId = session.user.id

        if (!id || id === currentUserId) throw new Error("INVALID_ID")

        const user = await prisma.user.findUnique({ where: { id } })
        if (!user) throw new Error("USER_NOT_FOUND")

        // Security: Company Isolation
        if (requesterRole !== 'SUPER_ADMIN') {
            const requesterCompanyId = session.user.companyId
            if (user.companyId !== requesterCompanyId) {
                throw new Error("CROSS_COMPANY_ACCESS_FORBIDDEN")
            }
        }

        RoleAssignmentService.onlySuperAdminActsOnAdmins(session.user, user)
        if (user.role === 'SUPER_ADMIN') throw new Error("FORBIDDEN")
        // Never the company's last Admin at work (ROLES_PLAN.md §4.2, rule 8).
        if (!isPermanent) await RoleAssignmentService.keepsAnAdmin(prisma, id, { status: 'DELETED' })

        let result: any
        if (isPermanent) {
            if (user.status !== 'DELETED') throw new Error("MUST_SOFT_DELETE_FIRST")

            // Avatar Cleanup (Strict)
            if (user.avatar) {
                try {
                    const parts = user.avatar.split('/app-assets/')
                    if (parts.length > 1) await supabase.storage.from('app-assets').remove([parts[1]])
                } catch (e) { console.error('[USER_DELETE_AVATAR_FAIL]', e) }
            }

            result = await prisma.user.delete({ where: { id } })
        } else {
            // Soft Delete: We also cleanup avatar
            if (user.avatar) {
                try {
                    const parts = user.avatar.split('/app-assets/')
                    if (parts.length > 1) await supabase.storage.from('app-assets').remove([parts[1]])
                } catch (e) { console.error('[USER_SOFT_DELETE_AVATAR_FAIL]', e) }
            }

            result = await prisma.user.update({
                where: { id },
                data: {
                    status: 'DELETED',
                    email: `${user.email}_DELETED_${Date.now()}`,
                    firstName: 'Ghost',
                    lastName: 'User',
                    username: `deleted_${Date.now()}`,
                    avatar: null
                }
            })
        }

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('DELETE_USER', 'USER', id, {
            userId: requesterRole !== 'SUPER_ADMIN' ? currentUserId : null,
            superAdminId: requesterRole === 'SUPER_ADMIN' ? currentUserId : null,
            details: { isPermanent }
        })

        return result
    }
}
