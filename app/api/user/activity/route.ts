import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function POST() {
    const session = await getServerSession(authOptions)
    if (!session || !session.user || !session.user.id) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        const user = await prisma.user.update({
            where: { id: session.user.id },
            data: { lastActivity: new Date() },
            select: {
                status: true,
                company: {
                    select: { isBanned: true }
                }
            }
        })

        if (user.status === 'SUSPENDED') {
            return NextResponse.json({ success: true, status: 'SUSPENDED' })
        }

        if (user.company?.isBanned) {
            return NextResponse.json({ success: true, status: 'COMPANY_BANNED' })
        }

        return NextResponse.json({ success: true, status: 'ACTIVE' })
    } catch {
        return new NextResponse("Error updating activity", { status: 500 })
    }
}
