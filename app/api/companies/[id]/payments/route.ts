import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET(
    req: Request,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions)
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const { id } = params

        const payments = await prisma.companyPayment.findMany({
            where: { companyId: id },
            orderBy: { createdAt: 'desc' }
        })

        return NextResponse.json(payments)
    } catch (error) {
        console.error('Fetch payments error:', error)
        return NextResponse.json(
            { error: "Failed to fetch payments" },
            { status: 500 }
        )
    }
}

export async function POST(
    req: Request,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions)
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const { id } = params
        const { cost, subscriptionType } = await req.json()

        if (!cost || !subscriptionType) {
            return NextResponse.json({ error: "Cost and subscription type are required" }, { status: 400 })
        }

        const payment = await prisma.companyPayment.create({
            data: {
                companyId: id,
                cost: parseFloat(cost),
                subscriptionType,
                status: 'UNPAID'
            }
        })

        return NextResponse.json(payment)
    } catch (error) {
        console.error('Create payment error:', error)
        return NextResponse.json(
            { error: "Failed to create payment" },
            { status: 500 }
        )
    }
}
