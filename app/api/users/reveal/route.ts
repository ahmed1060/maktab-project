import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import bcrypt from "bcryptjs"
import { decrypt } from "@/lib/crypto"

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions)
        if (!session || session.user.role !== 'SUPER_ADMIN') {
            return new NextResponse("Unauthorized", { status: 401 })
        }

        const { targetUserId, adminPassword } = await req.json()

        if (!targetUserId || !adminPassword) {
            return new NextResponse("Missing required fields", { status: 400 })
        }

        // 1. Verify Super Admin's own password
        const admin = await prisma.superAdmin.findUnique({
            where: { id: session.user.id }
        })

        if (!admin) {
            return new NextResponse("Admin not found", { status: 404 })
        }

        const isPasswordValid = await bcrypt.compare(adminPassword, admin.password)
        if (!isPasswordValid) {
            return new NextResponse("Invalid admin password", { status: 403 })
        }

        // 2. Fetch target user's encrypted password
        // Check User table
        let targetUser = await prisma.user.findUnique({
            where: { id: targetUserId },
            select: { plainPasswordEnc: true, id: true }
        })

        // Check SuperAdmin table if not found
        if (!targetUser) {
            targetUser = await prisma.superAdmin.findUnique({
                where: { id: targetUserId },
                select: { plainPasswordEnc: true, id: true }
            }) as any
        }

        if (!targetUser) {
            return new NextResponse("Target user not found", { status: 404 })
        }

        if (!targetUser.plainPasswordEnc) {
            return new NextResponse("Password not available for revelation (not yet updated since feature launch)", { status: 400 })
        }

        // 3. Decrypt and return
        const revealedPassword = decrypt(targetUser.plainPasswordEnc)

        return NextResponse.json({ password: revealedPassword })

    } catch (error) {
        console.error('Password revelation error:', error)
        return new NextResponse("Internal Server Error", { status: 500 })
    }
}
