import { prisma } from "@/lib/prisma"
import { optional } from "@/lib/notice"
import { can } from "@/lib/permissions/can"
import { CreateProfileRequestInput } from "../validations/profile.schema"
import { arabicBeside } from "@/lib/names"
import { learnSpellings } from "./name-spelling.service"

export class ProfileService {
    static async getMany(where: any, skip: number, take: number) {
        const [requests, total] = await Promise.all([
            prisma.profileUpdateRequest.findMany({
                where,
                include: {
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                            role: true,
                            company: { select: { name: true } }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take
            }),
            prisma.profileUpdateRequest.count({ where })
        ])

        return { requests, total }
    }

    static async createRequest(input: CreateProfileRequestInput, session: any) {
        const userId = session.user.id

        const existing = await prisma.profileUpdateRequest.findFirst({
            where: { userId, status: 'PENDING' }
        })

        if (existing) throw new Error("PENDING_REQUEST_EXISTS")

        const user = await prisma.user.findUnique({ where: { id: userId } })
        if (!user) throw new Error("USER_NOT_FOUND")

        if (user.firstName === input.newFirstName && user.lastName === input.newLastName) {
            throw new Error("NAME_IDENTICAL")
        }

        return await prisma.profileUpdateRequest.create({
            data: {
                userId,
                oldFirstName: user.firstName,
                oldLastName: user.lastName,
                newFirstName: input.newFirstName,
                newLastName: input.newLastName,
                status: 'PENDING'
            }
        })
    }

    static async approveRequest(id: string, adminNote: string, session: any) {
        if (!can(session.user, "profile_requests.review")) throw new Error("ACCESS_DENIED")

        const request = await prisma.profileUpdateRequest.findUnique({ where: { id } })
        if (!request) throw new Error("REQUEST_NOT_FOUND")
        if (request.status !== 'PENDING') throw new Error("REQUEST_ALREADY_PROCESSED")

        const { verifyResourceAccess, personTarget } = await import("@/lib/security")
        const hasAccess = await verifyResourceAccess(session, request.userId, 'USER')
        if (!hasAccess) throw new Error("ACCESS_DENIED")
        // Nobody decides their own name change (ROLES_PLAN.md §4.2, rule 5).
        const person = await personTarget(request.userId)
        if (!person || !can(session.user, "profile_requests.review", person)) throw new Error("OWN_REQUEST")

        // A name changed in Arabic is its Arabic too (LATER_CHANGES_PLAN.md
        // §3, PR 398); one changed in English, or left as it is, leaves the
        // Arabic as it is.
        const now = await prisma.user.findUnique({ where: { id: request.userId }, select: { firstName: true, lastName: true, firstNameAr: true, lastNameAr: true } })
        const firstNameAr = arabicBeside(request.newFirstName, undefined, now ? { en: now.firstName, ar: now.firstNameAr } : undefined)
        const lastNameAr = arabicBeside(request.newLastName, undefined, now ? { en: now.lastName, ar: now.lastNameAr } : undefined)
        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: request.userId },
                data: {
                    firstName: request.newFirstName, lastName: request.newLastName,
                    ...(firstNameAr !== undefined && { firstNameAr }),
                    ...(lastNameAr !== undefined && { lastNameAr }),
                }
            })
            await tx.profileUpdateRequest.update({
                where: { id },
                data: { status: 'APPROVED', adminNote }
            })

            // Notify user (Centralized)
            const { NotificationService } = await import("./notification.service")
            await NotificationService.notify(
                request.userId,
                'PROFILE_UPDATE',
                { key: 'notice_name_change_approved', params: { name: `${request.newFirstName} ${request.newLastName}` } },
                // The request, which the bell opens on the Requests page (UI_PLAN.md §2.3, part 5a).
                id,
                tx
            )

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('APPROVE_PROFILE_UPDATE', 'USER', request.userId, {
                tx,
                userId: session.user.role !== 'SUPER_ADMIN' ? session.user.id : null,
                superAdminId: session.user.role === 'SUPER_ADMIN' ? session.user.id : null,
                details: { requestId: id, oldName: `${request.oldFirstName} ${request.oldLastName}`, newName: `${request.newFirstName} ${request.newLastName}`, adminNote }
            })
        })
        // What the company saves teaches it (LATER_CHANGES_PLAN.md §3.1, step 3a).
        await learnSpellings(person.companyId, ['employee'])
    }

    static async rejectRequest(id: string, adminNote: string, session: any) {
        if (!can(session.user, "profile_requests.review")) throw new Error("ACCESS_DENIED")

        const request = await prisma.profileUpdateRequest.findUnique({ where: { id } })
        if (!request) throw new Error("REQUEST_NOT_FOUND")
        if (request.status !== 'PENDING') throw new Error("REQUEST_ALREADY_PROCESSED")

        const { verifyResourceAccess, personTarget } = await import("@/lib/security")
        const hasAccess = await verifyResourceAccess(session, request.userId, 'USER')
        if (!hasAccess) throw new Error("ACCESS_DENIED")
        // Nobody decides their own name change (ROLES_PLAN.md §4.2, rule 5).
        const person = await personTarget(request.userId)
        if (!person || !can(session.user, "profile_requests.review", person)) throw new Error("OWN_REQUEST")

        return await prisma.$transaction(async (tx) => {
            await tx.profileUpdateRequest.update({
                where: { id },
                data: { status: 'REJECTED', adminNote }
            })

            // Notify user (Centralized)
            const { NotificationService } = await import("./notification.service")
            await NotificationService.notify(
                request.userId,
                'PROFILE_UPDATE_REJECTED',
                { key: 'notice_name_change_rejected', params: { note: optional('notice_note_suffix', { note: adminNote ?? '' }, adminNote) } },
                // The request, which the bell opens on the Requests page (UI_PLAN.md §2.3, part 5a).
                id,
                tx
            )

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('REJECT_PROFILE_UPDATE', 'USER', request.userId, {
                tx,
                userId: session.user.role !== 'SUPER_ADMIN' ? session.user.id : null,
                superAdminId: session.user.role === 'SUPER_ADMIN' ? session.user.id : null,
                details: { requestId: id, name: `${request.oldFirstName} ${request.oldLastName}`, adminNote }
            })
        })
    }
}
