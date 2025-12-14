import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import bcrypt from "bcryptjs"

export async function GET() {
    try {
        const session = await getServerSession(authOptions)
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const admins = await prisma.superAdmin.findMany({
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                gender: true,
                avatar: true,
            },
            orderBy: {
                firstName: 'asc'
            }
        })

        // Format to match expected frontend Admin type
        const formattedAdmins = admins.map(admin => ({
            ...admin,
            role: 'SUPER_ADMIN',
            status: 'ACTIVE', // Default status for Super Admins
            companyId: null
        }))

        return NextResponse.json(formattedAdmins)
    } catch (error) {
        return NextResponse.json(
            { error: "Failed to fetch admins" },
            { status: 500 }
        )
    }
}

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions)

        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const body = await req.json()
        const { firstName, lastName, email, password, gender } = body

        if (!firstName || !lastName || !email || !password) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12)

        const newAdmin = await prisma.superAdmin.create({
            data: {
                firstName,
                lastName,
                email,
                password: hashedPassword,
                gender: gender || 'MALE'
            }
        })

        // Remove password from response
        const { password: _, ...adminWithoutPassword } = newAdmin

        return NextResponse.json({
            ...adminWithoutPassword,
            role: 'SUPER_ADMIN',
            status: 'ACTIVE'
        })

    } catch (error) {
        if ((error as any).code === 'P2002') {
            return NextResponse.json({ error: "Email already exists" }, { status: 400 })
        }
        return NextResponse.json(
            { error: "Failed to create admin" },
            { status: 500 }
        )
    }
}
