import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { verifyResourceAccess } from "@/lib/security"

export async function POST(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    const userRole = (session.user as any).role
    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        return new NextResponse("Forbidden", { status: 403 })
    }

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK')
    if (!hasAccess) {
        return new NextResponse("Access Denied", { status: 403 })
    }

    try {
        const { amount, userId } = await req.json()
        if (!amount || !userId) return new NextResponse("Missing data", { status: 400 })

        const now = new Date()
        const currentMonth = now.getMonth() + 1
        const currentYear = now.getFullYear()

        const result = await prisma.$transaction(async (tx) => {
            // 1. Get task to verify existence and add comment
            const task = await tx.task.findUnique({ where: { id: params.id } })
            if (!task) throw new Error("Task not found")

            // 2. Update/Create Salary Record
            const salaryRecord = await tx.salaryRecord.findUnique({
                where: { userId_month_year: { userId: userId, month: currentMonth, year: currentYear } }
            })

            if (salaryRecord) {
                await tx.salaryRecord.update({
                    where: { id: salaryRecord.id },
                    data: { deductions: { increment: amount } }
                })
            } else {
                const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
                const targetUser = await tx.user.findUnique({ where: { id: userId } })
                await tx.salaryRecord.create({
                    data: {
                        userId: userId,
                        month: currentMonth,
                        year: currentYear,
                        totalDays: daysInMonth,
                        deductions: amount,
                        baseSalary: targetUser?.salary || 0
                    }
                })
            }

            // 3. Add Record to SalaryAdjustment (for history management)
            const msg = `Lateness Penalty Deduction applied with ${amount} days`
            await tx.salaryAdjustment.create({
                data: {
                    userId: userId,
                    type: 'DEDUCTION',
                    amount: amount,
                    reason: msg,
                    status: 'ACTIVE'
                }
            })

            // 4. Add System Comment to Task
            let comments = []
            if (task.comments) {
                try {
                    comments = JSON.parse(task.comments)
                } catch {
                    comments = []
                }
            }

            comments.push({
                text: msg,
                author: "System",
                date: now.toISOString(),
                type: 'SYSTEM_DEDUCTION',
                amount: amount
            })

            await tx.task.update({
                where: { id: params.id },
                data: { comments: JSON.stringify(comments) }
            })

            // 5. Audit Log
            await tx.auditLog.create({
                data: {
                    action: 'APPLY_MANUAL_PENALTY',
                    entityType: 'TASK',
                    entityId: params.id,
                    userId: userRole === 'SUPER_ADMIN' ? null : (session.user as any).id,
                    superAdminId: userRole === 'SUPER_ADMIN' ? (session.user as any).id : null,
                    details: JSON.stringify({ amount, targetUserId: userId })
                }
            })

            return { success: true }
        })

        return NextResponse.json(result)
    } catch (error: any) {
        console.error("Penalty API error:", error)
        return new NextResponse(JSON.stringify({ message: error.message }), { status: 500 })
    }
}
