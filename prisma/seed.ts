import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
    console.log('Seeding database...')

    // Hash password for all users
    const hashedPassword = await bcrypt.hash('password123', 10)

    // Create Super Admin
    const superAdmin = await prisma.user.upsert({
        where: { email: 'superadmin@example.com' },
        update: {},
        create: {
            email: 'superadmin@example.com',
            password: hashedPassword,
            firstName: 'Super',
            lastName: 'Admin',
            role: 'SUPER_ADMIN',
            gender: 'MALE',
            status: 'ACTIVE'
        }
    })
    console.log('✓ Created Super Admin:', superAdmin.email)

    // Create Admin
    const admin = await prisma.user.upsert({
        where: { email: 'admin@example.com' },
        update: {},
        create: {
            email: 'admin@example.com',
            password: hashedPassword,
            firstName: 'Admin',
            lastName: 'User',
            role: 'ADMIN',
            gender: 'FEMALE',
            status: 'OFFLINE'
        }
    })
    console.log('✓ Created Admin:', admin.email)

    // Create Team Leader
    const teamLeader = await prisma.user.upsert({
        where: { email: 'teamleader@example.com' },
        update: {},
        create: {
            email: 'teamleader@example.com',
            password: hashedPassword,
            firstName: 'Team',
            lastName: 'Leader',
            role: 'TEAM_LEADER',
            gender: 'MALE',
            status: 'ACTIVE'
        }
    })
    console.log('✓ Created Team Leader:', teamLeader.email)

    // Create Employee 1
    const employee1 = await prisma.user.upsert({
        where: { email: 'employee@example.com' },
        update: {},
        create: {
            email: 'employee@example.com',
            password: hashedPassword,
            firstName: 'John',
            lastName: 'Employee',
            role: 'EMPLOYEE',
            gender: 'MALE',
            status: 'ACTIVE',
            totalDifficultyPoints: 15
        }
    })
    console.log('✓ Created Employee 1:', employee1.email)

    // Create Employee 2
    const employee2 = await prisma.user.upsert({
        where: { email: 'sarah@example.com' },
        update: {},
        create: {
            email: 'sarah@example.com',
            password: hashedPassword,
            firstName: 'Sarah',
            lastName: 'Smith',
            role: 'EMPLOYEE',
            gender: 'FEMALE',
            status: 'OFFLINE',
            totalDifficultyPoints: 42
        }
    })
    console.log('✓ Created Employee 2:', employee2.email)

    // --- TASKS ---
    console.log('\nCreating tasks...')

    // Tasks for Employee 1
    await prisma.task.create({
        data: {
            title: 'Design Dashboard Layout',
            description: 'Create a responsive dashboard layout using the new design system.',
            status: 'IN_PROGRESS',
            difficulty: 5,
            totalCost: 1500,
            deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
            assigneeId: employee1.id,
            createdBy: teamLeader.id,
            createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) // created yesterday
        }
    })

    await prisma.task.create({
        data: {
            title: 'Fix Login Bug',
            description: 'Investigate and fix the issue where users are logged out randomly.',
            status: 'PENDING',
            difficulty: 8,
            totalCost: 0,
            deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
            assigneeId: employee1.id,
            createdBy: teamLeader.id
        }
    })

    await prisma.task.create({
        data: {
            title: 'Update User Profile',
            description: 'Add fields for social media links to the user profile page.',
            status: 'SUBMITTED',
            difficulty: 3,
            totalCost: 500,
            deadline: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // yesterday (overdue if not done, but it is submitted)
            assigneeId: employee1.id,
            createdBy: admin.id,
            comments: JSON.stringify([{ user: 'John Employee', text: 'I have updated the fields, awaiting review.', date: new Date().toISOString() }])
        }
    })

    await prisma.task.create({
        data: {
            title: 'Quarterly Report',
            description: 'Compile the financial data for Q3.',
            status: 'APPROVED',
            difficulty: 7,
            totalCost: 2000,
            deadline: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
            assigneeId: employee1.id,
            createdBy: superAdmin.id
        }
    })

    // Tasks for Employee 2
    await prisma.task.create({
        data: {
            title: 'Client Meeting Preparation',
            description: 'Prepare the slide deck for the meeting with ACME Corp.',
            status: 'IN_PROGRESS',
            difficulty: 4,
            totalCost: 0,
            deadline: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // tomorrow
            assigneeId: employee2.id,
            createdBy: teamLeader.id
        }
    })

    // --- OBLIGATIONS ---
    console.log('Creating obligations...')

    await prisma.obligation.create({
        data: {
            title: 'Daily Standup',
            description: 'Attend the daily team sync at 10:00 AM.',
            assigneeId: employee1.id,
            recurrence: 'ONE_TIME', // Or DAILY if supported
            deadline: new Date(Date.now() + 4 * 60 * 60 * 1000),
            difficulty: 1,
            status: 'PENDING'
        }
    })

    await prisma.obligation.create({
        data: {
            title: 'Submit Timesheet',
            description: 'Submit your weekly hours by Friday 5 PM.',
            assigneeId: employee1.id,
            recurrence: 'ONE_TIME',
            deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
            difficulty: 2,
            status: 'PENDING'
        }
    })

    // --- NOTIFICATIONS ---
    console.log('Creating notifications...')

    await prisma.notification.create({
        data: {
            userId: employee1.id,
            type: 'TASK_ASSIGNED',
            message: 'You have been assigned a new task: Design Dashboard Layout',
            read: false
        }
    })

    await prisma.notification.create({
        data: {
            userId: employee1.id,
            type: 'TASK_APPROVED',
            message: 'Your task "Quarterly Report" has been approved.',
            read: true
        }
    })

    await prisma.notification.create({
        data: {
            userId: admin.id,
            type: 'TASK_SUBMITTED',
            message: 'John Employee has submitted "Update User Profile" for review.',
            read: false
        }
    })



    // --- AUDIT LOGS ---
    console.log('Creating audit logs...')

    // Create dummy audit logs
    await prisma.auditLog.create({
        data: {
            action: 'CREATE_TASK',
            entityType: 'TASK',
            entityId: 'generated-id-1',
            userId: teamLeader.id,
            details: JSON.stringify({ title: 'Design Dashboard Layout' })
        }
    })

    await prisma.auditLog.create({
        data: {
            action: 'SUBMIT_TASK',
            entityType: 'TASK',
            entityId: 'generated-id-3',
            userId: employee1.id,
            details: JSON.stringify({ title: 'Update User Profile' })
        }
    })

    await prisma.auditLog.create({
        data: {
            action: 'APPROVE_TASK',
            entityType: 'TASK',
            entityId: 'generated-id-4',
            userId: superAdmin.id,
            details: JSON.stringify({ title: 'Quarterly Report' })
        }
    })



    // --- SALARY HISTORY ---
    console.log('Creating salary history...')

    // Employee 1: John (Partial history)
    try {
        await prisma.salaryRecord.deleteMany({})
        console.log('✓ Cleared existing salary records')
    } catch (e) {
        console.log('! Could not clear salary records (may not exist)')
    }
    await prisma.salaryRecord.create({
        data: {
            userId: employee1.id,
            month: 11, // November
            year: 2024,
            totalDays: 30,
            deductions: 0.5 // Half day off
        }
    })

    await prisma.salaryRecord.create({
        data: {
            userId: employee1.id,
            month: 10, // October
            year: 2024,
            totalDays: 31,
            deductions: 0
        }
    })

    // Employee 2: Sarah (Perfect attendance + current month)
    await prisma.salaryRecord.create({
        data: {
            userId: employee2.id,
            month: 11, // November
            year: 2024,
            totalDays: 30,
            deductions: 0
        }
    })

    await prisma.salaryRecord.create({
        data: {
            userId: employee2.id,
            month: 12, // December (Current simulated)
            year: 2024,
            totalDays: 31,
            deductions: 1.25 // 1 day + quarter day
        }
    })

    console.log('\n✅ Seeding completed!')
    console.log('\nLogin credentials for all users:')
    console.log('Password: password123\n')
    console.log('Super Admin: superadmin@example.com')
    console.log('Admin:      admin@example.com')
    console.log('Team Leader: teamleader@example.com')
    console.log('Employee:   employee@example.com')
    console.log('Employee 2: sarah@example.com')
}

main()
    .catch((e) => {
        console.error('Error seeding database:', e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
