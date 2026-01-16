import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import bcrypt from "bcryptjs"
import { encrypt } from "@/lib/crypto"

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions)
        if (!session) {
            return new NextResponse("Unauthorized", { status: 401 })
        }

        const { password } = await req.json()

        if (!password) {
            return new NextResponse("Password required", { status: 400 })
        }

        const userId = session.user.id

        // 1. Try finding in regular User table
        const user = await prisma.user.findUnique({
            where: { id: userId }
        })

        if (user) {
            const isValid = await bcrypt.compare(password, user.password)
            if (isValid && !user.plainPasswordEnc) {
                // Auto-heal missing plainPasswordEnc for legacy users
                await prisma.user.update({
                    where: { id: userId },
                    data: { plainPasswordEnc: encrypt(password) }
                })
            }
            return NextResponse.json({ valid: isValid })
        }

        // 2. Try SuperAdmin table
        const superAdmin = await prisma.superAdmin.findUnique({
            where: { id: userId }
        })

        if (superAdmin) {
            const isValid = await bcrypt.compare(password, superAdmin.password)
            if (isValid && !superAdmin.plainPasswordEnc) {
                // Auto-heal missing plainPasswordEnc for legacy Super Admins
                await prisma.superAdmin.update({
                    where: { id: userId },
                    data: { plainPasswordEnc: encrypt(password) }
                })
            }
            return NextResponse.json({ valid: isValid })
        }

        return new NextResponse("User not found", { status: 404 })

    } catch (error) {
        console.error('Password verification error:', error)
        return new NextResponse("Internal Server Error", { status: 500 })
    }
}
