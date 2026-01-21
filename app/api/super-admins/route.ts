import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import bcrypt from "bcryptjs"

export async function GET(req: Request) {
    try {
        const session = await getServerSession(authOptions)
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const page = parseInt(searchParams.get('page') || '1')
        const limit = parseInt(searchParams.get('limit') || '10')
        const skip = (page - 1) * limit
        const searchParam = searchParams.get('search')

        const where: any = {}
        if (searchParam) {
            where.OR = [
                { firstName: { contains: searchParam, mode: 'insensitive' } },
                { lastName: { contains: searchParam, mode: 'insensitive' } },
                { email: { contains: searchParam, mode: 'insensitive' } }
            ]
        }

        const [admins, total] = await Promise.all([
            prisma.superAdmin.findMany({
                where,
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    username: true,
                    gender: true,
                    avatar: true,
                },
                orderBy: {
                    firstName: 'asc'
                },
                skip,
                take: limit
            }),
            prisma.superAdmin.count({ where })
        ])

        // Format to match expected frontend Admin type
        const formattedAdmins = admins.map(admin => ({
            ...admin,
            role: 'SUPER_ADMIN',
            status: 'ACTIVE', // Default status for Super Admins
            companyId: null
        }))

        return NextResponse.json({
            data: formattedAdmins,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        })
    } catch {
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
        const { firstName, lastName, email, password, gender, username } = body

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
                username,
                password: hashedPassword,
                gender: gender || 'MALE'
            }
        })

        // Remove password from response
        const adminWithoutPassword = { ...newAdmin } as any
        delete adminWithoutPassword.password

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
