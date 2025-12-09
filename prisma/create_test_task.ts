import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    const employee = await prisma.user.findUnique({
        where: { email: 'employee@example.com' }
    })

    if (!employee) {
        console.error('Employee not found')
        return
    }

    const admin = await prisma.user.findUnique({
        where: { email: 'admin@example.com' }
    })

    if (!admin) {
        console.error('Admin not found')
        return
    }

    const task = await prisma.task.create({
        data: {
            title: "Cost Verification Task",
            description: "Task to verify cost submission",
            status: "IN_PROGRESS",
            deadline: new Date(new Date().setDate(new Date().getDate() + 7)),
            assigneeId: employee.id,
            createdBy: admin.id,
            difficulty: 5
        }
    })

    console.log(`Created task: ${task.title} (${task.id})`)
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect())
