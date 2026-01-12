import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { verifyResourceAccess } from "@/lib/security"
import { translations, Locale } from "@/lib/translations"

export async function PUT(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK')
    if (!hasAccess) {
        return new NextResponse("Access Denied: Task belongs to a different company", { status: 403 })
    }

    try {
        const json = await req.json()
        const { newAttachments, note, cost, costDescription, isDraft, location, locationName } = json

        // Support both 'costs' and 'costEntries'
        const inputCosts = json.costs || json.costEntries

        if (note && note.length > 500) {
            return new NextResponse("Note cannot exceed 500 characters", { status: 400 })
        }
        if (costDescription && costDescription.length > 200) {
            return new NextResponse("Cost description cannot exceed 200 characters", { status: 400 })
        }
        if (location && location.length > 200) {
            return new NextResponse("Location cannot exceed 200 characters", { status: 400 })
        }
        // Force parse cost to number
        const costValue = cost ? Number(cost) : 0
        console.log(`[API] Submit Task ${params.id}: cost=${costValue}, attachments=${newAttachments?.length || 0}, isDraft=${isDraft}, location=${location}`)

        const userId = (session.user as any).id

        const result = await prisma.$transaction(async (tx) => {
            // 1. Get current task to read existing comments and attachments
            const currentTask = await tx.task.findUnique({
                where: { id: params.id },
                include: { assignee: true }
            })
            if (!currentTask) throw new Error("Task not found")

            // Parse existing attachments
            let finalAttachments: any[] = []
            if (currentTask.attachments) {
                try {
                    const parsed = JSON.parse(currentTask.attachments)
                    if (Array.isArray(parsed)) {
                        finalAttachments = parsed
                    } else if (parsed && typeof parsed === 'object' && (parsed as any).url) {
                        // Convert legacy single to array
                        finalAttachments = [parsed]
                    }
                } catch {
                    finalAttachments = []
                }
            }

            // Add new attachments if provided
            if (newAttachments && Array.isArray(newAttachments)) {
                // Ensure new attachments are in the correct object format
                const formattedNew = newAttachments.map(att => {
                    if (typeof att === 'string') {
                        return {
                            url: att,
                            name: att.split('/').pop() || 'Attachment',
                            uploadedBy: (session.user as any).name || 'Unknown',
                            uploadedAt: new Date().toISOString()
                        }
                    }
                    return att
                })
                finalAttachments = [...finalAttachments, ...formattedNew]
            }

            let comments = []
            if (currentTask.comments) {
                try {
                    comments = JSON.parse(currentTask.comments)
                } catch {
                    comments = []
                }
            }

            if (note) {
                comments.push({
                    text: note,
                    author: (session.user as any).name || 'Employee',
                    authorId: userId,
                    date: new Date().toISOString(),
                    type: 'SUBMISSION_NOTE'
                })
            }

            // Add cost to note if provided (Legacy single cost)
            let totalAdded = 0
            if (costValue > 0) {
                comments.push({
                    text: `Added cost: ${costValue.toFixed(2)} EGP`,
                    description: costDescription || `Added cost: ${costValue.toFixed(2)} EGP`,
                    amount: costValue,
                    author: (session.user as any).name || 'Employee',
                    authorId: userId,
                    date: new Date().toISOString(),
                    type: 'COST_ADDITION'
                })
                totalAdded += costValue
            }

            // Handle multiple costs array
            if (inputCosts && Array.isArray(inputCosts)) {
                for (const c of inputCosts) {
                    const cVal = Number(c.amount)
                    if (cVal > 0) {
                        if (c.description && c.description.length > 200) {
                            throw new Error("Cost description cannot exceed 200 characters")
                        }
                        comments.push({
                            text: `Added cost: ${cVal.toFixed(2)} EGP`,
                            description: c.description || `Added cost: ${cVal.toFixed(2)} EGP`,
                            amount: cVal,
                            author: (session.user as any).name || 'Employee',
                            authorId: userId,
                            date: new Date().toISOString(),
                            type: 'COST_ADDITION'
                        })
                        totalAdded += cVal
                    }
                }
            }

            // Add location to comments if provided
            if (location) {
                // Per-user location limit: 2 per user
                const userLocations = comments.filter((c: any) => c.type === 'LOCATION_ADDED' && c.authorId === userId)
                if (userLocations.length >= 2) {
                    throw new Error("You have reached the limit of 2 locations for this task.")
                }

                comments.push({
                    text: locationName ? `Location: ${locationName}` : `Location: ${location}`,
                    location: location,
                    locationName: locationName,
                    author: (session.user as any).name || 'Employee',
                    authorId: userId,
                    date: new Date().toISOString(),
                    type: 'LOCATION_ADDED'
                })

                // AUTOMATIC LATENESS DEDUCTION
                // Check if this is the FIRST location being added by THIS user
                if (userLocations.length === 0) {
                    const now = new Date()
                    const deadline = new Date(currentTask.deadline)

                    // Check if today is the deadline day (ignoring time)
                    const isDeadlineDay = now.toDateString() === deadline.toDateString()

                    if (isDeadlineDay) {
                        const currentHour = now.getHours()
                        let penaltyDays = 0

                        if (currentHour >= 11) {
                            penaltyDays = 1.0
                        } else if (currentHour >= 10) {
                            penaltyDays = 0.5
                        } else if (currentHour >= 9) {
                            penaltyDays = 0.25
                        }

                        const isSuperAdmin = (session.user as any).role === 'SUPER_ADMIN'
                        if (penaltyDays > 0 && !isSuperAdmin) {
                            // Apply Deduction to Salary Record
                            const currentMonth = now.getMonth() + 1
                            const currentYear = now.getFullYear()

                            // Use the compound unique key for SalaryRecord
                            const salaryRecord = await tx.salaryRecord.findUnique({
                                where: { userId_month_year: { userId: userId, month: currentMonth, year: currentYear } }
                            })

                            if (salaryRecord) {
                                await tx.salaryRecord.update({
                                    where: { id: salaryRecord.id },
                                    data: { deductions: { increment: penaltyDays } }
                                })
                            } else {
                                const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
                                // Get user's base salary to initialize record correctly
                                const user = await tx.user.findUnique({ where: { id: userId } })
                                await tx.salaryRecord.create({
                                    data: {
                                        userId: userId,
                                        month: currentMonth,
                                        year: currentYear,
                                        totalDays: daysInMonth,
                                        deductions: penaltyDays,
                                        baseSalary: user?.salary || 0
                                    }
                                })
                            }

                            // Add System Comment about Penalty
                            const userLang = ((session.user as any).language || 'en') as Locale
                            const timeStr = now.toLocaleTimeString(userLang === 'ar' ? 'ar-EG' : 'en-US')
                            const msgTemplate = translations[userLang].lateness_penalty_msg
                            const msg = msgTemplate
                                .replace('{days}', penaltyDays.toString())
                                .replace('{time}', timeStr)

                            comments.push({
                                text: msg,
                                author: 'System',
                                date: new Date().toISOString(),
                                type: 'SYSTEM_DEDUCTION'
                            })
                        }
                    }
                }
            }

            // Prepare update data
            const updateData: any = {
                status: isDraft ? 'IN_PROGRESS' : 'PENDING_CONFIRMATION',
                attachments: JSON.stringify(finalAttachments),
                comments: JSON.stringify(comments)
            }

            // Update memberCosts
            if (totalAdded > 0) {
                let currentMemberCosts: Record<string, number> = {}
                if ((currentTask as any).memberCosts) {
                    try {
                        const rawCosts = (currentTask as any).memberCosts
                        currentMemberCosts = typeof rawCosts === 'string'
                            ? JSON.parse(rawCosts)
                            : (rawCosts as Record<string, number>)
                    } catch { currentMemberCosts = {} }
                }

                const currentVal = currentMemberCosts[userId] || 0
                currentMemberCosts[userId] = currentVal + totalAdded
                updateData.memberCosts = currentMemberCosts
            }

            // Add cost to totalCost if cost > 0 (even for drafts)
            if (totalAdded > 0) {
                updateData.totalCost = {
                    increment: totalAdded
                }
            }

            const task = await tx.task.update({
                where: { id: params.id },
                data: updateData
            })

            // Notify the creator (Admin) only if submitted and creator exists
            if (!isDraft && task.createdBy) {
                await tx.notification.create({
                    data: {
                        userId: task.createdBy,
                        type: 'TASK_SUBMITTED',
                        message: `Task "${task.title}" has been submitted by ${(session.user as any).name || 'Employee'}`,
                        relatedId: task.id
                    }
                })
            }

            // Audit log
            await tx.auditLog.create({
                data: {
                    action: isDraft ? 'UPDATE_TASK_PROGRESS' : 'SUBMIT_TASK',
                    entityType: 'TASK',
                    entityId: task.id,
                    userId: (session.user as any).role === 'SUPER_ADMIN' ? null : userId,
                    superAdminId: (session.user as any).role === 'SUPER_ADMIN' ? userId : null,
                    details: JSON.stringify({ newAttachments, note, cost: costValue, isDraft, location })
                }
            })

            return task
        })

        return NextResponse.json(result)
    } catch (error: any) {
        console.error("Task submission error:", error)
        return new NextResponse(JSON.stringify({
            message: error.message || "Failed to save task progress",
            details: error.toString()
        }), { status: 500 })
    }
}
