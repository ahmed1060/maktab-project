import { prisma } from "@/lib/prisma"

export class SystemService {
    static async getBootstrapData(userId: string, role: string) {
        const [user, unreadNotificationsCount] = await Promise.all([
            prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    role: true,
                    avatar: true,
                    gender: true,
                    language: true,
                    companyId: true
                }
            }),
            prisma.notification.count({
                where: { userId: userId, read: false }
            })
        ])

        if (!user) {
            // Check if it's a super admin
            const superAdmin = await prisma.superAdmin.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    avatar: true,
                    gender: true,
                }
            })
            if (superAdmin) {
                const companies = await prisma.company.findMany({
                    orderBy: { name: 'asc' },
                    select: { id: true, name: true }
                })
                const pendingProfileRequestsCount = await prisma.profileUpdateRequest.count({
                    where: { status: 'PENDING' }
                })
                return {
                    user: { ...superAdmin, role: 'SUPER_ADMIN', language: 'en' },
                    companies,
                    counts: {
                        unreadNotifications: unreadNotificationsCount,
                        pendingProfileRequests: pendingProfileRequestsCount
                    }
                }
            }
            throw new Error("USER_NOT_FOUND")
        }

        let companies: any[] = []
        let pendingProfileRequestsCount = 0

        const extraTasks = []
        if (role === 'SUPER_ADMIN') {
            extraTasks.push(
                prisma.company.findMany({
                    orderBy: { name: 'asc' },
                    select: { id: true, name: true }
                }).then(res => companies = res)
            )
        }

        if (['ADMIN', 'SUPER_ADMIN'].includes(role)) {
            extraTasks.push(
                prisma.profileUpdateRequest.count({
                    where: { status: 'PENDING' }
                }).then(res => pendingProfileRequestsCount = res)
            )
        }

        if (extraTasks.length > 0) await Promise.all(extraTasks)

        return {
            user,
            companies,
            counts: {
                unreadNotifications: unreadNotificationsCount,
                pendingProfileRequests: pendingProfileRequestsCount
            }
        }
    }
}
