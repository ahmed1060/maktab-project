import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = (session.user as any).id
    const userRole = (session.user as any).role

    try {
        // Parallel fetching for performance
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
            return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }

        let companies: any[] = []
        let pendingProfileRequestsCount = 0

        // Role-based data fetching
        const extraTasks = []

        if (userRole === 'SUPER_ADMIN') {
            extraTasks.push(
                prisma.company.findMany({
                    orderBy: { name: 'asc' },
                    select: { id: true, name: true }
                }).then(res => companies = res)
            )
        }

        if (['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
            extraTasks.push(
                prisma.profileUpdateRequest.count({
                    where: { status: 'PENDING' }
                }).then(res => pendingProfileRequestsCount = res)
            )
        }

        if (extraTasks.length > 0) {
            await Promise.all(extraTasks)
        }

        return NextResponse.json({
            user,
            companies,
            counts: {
                unreadNotifications: unreadNotificationsCount,
                pendingProfileRequests: pendingProfileRequestsCount
            }
        })

    } catch (error) {
        console.error('Bootstrap API error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
