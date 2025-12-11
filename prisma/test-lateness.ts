
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
    const email = 'lateness_test@company.com'
    const password = await bcrypt.hash('password123', 10)

    // 1. Create User
    const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
            email,
            firstName: 'Lateness',
            lastName: 'Tester',
            password,
            role: 'EMPLOYEE',
            status: 'ACTIVE',
            salary: 5000
        }
    })

    console.log(`Created User: ${user.email} (password123)`)

    // 2. Create Task due TODAY
    const today = new Date() // Now
    // Set time to end of day to ensuring it's "today"
    // Actually deadline typically splits just date, but let's keep it as "now" or "end of day"
    // The logic uses .toDateString() comparison so strictly "Same Day" is enough.

    const task = await prisma.task.create({
        data: {
            title: 'Lateness Penalty Test',
            description: 'Open this task and click "Capture Location" or manually add a location to test the automatic penalty.',
            status: 'IN_PROGRESS',
            deadline: today, // Due today
            assigneeId: user.id,
            difficulty: 5
        }
    })

    console.log(`Created Task: ${task.title} (Due: ${task.deadline.toDateString()})`)
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
