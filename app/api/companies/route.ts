import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET() {
    try {
        const companies = await prisma.company.findMany({
            select: {
                id: true,
                name: true
            },
            orderBy: {
                name: 'asc'
            }
        })

        return NextResponse.json(companies)
    } catch (error) {
        return NextResponse.json(
            { error: "Failed to fetch companies" },
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

        const { name } = await req.json()

        if (!name) {
            return NextResponse.json({ error: "Name is required" }, { status: 400 })
        }

        const company = await prisma.company.create({
            data: { name }
        })

        return NextResponse.json(company)
    } catch (error) {
        if ((error as any).code === 'P2002') {
            return NextResponse.json({ error: "Company already exists" }, { status: 400 })
        }
        return NextResponse.json(
            { error: "Failed to create company" },
            { status: 500 }
        )
    }

}

export async function PUT(req: Request) {
    try {
        const session = await getServerSession(authOptions)

        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const { id, name } = await req.json()

        if (!id || !name) {
            return NextResponse.json({ error: "ID and Name are required" }, { status: 400 })
        }

        // Prevent renaming SHSD if strict requirement? User said "company name SHSD by default and can not be changed".
        const existing = await prisma.company.findUnique({ where: { id } })
        if (existing?.name === 'SHSD' && name !== 'SHSD') {
            return NextResponse.json({ error: "Cannot rename the default system company (SHSD)" }, { status: 403 })
        }

        const company = await prisma.company.update({
            where: { id },
            data: { name }
        })

        return NextResponse.json(company)
    } catch (error) {
        if ((error as any).code === 'P2002') {
            return NextResponse.json({ error: "Company name already exists" }, { status: 400 })
        }
        return NextResponse.json(
            { error: "Failed to update company" },
            { status: 500 }
        )
    }
}
