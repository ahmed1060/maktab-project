import { prisma } from "@/lib/prisma"
import { NoteInput } from "../validations/note.schema"
import { supabase } from "@/lib/storage"

export class NoteService {
    static async getMany(sectionId: string, skip: number, take: number, search?: string) {
        const where: any = { sectionId }

        if (search) {
            where.OR = [
                { content: { contains: search, mode: 'insensitive' } },
                {
                    createdBy: {
                        OR: [
                            { firstName: { contains: search, mode: 'insensitive' } },
                            { lastName: { contains: search, mode: 'insensitive' } }
                        ]
                    }
                }
            ]
        }

        const [notes, total] = await Promise.all([
            prisma.businessClientNote.findMany({
                where,
                include: {
                    createdBy: { select: { firstName: true, lastName: true, avatar: true, role: true } },
                    lastEditedBy: { select: { firstName: true, lastName: true, role: true } }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take
            }),
            prisma.businessClientNote.count({ where })
        ])

        return { notes, total }
    }

    static async create(sectionId: string, input: NoteInput, session: any) {
        const userId = session.user.id
        const userRole = session.user.role

        const note = await prisma.businessClientNote.create({
            data: {
                content: input.content,
                sectionId,
                createdById: userRole === 'SUPER_ADMIN' ? null : userId,
                attachment: Array.isArray(input.attachment) ? JSON.stringify(input.attachment) : input.attachment,
                expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
                reminderDays: input.reminderDays ? parseInt(input.reminderDays.toString()) : null
            }
        })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('CREATE_NOTE', 'NOTE', note.id, {
            userId: userRole !== 'SUPER_ADMIN' ? userId : null,
            superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
            details: {
                sectionId,
                hasAttachment: !!input.attachment,
                contentPreview: input.content.substring(0, 50) + (input.content.length > 50 ? '...' : '')
            }
        })

        return note
    }

    static async update(id: string, input: NoteInput, session: any) {
        const userId = session.user.id
        const userRole = session.user.role

        const note = await prisma.businessClientNote.findUnique({
            where: { id },
            include: { section: { include: { client: { select: { companyId: true } } } } }
        })
        if (!note) throw new Error("NOTE_NOT_FOUND")

        // Security: Company Isolation
        if (userRole !== 'SUPER_ADMIN') {
            const userCompanyId = (session.user as any).companyId
            if (note.section.client.companyId !== userCompanyId) {
                throw new Error("ACCESS_DENIED")
            }
        }

        const updated = await prisma.businessClientNote.update({
            where: { id },
            data: {
                content: input.content,
                attachment: Array.isArray(input.attachment) ? JSON.stringify(input.attachment) : input.attachment,
                expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
                reminderDays: input.reminderDays ? parseInt(input.reminderDays.toString()) : null,
                lastEditedById: userRole === 'SUPER_ADMIN' ? null : userId,
                lastEditedAt: new Date()
            }
        })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('UPDATE_NOTE', 'NOTE', id, {
            userId: userRole !== 'SUPER_ADMIN' ? userId : null,
            superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
            details: {
                hasAttachment: !!input.attachment,
                contentPreview: input.content.substring(0, 50) + (input.content.length > 50 ? '...' : '')
            }
        })

        return updated
    }

    static async delete(id: string, session: any) {
        const userRole = session.user.role
        const userId = session.user.id

        const note = await prisma.businessClientNote.findUnique({
            where: { id },
            include: { section: { include: { client: { select: { companyId: true } } } } }
        })
        if (!note) throw new Error("NOTE_NOT_FOUND")

        // Security: Company Isolation
        if (userRole !== 'SUPER_ADMIN') {
            const userCompanyId = (session.user as any).companyId
            if (note.section.client.companyId !== userCompanyId) {
                throw new Error("ACCESS_DENIED")
            }
        }

        if (note.attachment) {
            try {
                let attachments: any[] = []
                try {
                    const parsed = JSON.parse(note.attachment)
                    attachments = Array.isArray(parsed) ? parsed : [parsed]
                } catch {
                    attachments = [{ url: note.attachment }]
                }

                const pathsToDelete = attachments
                    .map(item => (typeof item === 'string' ? item : item.url)?.split('/app-assets/')?.[1])
                    .filter(Boolean) as string[]

                if (pathsToDelete.length > 0) {
                    await supabase.storage.from('app-assets').remove(pathsToDelete)
                }
            } catch (storageError) {
                console.error('Failed to delete attachments from storage:', storageError)
            }
        }

        const result = await prisma.businessClientNote.delete({ where: { id } })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('DELETE_NOTE', 'NOTE', id, {
            userId: userRole !== 'SUPER_ADMIN' ? userId : null,
            superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
            details: {
                sectionId: note.sectionId,
                contentPreview: note.content.substring(0, 50) + (note.content.length > 50 ? '...' : ''),
                hadAttachment: !!note.attachment
            }
        })

        return result
    }

    static async checkExpiries() {
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

        // 1. Expiring Today
        const expiringToday = await prisma.businessClientNote.findMany({
            where: {
                expiryDate: {
                    gte: today,
                    lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
                },
                notifiedOnExpiry: false
            },
            include: { section: { include: { client: { select: { name: true } } } } }
        })

        for (const note of expiringToday) {
            if (note.createdById) {
                await prisma.notification.create({
                    data: {
                        userId: note.createdById,
                        type: 'NOTE_EXPIRING',
                        message: `Note "${note.content.substring(0, 20)}..." in ${note.section.client.name} expires today!`,
                        relatedId: `/dashboard/clients/${note.section.clientId}/sections/${note.sectionId}?highlight=${note.id}`
                    }
                })
            }
            await prisma.businessClientNote.update({
                where: { id: note.id },
                data: { notifiedOnExpiry: true }
            })
        }

        // 2. Reminders
        const pendingReminders = await prisma.businessClientNote.findMany({
            where: {
                expiryDate: { gt: now },
                reminderDays: { not: null, gt: 0 },
                notifiedDaysBefore: false
            },
            include: { section: { include: { client: { select: { name: true } } } } }
        })

        for (const note of pendingReminders) {
            if (!note.expiryDate || !note.reminderDays) continue
            const reminderDate = new Date(note.expiryDate.getTime())
            reminderDate.setDate(reminderDate.getDate() - note.reminderDays)

            if (now >= reminderDate) {
                if (note.createdById) {
                    await prisma.notification.create({
                        data: {
                            userId: note.createdById,
                            type: 'NOTE_REMINDER',
                            message: `Note "${note.content.substring(0, 20)}..." in ${note.section.client.name} is expiring in ${note.reminderDays} days!`,
                            relatedId: `/dashboard/clients/${note.section.clientId}/sections/${note.sectionId}?highlight=${note.id}`
                        }
                    })
                }
                await prisma.businessClientNote.update({
                    where: { id: note.id },
                    data: { notifiedDaysBefore: true }
                })
            }
        }

        return { success: true, checkedAt: now.toISOString() }
    }
}
