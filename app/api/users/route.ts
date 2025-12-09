import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import bcrypt from "bcryptjs"

export async function GET(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = session?.user?.role

    if (!session || !session.user) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    // Check if requesting a single user by ID
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('id')

    // If listing users, enforce role check
    if (!userId && !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    // If fetching single user, allow if self or admin
    if (userId && userId !== session.user.id && !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    if (userId) {
        // Fetch single user with approved/completed and rejected tasks
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                status: true,
                role: true,
                gender: true,
                salary: true,
                tasks: {
                    select: {
                        difficulty: true,
                        status: true
                    }
                }
            }
        })

        if (!user) {
            return new NextResponse("User not found", { status: 404 })
        }

        // Calculate total difficulty points: approved/completed - rejected
        const approvedPoints = user.tasks
            .filter(t => t.status === 'APPROVED' || t.status === 'COMPLETED')
            .reduce((sum, task) => sum + task.difficulty, 0)
        const rejectedPoints = user.tasks
            .filter(t => t.status === 'REJECTED')
            .reduce((sum, task) => sum + task.difficulty, 0)
        const totalDifficultyPoints = approvedPoints - rejectedPoints

        // Filter Salary: Only show if Admin/SuperAdmin/Self
        const canViewSalary = ['ADMIN', 'SUPER_ADMIN'].includes(userRole || '') || session.user.id === userId

        return NextResponse.json({
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            status: user.status,
            role: user.role,
            gender: user.gender,
            salary: canViewSalary ? user.salary : undefined,
            totalDifficultyPoints
        })
    }

    // Fetch list of users
    const whereClause = userRole === 'SUPER_ADMIN'
        ? {}
        : userRole === 'ADMIN'
            ? { role: { not: 'SUPER_ADMIN' } }
            : { role: 'EMPLOYEE' } // TEAM_LEADER sees only employees logic can be refined if needed

    const users = await prisma.user.findMany({
        where: whereClause,
        select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            status: true,
            lastActivity: true,
            role: true,
            gender: true,
            salary: false, // Salary NOT needed in list view generally, keeps payload small/secure
            tasks: {
                select: {
                    difficulty: true,
                    status: true
                }
            }
        },
        orderBy: { firstName: 'asc' }
    })

    // Calculate total difficulty points: approved/completed - rejected
    const usersWithPoints = users.map(user => {
        const approvedPoints = user.tasks
            .filter(t => t.status === 'APPROVED' || t.status === 'COMPLETED')
            .reduce((sum, task) => sum + task.difficulty, 0)
        const rejectedPoints = user.tasks
            .filter(t => t.status === 'REJECTED')
            .reduce((sum, task) => sum + task.difficulty, 0)

        // Determine effective status based on lastActivity
        let effectiveStatus = user.status
        if (effectiveStatus === 'ACTIVE') {
            const lastActivity = (user as any).lastActivity // accessing dynamic property
            if (lastActivity) {
                const diffMs = new Date().getTime() - new Date(lastActivity).getTime()
                const oneMinuteMs = 60 * 1000
                if (diffMs > oneMinuteMs) {
                    effectiveStatus = 'OFFLINE'
                }
            }
        }

        // Note: We do NOT expose salary in the list view return
        return {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            status: effectiveStatus,
            role: user.role,
            gender: user.gender,
            totalDifficultyPoints: approvedPoints - rejectedPoints
        }
    })

    return NextResponse.json(usersWithPoints)
}


export async function POST(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = session?.user?.role

    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const json = await req.json()
    const { firstName, lastName, email, password, role, gender } = json

    // Validate role
    const newUserRole = role || 'EMPLOYEE'

    // Only SUPER_ADMIN can create ADMIN or SUPER_ADMIN users
    if ((newUserRole === 'ADMIN' || newUserRole === 'SUPER_ADMIN') && userRole !== 'SUPER_ADMIN') {
        return new NextResponse("Only Super Admin can create Admin users", { status: 403 })
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
        return new NextResponse("User already exists", { status: 400 })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
        data: {
            firstName,
            lastName,
            email,
            password: hashedPassword,
            role: newUserRole,
            status: 'OFFLINE',
            gender: gender || 'MALE'
        },
        select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true, gender: true }
    })

    return NextResponse.json(user)
}

