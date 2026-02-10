import { prisma } from "@/lib/prisma"

export class NotificationService {
    static async notify(userId: string, type: string, message: string, relatedId?: string, tx?: any) {
        const prismaClient = tx || prisma
        return await prismaClient.notification.create({
            data: { userId, type, message, relatedId }
        })
    }

    static async notifyMany(userIds: string[], type: string, message: string, relatedId?: string, tx?: any) {
        const prismaClient = tx || prisma
        if (userIds.length === 0) return

        const BATCH_SIZE = 500
        const results = []

        for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
            const batch = userIds.slice(i, i + BATCH_SIZE)
            results.push(await prismaClient.notification.createMany({
                data: batch.map(userId => ({ userId, type, message, relatedId }))
            }))
        }
        return results
    }

    static async getByUser(userId: string) {
        return await prisma.notification.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" }
        })
    }

    static async markAllAsRead(userId: string) {
        return await prisma.notification.updateMany({
            where: {
                userId,
                read: false
            },
            data: {
                read: true
            }
        })
    }
}
