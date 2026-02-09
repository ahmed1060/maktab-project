import { prisma } from "@/lib/prisma"

export class NotificationService {
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