export async function PUT(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = session?.user?.role

    if (!session || !session.user) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const json = await req.json()
    const { id, firstName, lastName, email, password, role, gender, salary } = json

    if (!id) {
        return new NextResponse("User ID required", { status: 400 })
    }

    // Allow if self or admin
    if (id !== session.user.id && !['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    // Check if email is taken by another user
    if (email) {
        const existingUser = await prisma.user.findFirst({
            where: {
                email,
                NOT: { id }
            }
        })
        if (existingUser) {
            return new NextResponse("Email already in use", { status: 400 })
        }
    }

    // Build update data
    const updateData: any = {}
    if (firstName) updateData.firstName = firstName
    if (lastName) updateData.lastName = lastName
    if (email) updateData.email = email
    if (password) updateData.password = await bcrypt.hash(password, 10)
    if (role) updateData.role = role
    if (gender) updateData.gender = gender

    // Salary Update Permission: Only Admin/SuperAdmin
    if (salary !== undefined) {
        if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
            // If employee tries to update salary, ignore it or error?
            // Safer to ignore/forbid. 
            // If they are self-updating profile, we just exclude salary from updateData.
        } else {
            updateData.salary = salary
        }
    }

    const user = await prisma.user.update({
        where: { id },
        data: updateData,
        select: { id: true, firstName: true, lastName: true, email: true, role: true, gender: true, salary: true }
    })

    // Sync Salary to Current Month History
    if (updateData.salary !== undefined) {
        const now = new Date()
        const currentMonth = now.getMonth() + 1
        const currentYear = now.getFullYear()

        // Check if record exists
        const existingRecord = await prisma.salaryRecord.findUnique({
            where: { userId_month_year: { userId: id, month: currentMonth, year: currentYear } }
        })

        if (existingRecord) {
            await prisma.salaryRecord.update({
                where: { id: existingRecord.id },
                data: { baseSalary: updateData.salary }
            })
        } else {
            const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
            await prisma.salaryRecord.create({
                data: {
                    userId: id,
                    month: currentMonth,
                    year: currentYear,
                    totalDays: daysInMonth,
                    deductions: 0,
                    baseSalary: updateData.salary
                }
            })
        }
    }

    return NextResponse.json(user)
}

export async function DELETE(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = session?.user?.role

    if (!session || !session.user || !['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('id')

    if (!userId) {
        return new NextResponse("User ID required", { status: 400 })
    }

    // Prevent deleting yourself
    if (userId === session.user.id) {
        return new NextResponse("Cannot delete yourself", { status: 400 })
    }

    // Get the user to be deleted
    const userToDelete = await prisma.user.findUnique({ where: { id: userId } })

    if (!userToDelete) {
        return new NextResponse("User not found", { status: 404 })
    }

    // Only SUPER_ADMIN can delete ADMIN users
    if (userToDelete.role === 'ADMIN' && userRole !== 'SUPER_ADMIN') {
        return new NextResponse("Only Super Admin can delete Admin users", { status: 403 })
    }

    // Cannot delete SUPER_ADMIN
    if (userToDelete.role === 'SUPER_ADMIN') {
        return new NextResponse("Cannot delete Super Admin", { status: 403 })
    }

    try {
        // Delete related records first (cascade delete)
        await prisma.task.deleteMany({
            where: { assigneeId: userId }
        })

        await prisma.obligation.deleteMany({
            where: { assigneeId: userId }
        })

        // Now delete the user
        await prisma.user.delete({
            where: { id: userId }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Delete error:', error)
        return new NextResponse("Failed to delete user", { status: 500 })
    }
}
