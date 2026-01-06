import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function POST(req: Request) {
    try {
        // Support both Session (Manual) and Cron Secret (Automated)
        const authHeader = req.headers.get('Authorization')
        const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`

        const session = await getServerSession(authOptions)
        const isAdmin = session && ['ADMIN', 'SUPER_ADMIN'].includes((session.user as any).role)

        if (!isCron && !isAdmin) {
            return new NextResponse("Unauthorized", { status: 401 })
        }

        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

        // 1. Check for notes expiring TODAY
        const expiringToday = await prisma.businessClientNote.findMany({
            where: {
                expiryDate: {
                    gte: today,
                    lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
                },
                notifiedOnExpiry: false
            },
            include: {
                section: { include: { client: { select: { name: true } } } }
            }
        })

        for (const note of expiringToday) {
            // Notify creator
            if (note.createdById) {
                await prisma.notification.create({
                    data: {
                        userId: note.createdById,
                        type: 'NOTE_EXPIRING',
                        message: `Note "${note.content.substring(0, 20)}..." in ${note.section.client.name} expires today!`,
                        relatedId: `/dashboard/clients/${note.section.clientId}/sections/${note.sectionId}`
                    }
                })
            }
            // Mark as notified
            await prisma.businessClientNote.update({
                where: { id: note.id },
                data: { notifiedOnExpiry: true }
            })
        }

        // 2. Check for notes expiring in X days (Reminder)
        const pendingReminders = await prisma.businessClientNote.findMany({
            where: {
                expiryDate: { gt: now },
                reminderDays: { not: null, gt: 0 },
                notifiedDaysBefore: false
            },
            include: {
                section: { include: { client: { select: { name: true } } } }
            }
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
                            relatedId: `/dashboard/clients/${note.section.clientId}/sections/${note.sectionId}`
                        }
                    })
                }

                await prisma.businessClientNote.update({
                    where: { id: note.id },
                    data: { notifiedDaysBefore: true }
                })
            }
        }

        return NextResponse.json({ success: true, checkedAt: now.toISOString() })
    } catch (error) {
        console.error('Check expiry failed:', error)
        return NextResponse.json({ error: 'Failed to check expiry', details: String(error) }, { status: 500 })
    }
}
