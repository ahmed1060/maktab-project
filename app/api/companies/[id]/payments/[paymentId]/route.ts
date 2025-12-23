import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function PATCH(
    req: Request,
    { params }: { params: { id: string, paymentId: string } }
) {
    try {
        const session = await getServerSession(authOptions)
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const { paymentId } = params
        const { status } = await req.json()

        if (status !== 'PAID') {
            return NextResponse.json({ error: "Only marking as PAID is supported via PATCH" }, { status: 400 })
        }

        // Get current payment to check type
        const payment = await prisma.companyPayment.findUnique({
            where: { id: paymentId }
        })

        if (!payment) {
            return NextResponse.json({ error: "Payment not found" }, { status: 404 })
        }

        const startDate = new Date()
        const endDate = new Date()

        if (payment.subscriptionType === 'MONTHLY') {
            endDate.setDate(startDate.getDate() + 30)
        } else if (payment.subscriptionType === 'ANNUALLY') {
            endDate.setFullYear(startDate.getFullYear() + 1)
        }

        const updatedPayment = await prisma.companyPayment.update({
            where: { id: paymentId },
            data: {
                status: 'PAID',
                paidAt: startDate,
                startDate,
                endDate
            }
        })

        return NextResponse.json(updatedPayment)
    } catch (error) {
        console.error('Update payment error:', error)
        return NextResponse.json(
            { error: "Failed to update payment" },
            { status: 500 }
        )
    }
}
