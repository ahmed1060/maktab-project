import { prisma } from "@/lib/prisma"
import type { NoticeText } from "@/lib/notice"
import { noticeRow } from "@/lib/notice-row"

/**
 * A notification is addressed to exactly one recipient, and a recipient is
 * either a company User or a platform SuperAdmin. The two live in separate
 * tables with independent UUID spaces (see the polymorphic_notification_recipient
 * migration), so the row carries one of two FK columns and a DB CHECK constraint
 * guarantees exactly one is set.
 */
export class NotificationService {
    /**
     * Matches whichever column this principal's id belongs in.
     *
     * Deliberately not a branch on session role. An id can only ever satisfy one
     * of the two columns — they draw from different tables — so the OR is
     * unambiguous, and role is not a reliable discriminator anyway: this codebase
     * also supports a User row carrying role 'SUPER_ADMIN', whose notifications
     * belong under userId, not superAdminId.
     */
    static recipientFilter(principalId: string) {
        return { OR: [{ userId: principalId }, { superAdminId: principalId }] }
    }

    static async notify(userId: string, type: string, text: NoticeText, relatedId?: string, tx?: any) {
        const prismaClient = tx || prisma
        return await prismaClient.notification.create({
            data: { userId, type, ...noticeRow(text), relatedId }
        })
    }

    static async notifyMany(userIds: string[], type: string, text: NoticeText, relatedId?: string, tx?: any) {
        const prismaClient = tx || prisma
        if (userIds.length === 0) return
        const row = noticeRow(text)

        const BATCH_SIZE = 500
        const results = []

        for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
            const batch = userIds.slice(i, i + BATCH_SIZE)
            results.push(await prismaClient.notification.createMany({
                data: batch.map(userId => ({ userId, type, ...row, relatedId }))
            }))
        }
        return results
    }

    /**
     * The SuperAdmin-table counterpart of notifyMany. Kept separate rather than
     * folded into it with a flag, because picking the wrong column here is the
     * exact defect this whole model change exists to fix — the caller should have
     * to say which table its ids came from.
     */
    static async notifySuperAdmins(superAdminIds: string[], type: string, text: NoticeText, relatedId?: string, tx?: any) {
        const prismaClient = tx || prisma
        if (superAdminIds.length === 0) return
        const row = noticeRow(text)

        const BATCH_SIZE = 500
        const results = []

        for (let i = 0; i < superAdminIds.length; i += BATCH_SIZE) {
            const batch = superAdminIds.slice(i, i + BATCH_SIZE)
            results.push(await prismaClient.notification.createMany({
                data: batch.map(superAdminId => ({ superAdminId, type, ...row, relatedId }))
            }))
        }
        return results
    }

    static async getByUser(principalId: string) {
        return await prisma.notification.findMany({
            where: NotificationService.recipientFilter(principalId),
            orderBy: { createdAt: "desc" }
        })
    }

    static async markAllAsRead(principalId: string) {
        return await prisma.notification.updateMany({
            where: {
                ...NotificationService.recipientFilter(principalId),
                read: false
            },
            data: {
                read: true
            }
        })
    }

    static async countUnread(principalId: string) {
        return await prisma.notification.count({
            where: { ...NotificationService.recipientFilter(principalId), read: false }
        })
    }
}
