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

        return await prisma.businessClientNote.create({
            data: {
                content: input.content,
                sectionId,
                createdById: userRole === 'SUPER_ADMIN' ? null : userId,
                attachment: Array.isArray(input.attachment) ? JSON.stringify(input.attachment) : input.attachment,
                expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
                reminderDays: input.reminderDays ? parseInt(input.reminderDays.toString()) : null
            }
        })
    }

    static async update(id: string, input: NoteInput, session: any) {
        const userId = session.user.id
        const userRole = session.user.role

        return await prisma.businessClientNote.update({
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
    }

    static async delete(id: string) {
        const note = await prisma.businessClientNote.findUnique({ where: { id } })
        if (!note) throw new Error("NOTE_NOT_FOUND")

        if (note.attachment) {
            try {
                let filesToDelete: any[] = []
                if (note.attachment.startsWith('[')) {
                    try {
                        filesToDelete = JSON.parse(note.attachment)
                    } catch {
                        filesToDelete = [note.attachment]
                    }
                } else {
                    filesToDelete = [note.attachment]
                }

                for (const fileItem of filesToDelete) {
                    if (!fileItem) continue
                    const fileUrl = typeof fileItem === 'string' ? fileItem : fileItem.url
                    if (!fileUrl) continue

                    const urlParts = fileUrl.split('/app-assets/')
                    if (urlParts.length > 1) {
                        const filePath = urlParts[1]
                        await supabase.storage.from('app-assets').remove([filePath])
                    }
                }
            } catch (storageError) {
                console.error('Failed to delete attachment from storage:', storageError)
            }
        }

        return await prisma.businessClientNote.delete({ where: { id } })
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
